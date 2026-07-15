"""In-process periodic re-push of guild config (Join-to-Create triggers +
reaction-roles) to the Discord bot. Mirrors faceit_integration/scheduler.py's
shape. Exists because Redis pub/sub has no replay: a bot that restarts after
the last dashboard save would otherwise never see the current config again
until an admin re-saves something - this closes that gap by re-publishing
on an interval regardless of whether anything changed.
"""

import logging
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from django.conf import settings

logger = logging.getLogger(__name__)

_scheduler: Optional[BackgroundScheduler] = None


def _run_config_sync() -> None:
    from django.db import close_old_connections
    from .models import DiscordGuild
    from .redis_bridge import publish_guild_config

    close_old_connections()
    try:
        guilds = list(DiscordGuild.objects.filter(is_active=True))
        for guild in guilds:
            publish_guild_config(guild)
        logger.info("Discord-Config-Sync abgeschlossen (%s Server).", len(guilds))
    finally:
        close_old_connections()


def start_scheduler() -> None:
    global _scheduler

    interval_minutes = getattr(settings, "DISCORD_CONFIG_SYNC_INTERVAL_MINUTES", 0)
    if interval_minutes <= 0:
        logger.info("DISCORD_CONFIG_SYNC_INTERVAL_MINUTES=%s - Discord-Config-Sync deaktiviert.", interval_minutes)
        return
    if _scheduler is not None:
        return  # already running

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        _run_config_sync,
        trigger="interval",
        minutes=interval_minutes,
        id="discord_config_sync",
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info("Discord-Config-Sync gestartet (alle %s Minuten).", interval_minutes)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
