"""Thin wrapper around the FACEIT Data API v4 (https://docs.faceit.com/docs/data-api/data).

Kept deliberately small and synchronous (uses `requests`), matching how the
rest of the backend already runs blocking Django ORM code through
`asgiref.sync.sync_to_async` when it needs to be called from the async
FastAPI layer - see fastapi_app/main.py's `/admin/faceit/sync/` endpoint.
"""

import time
from typing import Any, Optional

import requests
from django.conf import settings

BASE_URL = "https://open.faceit.com/data/v4"
DEFAULT_TIMEOUT = 10  # seconds
MAX_RETRIES_ON_RATE_LIMIT = 1


class FaceitAPIError(Exception):
    """Raised for missing config, non-2xx responses, or network failures."""


class FaceitClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or getattr(settings, "FACEIT_API_KEY", None)
        if not self.api_key:
            raise FaceitAPIError(
                "FACEIT_API_KEY ist nicht gesetzt. In backend/.env eintragen "
                "(Server-Side API Key aus https://developers.faceit.com/)."
            )
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        })

    def _get(self, path: str, params: Optional[dict] = None) -> dict[str, Any]:
        url = f"{BASE_URL}{path}"
        attempt = 0
        while True:
            try:
                response = self._session.get(url, params=params, timeout=DEFAULT_TIMEOUT)
            except requests.RequestException as exc:
                raise FaceitAPIError(f"Netzwerkfehler bei FACEIT-Aufruf {path}: {exc}") from exc

            if response.status_code == 429 and attempt < MAX_RETRIES_ON_RATE_LIMIT:
                retry_after = float(response.headers.get("Retry-After", "2"))
                time.sleep(retry_after)
                attempt += 1
                continue

            if response.status_code == 404:
                raise FaceitAPIError(f"Nicht gefunden (404): {path}")
            if not response.ok:
                raise FaceitAPIError(
                    f"FACEIT-API-Fehler {response.status_code} bei {path}: {response.text[:300]}"
                )
            return response.json()

    # --- Players ---

    def get_player(self, player_id: str) -> dict[str, Any]:
        """GET /players/{player_id} - profile, games, skill levels."""
        return self._get(f"/players/{player_id}")

    def get_player_stats(self, player_id: str, game_id: str) -> dict[str, Any]:
        """GET /players/{player_id}/stats/{game_id} - lifetime stats summary."""
        return self._get(f"/players/{player_id}/stats/{game_id}")

    def get_player_history(
        self, player_id: str, game_id: str, offset: int = 0, limit: int = 20
    ) -> dict[str, Any]:
        """GET /players/{player_id}/history - this player's own match
        history for a game, independent of any team/organizer/championship.
        Used to sync solo matches for players with no team (see
        sync.py sync_player_solo_matches) - team players' matches are
        already covered by the league/championship pipeline below."""
        params = {"game": game_id, "offset": offset, "limit": limit}
        return self._get(f"/players/{player_id}/history", params=params)

    # --- Organizers / championships / matches ---

    def get_organizer_championships(
        self, organizer_id: str, game_id: Optional[str] = None, offset: int = 0, limit: int = 50
    ) -> dict[str, Any]:
        """GET /organizers/{organizer_id}/championships - all championships
        (seasons) run by this organizer, e.g. every "DACH CS Season N"."""
        params: dict[str, Any] = {"offset": offset, "limit": limit}
        if game_id:
            params["game_id"] = game_id
        return self._get(f"/organizers/{organizer_id}/championships", params=params)

    def get_championship_matches(
        self, championship_id: str, match_type: Optional[str] = None, offset: int = 0, limit: int = 50
    ) -> dict[str, Any]:
        """GET /championships/{championship_id}/matches.

        match_type: "upcoming" | "ongoing" | "past" | None (all).
        """
        params: dict[str, Any] = {"offset": offset, "limit": limit}
        if match_type:
            params["type"] = match_type
        return self._get(f"/championships/{championship_id}/matches", params=params)

    def get_match(self, match_id: str) -> dict[str, Any]:
        """GET /matches/{match_id} - full match details (teams, score, status)."""
        return self._get(f"/matches/{match_id}")

    def get_match_stats(self, match_id: str) -> dict[str, Any]:
        """GET /matches/{match_id}/stats - detailed per-round, per-player CS2
        stats (kills/deaths/K-D/K-R, headshots, multi-kills, and the
        "advanced stats" FACEIT added for CS2: utility damage, flash count/
        successes, enemies flashed, entry count/wins, 1v1/1v2 clutches)."""
        return self._get(f"/matches/{match_id}/stats")
