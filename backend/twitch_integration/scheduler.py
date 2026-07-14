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
    from users.models import CustomUser
    from discord_bot.models import DiscordGuild, AnnouncementChannelMapping
    from discord_bot.redis_bridge import publish_notification
    from .client import TwitchClient, TwitchAPIError, extract_twitch_login

    close_old_connections()
    try:
        creators = list(CustomUser.objects.filter(is_content_creator=True).exclude(twitch_link=""))
        logins_by_user_id = {}
        for creator in creators:
            login = extract_twitch_login(creator.twitch_link)
            if login:
                logins_by_user_id[creator.id] = login
        if not logins_by_user_id:
            return

        try:
            client = TwitchClient()
            live_by_login = client.get_live_streams(list(logins_by_user_id.values()))
        except TwitchAPIError as exc:
            logger.warning("Twitch-Live-Poll fehlgeschlagen: %s", exc)
            return

        stream_live_mappings = list(
            AnnouncementChannelMapping.objects.filter(event_type="stream_live", guild__is_active=True)
            .select_related("guild")
        )

        for creator in creators:
            login = logins_by_user_id.get(creator.id)
            is_live_now = bool(login and login.lower() in live_by_login)

            if is_live_now and not creator.last_known_live:
                stream = live_by_login[login.lower()]
                for mapping in stream_live_mappings:
                    publish_notification(
                        event_type="stream_live",
                        guild=mapping.guild,
                        channel_id=mapping.channel_id,
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
