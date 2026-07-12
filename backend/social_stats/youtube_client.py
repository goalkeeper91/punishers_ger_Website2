"""Thin wrapper around the YouTube Data API v3 (public, no per-channel OAuth
needed - unlike Twitch/Twitter/Instagram/TikTok, subscriber and view counts
are exposed on the public `channels` resource given just an API key from
https://console.cloud.google.com/apis/credentials."""

from typing import Optional
from urllib.parse import urlparse

import requests
from django.conf import settings

CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
DEFAULT_TIMEOUT = 10  # seconds


class YouTubeAPIError(Exception):
    """Raised for missing config, non-2xx responses, or network failures."""


def extract_channel_ref(url: Optional[str]) -> Optional[dict]:
    """Turn a youtube.com URL into the right `channels.list` query param:
    - /channel/UC... -> {"id": "UC..."}
    - /@handle        -> {"forHandle": "@handle"}
    - /user/Name      -> {"forUsername": "Name"}
    - /c/VanityName   -> best-effort {"forHandle": "@VanityName"} (the API has
      no direct vanity-URL lookup short of the quota-costly search endpoint;
      this works when the vanity name matches the channel's @handle, which is
      the common case for handles claimed after 2022, and simply returns no
      match otherwise - sync then leaves the existing stats untouched)."""
    if not url:
        return None
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
    except ValueError:
        return None
    netloc = parsed.netloc or ""
    if netloc != "youtube.com" and not netloc.endswith(".youtube.com"):
        return None
    segments = [s for s in parsed.path.split("/") if s]
    if not segments:
        return None
    if segments[0].startswith("@"):
        return {"forHandle": segments[0]}
    if segments[0] == "channel" and len(segments) > 1:
        return {"id": segments[1]}
    if segments[0] == "user" and len(segments) > 1:
        return {"forUsername": segments[1]}
    if segments[0] == "c" and len(segments) > 1:
        return {"forHandle": f"@{segments[1]}"}
    return None


def get_channel_stats(url: Optional[str]) -> Optional[dict]:
    """Returns {"follower_count": int, "view_count": int} for a channel URL,
    or None if the URL couldn't be resolved to a channel, the channel has no
    public statistics, or YOUTUBE_API_KEY isn't configured."""
    api_key = getattr(settings, "YOUTUBE_API_KEY", None)
    if not api_key:
        raise YouTubeAPIError(
            "YOUTUBE_API_KEY ist nicht gesetzt. In backend/.env eintragen "
            "(API-Key unter https://console.cloud.google.com/apis/credentials anlegen, "
            "YouTube Data API v3 aktivieren)."
        )
    ref = extract_channel_ref(url)
    if ref is None:
        return None

    params = {**ref, "part": "statistics", "key": api_key}
    try:
        response = requests.get(CHANNELS_URL, params=params, timeout=DEFAULT_TIMEOUT)
    except requests.RequestException as exc:
        raise YouTubeAPIError(f"Netzwerkfehler beim YouTube-API-Aufruf: {exc}") from exc
    if not response.ok:
        raise YouTubeAPIError(f"YouTube-API-Fehler {response.status_code}: {response.text[:300]}")

    items = response.json().get("items", [])
    if not items:
        return None
    stats = items[0].get("statistics", {})
    if stats.get("hiddenSubscriberCount"):
        return None
    follower_count = stats.get("subscriberCount")
    view_count = stats.get("viewCount")
    return {
        "follower_count": int(follower_count) if follower_count is not None else None,
        "view_count": int(view_count) if view_count is not None else None,
    }
