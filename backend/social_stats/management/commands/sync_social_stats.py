from django.core.management.base import BaseCommand

from social_stats.sync import sync_all


class Command(BaseCommand):
    help = (
        "Synchronisiert Social-Media-Reichweite (YouTube-Abos/Views, Discord-Mitgliederzahl) "
        "für Org-Kanäle und Spieler. Für automatische Läufe per cron / Windows Task Scheduler "
        "geeignet, z.B.: python manage.py sync_social_stats"
    )

    def handle(self, *args, **options):
        summary = sync_all(trigger="command")
        self.stdout.write(self.style.SUCCESS(
            "Social-Stats-Sync abgeschlossen: "
            f"{summary['org_channels_synced']} Org-Kanäle synchronisiert, {summary['org_channels_failed']} fehlgeschlagen; "
            f"{summary['player_channels_synced']} Spieler-Kanäle synchronisiert, {summary['player_channels_failed']} fehlgeschlagen."
        ))
