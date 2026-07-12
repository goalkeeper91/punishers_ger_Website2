"""In-process background scheduler for automatic social-stats syncing.
Mirrors faceit_integration/scheduler.py - started from fastapi_app/main.py
on app startup, stopped on shutdown."""

import logging
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from django.conf import settings

logger = logging.getLogger(__name__)

_scheduler: Optional[BackgroundScheduler] = None


def _run_scheduled_sync() -> None:
    from .sync import sync_all  # local import: Django must be fully set up first

    logger.info("Starte automatischen Social-Stats-Sync...")
    summary = sync_all(trigger="scheduled")
    logger.info("Automatischer Social-Stats-Sync abgeschlossen: %s", summary)


def start_scheduler() -> None:
    global _scheduler

    interval_minutes = getattr(settings, "SOCIAL_STATS_SYNC_INTERVAL_MINUTES", 0)
    if interval_minutes <= 0:
        logger.info("SOCIAL_STATS_SYNC_INTERVAL_MINUTES=%s - automatischer Social-Stats-Sync deaktiviert.", interval_minutes)
        return
    if _scheduler is not None:
        return  # already running

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        _run_scheduled_sync,
        trigger="interval",
        minutes=interval_minutes,
        id="social_stats_sync",
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info("Automatischer Social-Stats-Sync gestartet (alle %s Minuten).", interval_minutes)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
