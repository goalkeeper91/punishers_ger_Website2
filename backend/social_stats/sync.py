"""Auto-sync for the org's own channels (sponsors.SocialLink) and every
player's channels (social_stats.PlayerSocialStats), platform by platform.

YouTube (org + players) and Discord (org only - individual players don't run
their own Discord servers) have a public, key-only API that doesn't need
per-channel OAuth - see youtube_client.py/discord_client.py. Twitch also
syncs automatically, but only once a channel has been connected via OAuth
(see models.TwitchAuthorization and the /social-stats/twitch/... endpoints
in fastapi_app/main.py) - Twitch removed public follower counts in 2023.
Twitter/Instagram/TikTok have no automatable path at all yet and stay
admin-maintained (data_source="manual")."""

import logging
from datetime import timedelta

from django.utils import timezone

from sponsors.models import SocialLink
from twitch_integration.client import TwitchAPIError, TwitchClient, extract_twitch_login
from users.models import CustomUser

from . import discord_client, youtube_client
from .models import PlayerSocialStats, TwitchAuthorization, TwitchViewerSnapshot
from .trends import record_follower_snapshot

logger = logging.getLogger(__name__)


def _get_twitch_follower_count(auth: TwitchAuthorization) -> int:
    """Refreshes the stored access token first if it's expired (Twitch user
    tokens are short-lived, unlike the app token used elsewhere)."""
    client = TwitchClient()
    if auth.token_expires_at <= timezone.now():
        token_data = client.refresh_user_token(auth.refresh_token)
        auth.access_token = token_data["access_token"]
        auth.refresh_token = token_data["refresh_token"]
        auth.token_expires_at = timezone.now() + timedelta(seconds=token_data.get("expires_in", 3600))
        auth.save(update_fields=["access_token", "refresh_token", "token_expires_at"])
    return client.get_follower_count(auth.twitch_user_id, auth.access_token)


def sync_org_channels() -> dict:
    synced, failed = 0, 0
    for link in SocialLink.objects.filter(is_active=True, platform__in=["youtube", "discord", "twitch"]).select_related(
        "twitch_authorization"
    ):
        try:
            if link.platform == "youtube":
                stats = youtube_client.get_channel_stats(link.url)
            elif link.platform == "discord":
                stats = discord_client.get_member_counts(link.url)
            else:
                twitch_auth = getattr(link, "twitch_authorization", None)
                if twitch_auth is None:
                    continue  # not connected - stays manual
                stats = {"follower_count": _get_twitch_follower_count(twitch_auth)}
            if stats is None:
                continue
            link.follower_count = stats.get("follower_count")
            if "view_count" in stats:
                link.view_count = stats.get("view_count")
            link.data_source = "auto"
            link.stats_updated_at = timezone.now()
            link.save(update_fields=["follower_count", "view_count", "data_source", "stats_updated_at"])
            record_follower_snapshot(
                social_link=link, platform=link.platform, follower_count=link.follower_count, view_count=link.view_count
            )
            synced += 1
        except Exception:
            logger.exception("Social-Stats-Sync fehlgeschlagen für Org-Kanal %s (%s)", link.platform, link.url)
            failed += 1
    return {"org_channels_synced": synced, "org_channels_failed": failed}


def sync_player_channels() -> dict:
    synced, failed = 0, 0
    for user in CustomUser.objects.exclude(youtube_link__isnull=True).exclude(youtube_link__exact=""):
        try:
            stats = youtube_client.get_channel_stats(user.youtube_link)
            if stats is None:
                continue
            PlayerSocialStats.objects.update_or_create(
                user=user,
                platform="youtube",
                defaults={
                    "follower_count": stats.get("follower_count"),
                    "view_count": stats.get("view_count"),
                    "data_source": "auto",
                    "stats_updated_at": timezone.now(),
                },
            )
            record_follower_snapshot(
                user=user, platform="youtube", follower_count=stats.get("follower_count"), view_count=stats.get("view_count")
            )
            synced += 1
        except Exception:
            logger.exception("Social-Stats-Sync fehlgeschlagen für Spieler %s (YouTube)", user.username)
            failed += 1

    for auth in TwitchAuthorization.objects.filter(user__isnull=False).select_related("user"):
        try:
            follower_count = _get_twitch_follower_count(auth)
            PlayerSocialStats.objects.update_or_create(
                user=auth.user,
                platform="twitch",
                defaults={"follower_count": follower_count, "data_source": "auto", "stats_updated_at": timezone.now()},
            )
            record_follower_snapshot(user=auth.user, platform="twitch", follower_count=follower_count)
            synced += 1
        except Exception:
            logger.exception("Social-Stats-Sync fehlgeschlagen für Spieler %s (Twitch)", auth.user.username)
            failed += 1

    return {"player_channels_synced": synced, "player_channels_failed": failed}


def sync_twitch_viewer_snapshots() -> dict:
    """Opportunistically logs a viewer-count snapshot for every linked
    Twitch channel (org or player) that happens to be live right now - only
    needs the same public app-token live-status lookup already used for the
    /creators/ live badge, no per-channel OAuth required. Sparse by design:
    this only samples whatever's live at the moment this runs (see the
    in-process scheduler interval), not a continuous per-stream average."""
    logged, failed = 0, 0
    try:
        client = TwitchClient()
    except TwitchAPIError:
        return {"viewer_snapshots_logged": 0, "viewer_snapshots_failed": 0}

    org_links = list(SocialLink.objects.filter(is_active=True, platform="twitch"))
    org_by_login = {
        login: link for link in org_links if (login := extract_twitch_login(link.url))
    }
    users = list(CustomUser.objects.exclude(twitch_link__isnull=True).exclude(twitch_link__exact=""))
    user_by_login = {
        login: user for user in users if (login := extract_twitch_login(user.twitch_link))
    }

    all_logins = list({*org_by_login.keys(), *user_by_login.keys()})
    if not all_logins:
        return {"viewer_snapshots_logged": 0, "viewer_snapshots_failed": 0}

    try:
        live_by_login = client.get_live_streams(all_logins)
    except TwitchAPIError:
        logger.exception("Twitch-Live-Status-Abruf für Zuschauer-Snapshots fehlgeschlagen")
        return {"viewer_snapshots_logged": 0, "viewer_snapshots_failed": len(all_logins)}

    for login, stream in live_by_login.items():
        viewer_count = stream.get("viewer_count")
        if viewer_count is None:
            continue
        try:
            if login in org_by_login:
                TwitchViewerSnapshot.objects.create(social_link=org_by_login[login], viewer_count=viewer_count)
                logged += 1
            if login in user_by_login:
                TwitchViewerSnapshot.objects.create(user=user_by_login[login], viewer_count=viewer_count)
                logged += 1
        except Exception:
            logger.exception("Konnte Twitch-Zuschauer-Snapshot für %s nicht speichern", login)
            failed += 1

    return {"viewer_snapshots_logged": logged, "viewer_snapshots_failed": failed}


def sync_all(trigger: str = "manual") -> dict:
    org_summary = sync_org_channels()
    player_summary = sync_player_channels()
    viewer_summary = sync_twitch_viewer_snapshots()
    return {**org_summary, **player_summary, **viewer_summary, "trigger": trigger}
