from django.core.management.base import BaseCommand

from gameservers.demo_cleanup import cleanup_expired_demos


class Command(BaseCommand):
    help = (
        "Löscht CS2-Pracc-Demo-Dateien, deren Aufbewahrungsfrist "
        "(GAMESERVER_DEMO_RETENTION_DAYS, Standard 14 Tage nach Hochladen) "
        "abgelaufen ist. Für automatische Läufe per cron / Windows Task "
        "Scheduler geeignet, z.B.: python manage.py cleanup_expired_demos"
    )

    def handle(self, *args, **options):
        summary = cleanup_expired_demos()
        self.stdout.write(self.style.SUCCESS(
            f"Demo-Bereinigung abgeschlossen: {summary['deleted']} gelöscht, "
            f"{summary['failed']} fehlgeschlagen (von {summary['checked']} geprüft)."
        ))
