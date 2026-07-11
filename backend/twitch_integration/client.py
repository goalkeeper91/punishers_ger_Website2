"""Thin wrapper around the Twitch Helix API (https://dev.twitch.tv/docs/api/).

No Django models here - live status is always fetched fresh on request,
there's nothing to persist (unlike faceit_integration, which caches synced
data because FACEIT's API is comparatively slow/rate-limited to hit on
every page load). Uses the OAuth Client Credentials flow (App Access Token)
since we only need public read access to stream status, not any
user-specific scopes.
"""

import time
from typing import Any, Optional
from urllib.parse import urlparse

import requests
from django.conf import settings

TOKEN_URL = "https://id.twitch.tv/oauth2/token"
HELIX_BASE_URL = "https://api.twitch.tv/helix"
DEFAULT_TIMEOUT = 10  # seconds
MAX_LOGINS_PER_REQUEST = 100  # Helix limit for user_login params per call


class TwitchAPIError(Exception):
    """Raised for missing config, non-2xx responses, or network failures."""


def extract_twitch_login(url: Optional[str]) -> Optional[str]:
    """Pull the channel login out of a profile URL like
    "https://www.twitch.tv/somechannel/" -> "somechannel". Returns None for
    anything that isn't a recognizable twitch.tv URL."""
    if not url:
        return None
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
    except ValueError:
        return None
    if "twitch.tv" not in (parsed.netloc or ""):
        return None
    path = parsed.path.strip("/")
    if not path:
        return None
    return path.split("/")[0] or None


class TwitchClient:
    def __init__(self, client_id: Optional[str] = None, client_secret: Optional[str] = None):
        self.client_id = client_id or getattr(settings, "TWITCH_CLIENT_ID", None)
        self.client_secret = client_secret or getattr(settings, "TWITCH_CLIENT_SECRET", None)
        if not self.client_id or not self.client_secret:
            raise TwitchAPIError(
                "TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET sind nicht gesetzt. In backend/.env eintragen "
                "(App unter https://dev.twitch.tv/console registrieren)."
            )
        self._session = requests.Session()
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    def _fetch_token(self) -> str:
        try:
            response = self._session.post(
                TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "client_credentials",
                },
                timeout=DEFAULT_TIMEOUT,
            )
        except requests.RequestException as exc:
            raise TwitchAPIError(f"Netzwerkfehler beim Twitch-Token-Abruf: {exc}") from exc
        if not response.ok:
            raise TwitchAPIError(f"Twitch-Token-Fehler {response.status_code}: {response.text[:300]}")
        data = response.json()
        self._access_token = data["access_token"]
        # Refresh a bit early so we never call Helix with a token that
        # expires mid-request.
        self._token_expires_at = time.time() + data.get("expires_in", 3600) - 60
        return self._access_token

    def _ensure_token(self) -> str:
        if self._access_token and time.time() < self._token_expires_at:
            return self._access_token
        return self._fetch_token()

    def _get(self, path: str, params: Optional[list] = None) -> dict[str, Any]:
        token = self._ensure_token()

        def _do_request(bearer: str):
            headers = {"Client-Id": self.client_id, "Authorization": f"Bearer {bearer}"}
            return self._session.get(f"{HELIX_BASE_URL}{path}", params=params, headers=headers, timeout=DEFAULT_TIMEOUT)

        try:
            response = _do_request(token)
            if response.status_code == 401:
                # Token revoked/expired earlier than expected - refresh once and retry.
                token = self._fetch_token()
                response = _do_request(token)
        except requests.RequestException as exc:
            raise TwitchAPIError(f"Netzwerkfehler bei Twitch-Aufruf {path}: {exc}") from exc

        if not response.ok:
            raise TwitchAPIError(f"Twitch-API-Fehler {response.status_code} bei {path}: {response.text[:300]}")
        return response.json()

    def get_live_streams(self, logins: list) -> dict:
        """Returns {login_lowercased: stream_data} for whichever of the
        given channel logins are currently live. A login absent from the
        result is offline. Batches requests in groups of 100 (Helix's limit
        for repeated user_login params per call)."""
        result: dict = {}
        unique_logins = list(dict.fromkeys(login.lower() for login in logins if login))
        for i in range(0, len(unique_logins), MAX_LOGINS_PER_REQUEST):
            batch = unique_logins[i:i + MAX_LOGINS_PER_REQUEST]
            params = [("user_login", login) for login in batch]
            data = self._get("/streams", params=params)
            for stream in data.get("data", []):
                result[stream["user_login"].lower()] = stream
        return result
