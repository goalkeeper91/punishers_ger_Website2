"""In-process poller that detects "went live" transitions for registered
content creators, to drive Discord "stream live" announcements
(discord_bot/). Mirrors faceit_integration/scheduler.py's shape.

twitch_integration itself has no models/INSTALLED_APPS entry - it's a thin
API client package (client.py). Live status is normally computed fresh,
on-demand, by GET /creators/ (see fastapi_app/main.py) - this poller exists
solely to notice a false->true transition that a request-driven endpoint
can't, comparing against CustomUser.last_known_live.
"""

import logging
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from django.conf import settings

logger = logging.getLogger(__name__)

_scheduler: Optional[BackgroundScheduler] = None


def _check_live_status() -> None:
    from django.db import close_old_connections
    from django.utils import timezone
    from users.models import CustomUser
    from discord_bot.redis_bridge import publish_event_notification
    from faceit_integration.models import (
        MatchBroadcast,
        broadcast_live_window_q,
    )
    from .client import TwitchClient, TwitchAPIError, extract_twitch_login

    close_old_connections()
    try:
        now = timezone.now()

        creators = list(CustomUser.objects.filter(is_content_creator=True).exclude(twitch_link=""))
        logins_by_user_id = {}
        for creator in creators:
            login = extract_twitch_login(creator.twitch_link)
            if login:
                logins_by_user_id[creator.id] = login

        # External match casters, but only those inside their match's live
        # window (15 min before scheduled start .. 15 min after finish) -
        # see faceit_integration/models.broadcast_live_window_q.
        broadcasts = list(
            MatchBroadcast.objects.filter(caster_login__gt="")
            .filter(broadcast_live_window_q(now))
            .select_related("match")
        )

        # First: any broadcast still flagged live that has dropped out of
        # its window since the last poll - clear it now so the public popup
        # stops showing it without waiting for the next Twitch batch.
        MatchBroadcast.objects.filter(is_live=True).exclude(
            broadcast_live_window_q(now)
        ).update(is_live=False, live_checked_at=now)

        all_logins = list(logins_by_user_id.values()) + [b.caster_login for b in broadcasts]
        if not all_logins:
            return

        try:
            client = TwitchClient()
            live_by_login = client.get_live_streams(all_logins)
        except TwitchAPIError as exc:
            logger.warning("Twitch-Live-Poll fehlgeschlagen: %s", exc)
            return

        for creator in creators:
            login = logins_by_user_id.get(creator.id)
            is_live_now = bool(login and login.lower() in live_by_login)

            if is_live_now and not creator.last_known_live:
                stream = live_by_login[login.lower()]
                # Fan-out + per-channel dedup in publish_event_notification
                # (discord_bot/redis_bridge.py). Re-queries the stream_live
                # mappings per went-live transition rather than pre-fetching
                # once - those transitions are rare enough (a handful a day)
                # that the extra query is irrelevant.
                publish_event_notification(
                    event_type="stream_live",
                    title=f"{creator.username} ist jetzt live!",
                    description=stream.get("title") or "",
                    fields=[
                        {"name": "Spiel", "value": stream.get("game_name") or "-", "inline": True},
                        {"name": "Link", "value": creator.twitch_link, "inline": True},
                    ],
                )

            if is_live_now != creator.last_known_live:
                creator.last_known_live = is_live_now
                creator.save(update_fields=["last_known_live"])

        # Refresh the live cache on each in-window broadcast. Written via
        # .update() to bypass MatchBroadcast.save()'s caster re-normalisation
        # (nothing about the caster changed here).
        for b in broadcasts:
            stream = live_by_login.get(b.caster_login.lower())
            if stream:
                thumbnail_url = (stream.get("thumbnail_url") or "").replace("{width}", "320").replace("{height}", "180")
                MatchBroadcast.objects.filter(pk=b.pk).update(
                    is_live=True,
                    stream_title=stream.get("title") or "",
                    stream_game=stream.get("game_name") or "",
                    viewer_count=stream.get("viewer_count"),
                    thumbnail_url=thumbnail_url,
                    live_checked_at=now,
                )
            else:
                MatchBroadcast.objects.filter(pk=b.pk).update(is_live=False, live_checked_at=now)
    finally:
        close_old_connections()


def start_scheduler() -> None:
    global _scheduler

    interval_minutes = getattr(settings, "TWITCH_LIVE_POLL_INTERVAL_MINUTES", 0)
    if interval_minutes <= 0:
        logger.info("TWITCH_LIVE_POLL_INTERVAL_MINUTES=%s - Live-Poll deaktiviert.", interval_minutes)
        return
    if _scheduler is not None:
        return  # already running

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        _check_live_status,
        trigger="interval",
        minutes=interval_minutes,
        id="twitch_live_poll",
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info("Twitch-Live-Poll gestartet (alle %s Minuten).", interval_minutes)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
