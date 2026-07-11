from django.core.management.base import BaseCommand

from faceit_integration.sync import sync_all


class Command(BaseCommand):
    help = (
        "Synchronisiert Spieler-Statistiken und Team-Matches von FACEIT. "
        "Für automatische Läufe per cron / Windows Task Scheduler geeignet, "
        "z.B.: python manage.py sync_faceit"
    )

    def handle(self, *args, **options):
        summary = sync_all(trigger="command")

        if summary.get("error"):
            self.stderr.write(self.style.ERROR(f"FACEIT-Sync fehlgeschlagen: {summary['error']}"))
            return

        self.stdout.write(self.style.SUCCESS(
            "FACEIT-Sync abgeschlossen: "
            f"{summary['players_synced']} Spieler synchronisiert, {summary['players_failed']} fehlgeschlagen; "
            f"{summary['matches_created']} Matches neu, {summary['matches_updated']} aktualisiert, "
            f"{summary['league_entries_failed']} Team-Liga-Zuordnungen fehlgeschlagen; "
            f"{summary['player_match_stats_synced']} Spieler-Match-Statistiken synchronisiert, "
            f"{summary['player_match_stats_failed']} fehlgeschlagen."
        ))
