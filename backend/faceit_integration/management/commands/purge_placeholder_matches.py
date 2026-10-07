import json

from django.core.management.base import BaseCommand
from django.db import transaction

from faceit_integration.models import TeamFaceitMatch
from faceit_integration.sync import is_placeholder_opponent
from social_posts.models import SocialPostDraft


class Command(BaseCommand):
    help = (
        "Findet FACEIT-Platzhalter-Matches (Gegner 'bye', siehe "
        "faceit_integration.sync.is_placeholder_opponent), die vor dem Sync-Guard "
        "importiert wurden, und entfernt sie samt der zugehörigen Social-Post-Entwürfe "
        "(die hängen bewusst nicht per FK am Match, bleiben also sonst liegen). "
        "Standardmäßig nur Dry-Run - erst mit --apply wird gelöscht."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Tatsächlich löschen (ohne: nur anzeigen).")

    def handle(self, *args, **options):
        # raw_data is only set for FACEIT-synced rows - a manually recorded
        # match (raw_data is None) is the admin's own entry and never touched.
        matches = [
            m for m in TeamFaceitMatch.objects.filter(raw_data__isnull=False).select_related("league_entry__team")
            if is_placeholder_opponent(m.opponent_name)
        ]
        team_ids = {m.league_entry.team_id for m in matches}
        drafts = [
            d for d in SocialPostDraft.objects.filter(team_id__in=team_ids)
            if is_placeholder_opponent(d.opponent_name)
        ]

        if not matches and not drafts:
            self.stdout.write(self.style.SUCCESS("Keine Platzhalter-Matches oder -Entwürfe gefunden."))
            return

        for m in matches:
            self.stdout.write(
                f"Match #{m.id} {m.league_entry.team.name} vs {m.opponent_name} | {m.status} | "
                f"geplant {m.scheduled_at} | faceit_match_id={m.faceit_match_id} | "
                f"{m.player_stats.count()} Spieler-Stats"
            )
            self.stdout.write("  teams-Payload: " + json.dumps((m.raw_data or {}).get("teams"), ensure_ascii=False))
        for d in drafts:
            self.stdout.write(f"Social-Entwurf #{d.id} ({d.get_post_type_display()}) {d.team.name} vs {d.opponent_name}")

        if not options["apply"]:
            self.stdout.write(self.style.WARNING(
                f"Dry-Run: {len(matches)} Match(es), {len(drafts)} Entwurf/Entwürfe würden gelöscht. Mit --apply ausführen."
            ))
            return

        with transaction.atomic():
            for d in drafts:
                d.delete()
            for m in matches:
                m.delete()
        self.stdout.write(self.style.SUCCESS(f"Gelöscht: {len(matches)} Match(es), {len(drafts)} Entwurf/Entwürfe."))
