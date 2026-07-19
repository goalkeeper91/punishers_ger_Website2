"""Deletes CS2 Pracc demo files past their retention window
(GAMESERVER_DEMO_RETENTION_DAYS, default 14 days after upload). The demo
stops being downloadable after GAMESERVER_DEMO_DOWNLOAD_DAYS (7) via
fastapi_app/main.py's GET /gameservers/praccs/{id}/demo/, but the file itself
sticks around on disk for this longer grace period before this actually
removes it - see management/commands/cleanup_expired_demos.py, which just
calls the function below (same "plain function + thin command wrapper"
shape as faceit_integration/sync.py's sync_all())."""

import logging
import os
from datetime import datetime, timedelta, timezone

from django.conf import settings

from .models import Pracc

logger = logging.getLogger(__name__)


def cleanup_expired_demos() -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.GAMESERVER_DEMO_RETENTION_DAYS)
    praccs = list(
        Pracc.objects.exclude(demo_filename__isnull=True)
        .exclude(demo_filename="")
        .filter(demo_uploaded_at__lt=cutoff)
    )

    deleted = 0
    failed = 0
    for pracc in praccs:
        file_path = os.path.join(settings.GAMESERVER_DEMOS_ROOT, pracc.demo_filename)
        try:
            if os.path.isfile(file_path):
                os.remove(file_path)
            pracc.demo_filename = None
            pracc.demo_uploaded_at = None
            pracc.save(update_fields=['demo_filename', 'demo_uploaded_at'])
            deleted += 1
        except OSError as exc:
            logger.error("Demo-Löschung fehlgeschlagen für Pracc %s: %s", pracc.id, exc)
            failed += 1

    return {"checked": len(praccs), "deleted": deleted, "failed": failed}
