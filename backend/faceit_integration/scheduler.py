"""In-process background scheduler for automatic FACEIT syncing.

Started from fastapi_app/main.py on app startup, stopped on shutdown. This
covers "runs automatically" without needing external cron/Task Scheduler
access - but `python manage.py sync_faceit` (see management/commands/) still
works fine as an alternative/addition for deployments that prefer OS-level
scheduling instead of (or in addition to) this.
"""

import logging
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from django.conf import settings

logger = logging.getLogger(__name__)

_scheduler: Optional[BackgroundScheduler] = None


def _run_scheduled_sync() -> None:
    from .sync import sync_all  # local import: Django must be fully set up first

    logger.info("Starte automatischen FACEIT-Sync...")
    summary = sync_all(trigger="scheduled")
    if summary.get("error"):
        logger.error("Automatischer FACEIT-Sync fehlgeschlagen: %s", summary["error"])
    else:
        logger.info("Automatischer FACEIT-Sync abgeschlossen: %s", summary)


def start_scheduler() -> None:
    global _scheduler

    interval_minutes = getattr(settings, "FACEIT_SYNC_INTERVAL_MINUTES", 0)
    if interval_minutes <= 0:
        logger.info("FACEIT_SYNC_INTERVAL_MINUTES=%s - automatischer FACEIT-Sync deaktiviert.", interval_minutes)
        return
    if _scheduler is not None:
        return  # already running

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        _run_scheduled_sync,
        trigger="interval",
        minutes=interval_minutes,
        id="faceit_sync",
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info("Automatischer FACEIT-Sync gestartet (alle %s Minuten).", interval_minutes)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
