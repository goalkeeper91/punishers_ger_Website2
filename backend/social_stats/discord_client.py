"""Public Discord invite lookup - no bot/OAuth needed. Given any active
invite link for a server, Discord's invite endpoint returns approximate
member/online counts when `with_counts=true` is passed, which is enough for
a reach metric without requiring a bot with the (privileged) guild-members
intent."""

import re
from typing import Optional

import requests

INVITE_API_URL = "https://discord.com/api/v10/invites/{code}"
DEFAULT_TIMEOUT = 10  # seconds
INVITE_CODE_RE = re.compile(r"(?:discord\.gg/|discord\.com/invite/)([\w-]+)", re.IGNORECASE)


class DiscordAPIError(Exception):
    """Raised for unresolvable invite links, non-2xx responses, or network failures."""


def extract_invite_code(url: Optional[str]) -> Optional[str]:
    """Pull the invite code out of a discord.gg/xxx or discord.com/invite/xxx URL."""
    if not url:
        return None
    match = INVITE_CODE_RE.search(url)
    return match.group(1) if match else None


def get_member_counts(url: Optional[str]) -> Optional[dict]:
    """Returns {"follower_count": approximate_member_count} for the server
    behind a Discord invite link, or None if the URL has no recognizable
    invite code or the invite has expired/is invalid."""
    code = extract_invite_code(url)
    if code is None:
        return None

    try:
        response = requests.get(
            INVITE_API_URL.format(code=code), params={"with_counts": "true"}, timeout=DEFAULT_TIMEOUT
        )
    except requests.RequestException as exc:
        raise DiscordAPIError(f"Netzwerkfehler bei Discord-Invite-Abruf: {exc}") from exc
    if response.status_code == 404:
        return None  # invite expired/invalid - not a hard error, just nothing to report
    if not response.ok:
        raise DiscordAPIError(f"Discord-API-Fehler {response.status_code}: {response.text[:300]}")

    data = response.json()
    member_count = data.get("approximate_member_count")
    return {"follower_count": int(member_count)} if member_count is not None else None
