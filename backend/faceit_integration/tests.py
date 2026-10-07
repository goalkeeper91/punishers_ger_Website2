from io import StringIO
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase

from leagues.models import League
from social_posts.models import SocialPostDraft
from teams.models import Team, TeamLeagueEntry

from .models import TeamFaceitMatch
from .sync import is_placeholder_opponent, sync_league_matches

OUR_TEAM_ID = "faceit-team-ours"


def _match(match_id: str, opponent_name: str, opponent_team_id: str) -> dict:
    return {
        "match_id": match_id,
        "competition_name": "Phase 2 Gruppe A",
        "status": "SCHEDULED",
        "scheduled_at": 1790000000,
        "teams": {
            "faction1": {"team_id": OUR_TEAM_ID, "name": "Punishers Main"},
            "faction2": {"team_id": opponent_team_id, "name": opponent_name},
        },
    }


def _client_returning(matches: list[dict]) -> MagicMock:
    client = MagicMock()
    client.get_organizer_championships.return_value = {"items": [{"championship_id": "champ-1"}]}
    client.get_championship_matches.side_effect = (
        lambda championship_id, match_type=None, offset=0, limit=50: {
            "items": matches if match_type == "upcoming" else []
        }
    )
    return client


class IsPlaceholderOpponentTests(TestCase):
    def test_detects_bye_regardless_of_case_and_whitespace(self):
        for name in ("bye", "BYE", " Bye ", "bYe"):
            self.assertTrue(is_placeholder_opponent(name), name)

    def test_real_and_missing_names_are_not_placeholders(self):
        for name in ("Rivals", "Bye Bye Birdie", "", None):
            self.assertFalse(is_placeholder_opponent(name), name)


class SyncLeagueMatchesPlaceholderTests(TestCase):
    def setUp(self):
        self.league = League.objects.create(name="DACH CS", faceit_organizer_id="org-1")
        self.team = Team.objects.create(name="Punishers Main", game="CS2")
        self.entry = TeamLeagueEntry.objects.create(
            team=self.team, league=self.league, faceit_team_id=OUR_TEAM_ID,
        )

    @patch("faceit_integration.sync.generate_social_post_draft_for_series")
    def test_bye_match_is_skipped_and_real_match_is_imported(self, draft_mock):
        client = _client_returning([
            _match("m-bye", "bye", "faceit-team-bye"),
            _match("m-real", "Rivals", "faceit-team-rivals"),
        ])

        result = sync_league_matches(self.league, client)

        self.assertEqual(result, {"created": 1, "updated": 0, "skipped_placeholders": 1})
        self.assertFalse(TeamFaceitMatch.objects.filter(faceit_match_id="m-bye").exists())
        self.assertTrue(TeamFaceitMatch.objects.filter(faceit_match_id="m-real").exists())
        # Only the real match triggers an announcement draft.
        draft_mock.assert_called_once()

    @patch("discord_bot.redis_bridge.publish_event_notification")
    @patch("faceit_integration.sync.generate_social_post_draft_for_series")
    def test_finished_bye_match_never_announces_a_result(self, draft_mock, discord_mock):
        bye = _match("m-bye", "bye", "faceit-team-bye")
        bye["status"] = "FINISHED"
        bye["results"] = {"winner": "faction1", "score": {"faction1": 1, "faction2": 0}}

        result = sync_league_matches(self.league, _client_returning([bye]))

        self.assertEqual(result["skipped_placeholders"], 1)
        self.assertEqual(TeamFaceitMatch.objects.count(), 0)
        draft_mock.assert_not_called()
        discord_mock.assert_not_called()


class PurgePlaceholderMatchesCommandTests(TestCase):
    def setUp(self):
        league = League.objects.create(name="DACH CS", faceit_organizer_id="org-1")
        self.team = Team.objects.create(name="Punishers Main", game="CS2")
        entry = TeamLeagueEntry.objects.create(team=self.team, league=league, faceit_team_id=OUR_TEAM_ID)
        self.phantom = TeamFaceitMatch.objects.create(
            league_entry=entry, faceit_match_id="m-bye", opponent_name="bye",
            raw_data=_match("m-bye", "bye", "faceit-team-bye"),
        )
        self.real = TeamFaceitMatch.objects.create(
            league_entry=entry, faceit_match_id="m-real", opponent_name="Rivals",
            raw_data=_match("m-real", "Rivals", "faceit-team-rivals"),
        )
        # A manually recorded match has no raw_data and must never be purged,
        # even if the admin typed "bye" as the opponent.
        self.manual = TeamFaceitMatch.objects.create(
            league_entry=entry, faceit_match_id="manual-1", opponent_name="bye", raw_data=None,
        )
        self.phantom_draft = SocialPostDraft.objects.create(
            team=self.team, post_type="announcement", opponent_name="bye",
        )
        self.real_draft = SocialPostDraft.objects.create(
            team=self.team, post_type="announcement", opponent_name="Rivals",
        )

    def test_dry_run_deletes_nothing(self):
        call_command("purge_placeholder_matches", stdout=StringIO())

        self.assertTrue(TeamFaceitMatch.objects.filter(pk=self.phantom.pk).exists())
        self.assertTrue(SocialPostDraft.objects.filter(pk=self.phantom_draft.pk).exists())

    def test_apply_removes_only_the_phantom_match_and_its_draft(self):
        call_command("purge_placeholder_matches", "--apply", stdout=StringIO())

        self.assertFalse(TeamFaceitMatch.objects.filter(pk=self.phantom.pk).exists())
        self.assertFalse(SocialPostDraft.objects.filter(pk=self.phantom_draft.pk).exists())
        self.assertTrue(TeamFaceitMatch.objects.filter(pk=self.real.pk).exists())
        self.assertTrue(TeamFaceitMatch.objects.filter(pk=self.manual.pk).exists())
        self.assertTrue(SocialPostDraft.objects.filter(pk=self.real_draft.pk).exists())
