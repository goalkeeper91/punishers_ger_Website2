"""The actual "handler": pulls data from FACEIT via client.FaceitClient and
upserts it into the local cache models (models.py). Every function here is
written to never raise on a per-item failure (bad ID, 404, rate limit) - a
bad player or league entry logs a warning and is skipped so a scheduled run
doesn't abort halfway through. `sync_all()` is the single entry point used
by all three trigger paths:

- management command (`python manage.py sync_faceit`)
- in-process scheduler (faceit_integration/scheduler.py)
- manual admin API trigger (POST /admin/faceit/sync/ in fastapi_app/main.py)
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from django.conf import settings
from django.utils import timezone as dj_timezone

from leagues.models import League
from teams.models import Player, TeamLeagueEntry

from .client import FaceitClient, FaceitAPIError
from .models import FaceitSyncRun, PlayerFaceitStats, TeamFaceitMatch, PlayerMatchStats

logger = logging.getLogger(__name__)

MAX_MATCH_PAGES = 10  # safety cap: 10 * 50 = 500 matches per type per championship
MAX_CHAMPIONSHIP_PAGES = 5  # safety cap: 5 * 50 = 250 seasons per organizer
MAX_MATCH_STATS_PER_RUN = 30  # safety cap: detailed match-stats calls are one HTTP request each


def _parse_timestamp(value) -> Optional[datetime]:
    """FACEIT timestamps are unix seconds."""
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _safe_int(value) -> Optional[int]:
    try:
        return int(float(value)) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_float(value) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _map_match_status(raw_status: Optional[str]) -> str:
    status = (raw_status or "").upper()
    if status == "FINISHED":
        return "finished"
    if status in ("CANCELLED", "ABORTED"):
        return "cancelled"
    if status in ("ONGOING", "READY", "VOTING", "CONFIGURING"):
        return "ongoing"
    return "upcoming"


def _extract_our_faction_key(match: dict, faceit_team_id: str) -> Optional[str]:
    """Find which of the match's two factions (faction1/faction2) is us."""
    for faction_key, faction_data in (match.get("teams") or {}).items():
        team_id = faction_data.get("team_id") or faction_data.get("faction_id")
        if team_id == faceit_team_id:
            return faction_key
    return None


def _extract_map_name(match: dict) -> Optional[str]:
    """Best-effort: the map actually played after veto, e.g. 'de_mirage'.
    FACEIT match objects carry this under voting.map.pick (a list; the
    picked/decider map is the first entry). Not guaranteed to be present on
    every match payload (e.g. matches that never got voting data) - stays
    None then, same graceful-degradation approach as everywhere else here.
    This is the only thing team-level stats track (see fastapi_app/main.py
    /stats/ endpoints); no other per-match team stats are derived."""
    picks = ((match.get("voting") or {}).get("map") or {}).get("pick") or []
    return picks[0] if picks else None


# =====================================================================
# Players
# =====================================================================

def sync_player_stats(player: Player, client: FaceitClient, game_id: Optional[str] = None) -> bool:
    """Fetch and upsert one player's FACEIT stats. Returns True/False;
    never raises so a caller can loop over many players safely."""
    game_id = game_id or settings.FACEIT_DEFAULT_GAME_ID
    stats_obj, _ = PlayerFaceitStats.objects.get_or_create(player=player, defaults={"game_id": game_id})

    try:
        profile = client.get_player(player.faceit_player_id)
        lifetime_stats = client.get_player_stats(player.faceit_player_id, game_id)
    except FaceitAPIError as exc:
        logger.warning(
            "FACEIT-Sync fehlgeschlagen für Spieler '%s' (faceit_player_id=%s): %s",
            player.ingame_name, player.faceit_player_id, exc,
        )
        stats_obj.last_sync_error = str(exc)
        stats_obj.save(update_fields=["last_sync_error"])
        return False

    lifetime = lifetime_stats.get("lifetime", {})
    game_info = (profile.get("games") or {}).get(game_id, {})

    stats_obj.game_id = game_id
    stats_obj.nickname = profile.get("nickname")
    stats_obj.skill_level = game_info.get("skill_level")
    stats_obj.faceit_elo = game_info.get("faceit_elo")
    stats_obj.matches = _safe_int(lifetime.get("Matches"))
    stats_obj.win_rate_percent = _safe_float(lifetime.get("Win Rate %"))
    stats_obj.avg_kd_ratio = _safe_float(lifetime.get("Average K/D Ratio"))
    stats_obj.avg_headshots_percent = _safe_float(lifetime.get("Average Headshots %"))
    stats_obj.raw_data = {"profile": profile, "stats": lifetime_stats}
    stats_obj.last_synced_at = dj_timezone.now()
    stats_obj.last_sync_error = None
    stats_obj.save()
    return True


def sync_all_players(client: FaceitClient, game_id: Optional[str] = None) -> dict:
    players = Player.objects.exclude(faceit_player_id__isnull=True).exclude(faceit_player_id="")
    succeeded = failed = 0
    for player in players:
        if sync_player_stats(player, client, game_id=game_id):
            succeeded += 1
        else:
            failed += 1
    return {"players_synced": succeeded, "players_failed": failed}


# =====================================================================
# Team matches: League -> FACEIT organizer -> championships (seasons) ->
# matches, then filtered against our own teams' faceit_team_id per league.
# =====================================================================

def _get_league_championships(league: League, client: FaceitClient, game_id: Optional[str] = None) -> list[dict]:
    """All championships (seasons) a league's FACEIT organizer has run."""
    game_id = game_id or settings.FACEIT_DEFAULT_GAME_ID
    championships: list[dict] = []
    offset = 0
    for _ in range(MAX_CHAMPIONSHIP_PAGES):
        page = client.get_organizer_championships(league.faceit_organizer_id, game_id=game_id, offset=offset, limit=50)
        items = page.get("items", [])
        championships.extend(items)
        if len(items) < 50:
            break
        offset += 50
    return championships


def _get_championship_matches(championship_id: str, client: FaceitClient) -> list[dict]:
    matches: list[dict] = []
    for match_type in ("upcoming", "past"):
        offset = 0
        for _ in range(MAX_MATCH_PAGES):
            page = client.get_championship_matches(championship_id, match_type=match_type, offset=offset, limit=50)
            items = page.get("items", [])
            matches.extend(items)
            if len(items) < 50:
                break
            offset += 50
    return matches


def sync_league_matches(league: League, client: FaceitClient) -> dict:
    """Fetch every season (championship) run by this league's FACEIT
    organizer, then match each championship's games against all of our teams
    registered in this league (TeamLeagueEntry.faceit_team_id). Returns a
    summary dict; never raises."""
    if not league.faceit_organizer_id:
        logger.warning("Liga '%s' hat keine faceit_organizer_id - übersprungen.", league.name)
        return {"created": 0, "updated": 0, "error": "league has no faceit_organizer_id"}

    entries = list(
        TeamLeagueEntry.objects.filter(league=league)
        .exclude(faceit_team_id__isnull=True)
        .exclude(faceit_team_id="")
        .select_related("team")
    )
    if not entries:
        logger.info("Liga '%s' hat keine Teams mit faceit_team_id - übersprungen.", league.name)
        return {"created": 0, "updated": 0, "error": "no team entries with faceit_team_id"}

    try:
        championships = _get_league_championships(league, client)
        all_matches: list[dict] = []
        for championship in championships:
            championship_id = championship.get("championship_id") or championship.get("competition_id")
            if not championship_id:
                continue
            all_matches.extend(_get_championship_matches(championship_id, client))
    except FaceitAPIError as exc:
        logger.warning("FACEIT-Match-Sync fehlgeschlagen für Liga '%s': %s", league.name, exc)
        return {"created": 0, "updated": 0, "error": str(exc)}

    created = updated = 0
    for match in all_matches:
        match_id = match.get("match_id")
        if not match_id:
            continue

        # A match can involve at most one of our teams per league; check
        # each of our entries in this league until one matches a faction.
        for entry in entries:
            our_key = _extract_our_faction_key(match, entry.faceit_team_id)
            if our_key is None:
                continue

            opponent_key = "faction2" if our_key == "faction1" else "faction1"
            opponent_data = (match.get("teams") or {}).get(opponent_key, {})
            results = match.get("results") or {}
            score = results.get("score") or {}
            winner = results.get("winner")

            _, was_created = TeamFaceitMatch.objects.update_or_create(
                faceit_match_id=match_id,
                defaults=dict(
                    league_entry=entry,
                    competition_name=match.get("competition_name"),
                    status=_map_match_status(match.get("status")),
                    scheduled_at=_parse_timestamp(match.get("scheduled_at") or match.get("configured_at")),
                    finished_at=_parse_timestamp(match.get("finished_at")),
                    opponent_name=opponent_data.get("name"),
                    team_score=_safe_int(score.get(our_key)),
                    opponent_score=_safe_int(score.get(opponent_key)),
                    result=("win" if winner == our_key else "loss") if winner else None,
                    map_name=_extract_map_name(match),
                    raw_data=match,
                    last_synced_at=dj_timezone.now(),
                ),
            )
            if was_created:
                created += 1
            else:
                updated += 1
            break  # found the entry this match belongs to, no need to check the rest

    return {"created": created, "updated": updated}


def sync_all_team_matches(client: FaceitClient) -> dict:
    leagues = League.objects.exclude(faceit_organizer_id__isnull=True).exclude(faceit_organizer_id="")
    created_total = updated_total = failed = 0
    for league in leagues:
        result = sync_league_matches(league, client)
        created_total += result.get("created", 0)
        updated_total += result.get("updated", 0)
        if result.get("error"):
            failed += 1
    return {
        "matches_created": created_total,
        "matches_updated": updated_total,
        "league_entries_failed": failed,
    }


# =====================================================================
# Detailed per-match player stats (K/D, headshots, multi-kills, and the
# "advanced stats" FACEIT added for CS2: utility damage, flash count/
# successes, enemies flashed, entry count/wins, 1v1/1v2 clutches). Only for
# our own roster - opponents' numbers are never stored.
# =====================================================================

def _find_player_stats_in_match(stats_response: dict, faceit_player_id: str) -> Optional[dict]:
    """FACEIT nests /matches/{id}/stats as rounds -> teams -> players. Finds
    the (round, player) pair for one player_id, or None if absent."""
    for round_data in stats_response.get("rounds") or []:
        for team in round_data.get("teams") or []:
            for player in team.get("players") or []:
                if player.get("player_id") == faceit_player_id:
                    return {"round": round_data, "player": player}
    return None


def _round_map_name(round_data: dict) -> Optional[str]:
    return (round_data.get("round_stats") or {}).get("Map")


def sync_match_player_stats(match: TeamFaceitMatch, client: FaceitClient) -> int:
    """Fetch detailed per-player stats for one finished match and store a
    PlayerMatchStats row for every one of our own roster players who played
    in it. Never raises - a failed API call just means 0 rows written, the
    caller (sync_all_match_player_stats) moves on to the next match. Returns
    how many rows were written."""
    our_players = list(
        Player.objects.filter(team=match.league_entry.team)
        .exclude(faceit_player_id__isnull=True).exclude(faceit_player_id="")
    )
    if not our_players:
        return 0

    try:
        stats_response = client.get_match_stats(match.faceit_match_id)
    except FaceitAPIError as exc:
        logger.warning("Match-Stats-Sync fehlgeschlagen für Match %s: %s", match.faceit_match_id, exc)
        return 0

    written = 0
    map_name_from_stats = None
    for player in our_players:
        found = _find_player_stats_in_match(stats_response, player.faceit_player_id)
        if not found:
            continue
        round_data, player_data = found["round"], found["player"]
        map_name_from_stats = map_name_from_stats or _round_map_name(round_data)
        p_stats = player_data.get("player_stats") or {}

        PlayerMatchStats.objects.update_or_create(
            player=player, match=match,
            defaults=dict(
                kills=_safe_int(p_stats.get("Kills")),
                deaths=_safe_int(p_stats.get("Deaths")),
                assists=_safe_int(p_stats.get("Assists")),
                kd_ratio=_safe_float(p_stats.get("K/D Ratio")),
                kr_ratio=_safe_float(p_stats.get("K/R Ratio")),
                headshots=_safe_int(p_stats.get("Headshots")),
                headshots_percent=_safe_float(p_stats.get("Headshots %")),
                mvps=_safe_int(p_stats.get("MVPs")),
                triple_kills=_safe_int(p_stats.get("Triple Kills")),
                quadro_kills=_safe_int(p_stats.get("Quadro Kills")),
                penta_kills=_safe_int(p_stats.get("Penta Kills")),
                utility_damage=_safe_float(p_stats.get("Utility Damage")),
                utility_successes=_safe_int(p_stats.get("Utility Successes")),
                utility_count=_safe_int(p_stats.get("Utility Count")),
                flash_count=_safe_int(p_stats.get("Flash Count")),
                flash_successes=_safe_int(p_stats.get("Flash Successes")),
                enemies_flashed=_safe_int(p_stats.get("Enemies Flashed")),
                entry_count=_safe_int(p_stats.get("Entry Count")),
                entry_wins=_safe_int(p_stats.get("Entry Wins")),
                clutch_1v1_count=_safe_int(p_stats.get("1v1Count")),
                clutch_1v1_wins=_safe_int(p_stats.get("1v1Wins")),
                clutch_1v2_count=_safe_int(p_stats.get("1v2Count")),
                clutch_1v2_wins=_safe_int(p_stats.get("1v2Wins")),
                result=match.result,
                raw_data=player_data,
                last_synced_at=dj_timezone.now(),
            ),
        )
        written += 1

    # The map veto pick (used for TeamFaceitMatch.map_name, see
    # sync_league_matches) is a *prediction* of what will be played; the
    # finished match's own stats response is authoritative, so backfill it.
    if map_name_from_stats and match.map_name != map_name_from_stats:
        match.map_name = map_name_from_stats
        match.save(update_fields=["map_name"])

    return written


def sync_all_match_player_stats(client: FaceitClient) -> dict:
    """For every finished match that doesn't have detailed player stats yet,
    fetch and store them (capped per run - see MAX_MATCH_STATS_PER_RUN - so
    a large backlog can't blow through FACEIT's rate limits in one cycle;
    the remainder simply gets picked up on the next scheduled/manual sync)."""
    matches = (
        TeamFaceitMatch.objects.filter(status='finished')
        .exclude(id__in=PlayerMatchStats.objects.values_list('match_id', flat=True).distinct())
        .select_related('league_entry__team')
        .order_by('-finished_at')[:MAX_MATCH_STATS_PER_RUN]
    )
    synced = failed = 0
    for match in matches:
        try:
            written = sync_match_player_stats(match, client)
            synced += 1 if written else 0
        except Exception:
            failed += 1
            logger.exception("Unerwarteter Fehler beim Match-Stats-Sync für Match %s", match.faceit_match_id)
    return {"player_match_stats_synced": synced, "player_match_stats_failed": failed}


# =====================================================================
# Top-level entry point
# =====================================================================

def sync_all(trigger: str = "manual") -> dict:
    """Sync every player with a faceit_player_id, and every league with a
    faceit_organizer_id (matches for all of that league's teams with a
    faceit_team_id set). Records a FaceitSyncRun either way so the admin
    dashboard can show when the last run happened."""
    run = FaceitSyncRun.objects.create(trigger=trigger)

    try:
        client = FaceitClient()
    except FaceitAPIError as exc:
        run.error = str(exc)
        run.finished_at = dj_timezone.now()
        run.save()
        return {"error": str(exc), "run_id": run.id}

    player_summary = sync_all_players(client)
    match_summary = sync_all_team_matches(client)
    # Needs TeamFaceitMatch rows to exist first, hence run after match sync.
    match_stats_summary = sync_all_match_player_stats(client)

    run.players_synced = player_summary["players_synced"]
    run.players_failed = player_summary["players_failed"]
    run.matches_synced = match_summary["matches_created"] + match_summary["matches_updated"]
    run.league_entries_failed = match_summary["league_entries_failed"]
    run.player_match_stats_synced = match_stats_summary["player_match_stats_synced"]
    run.player_match_stats_failed = match_stats_summary["player_match_stats_failed"]
    run.finished_at = dj_timezone.now()
    run.save()

    return {**player_summary, **match_summary, **match_stats_summary, "run_id": run.id}
