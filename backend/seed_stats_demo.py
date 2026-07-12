"""One-off demo-data seeder for the /stats pages. Not part of the app; run
once via `python seed_stats_demo.py` and clean up afterwards."""
import os
import random
from datetime import timedelta

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "punishers_ger.settings")
django.setup()

from django.utils import timezone

from teams.models import Team, Player, TeamLeagueEntry
from leagues.models import League
from users.models import CustomUser, ROLE_TEAM_MANAGER
from faceit_integration.models import PlayerFaceitStats, TeamFaceitMatch, PlayerMatchStats
from django.contrib.auth.models import Group

random.seed(42)

MAPS = ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis"]
OPPONENTS = ["Rival Squad", "Nova Esports", "Iron Wolves", "Titan Gaming", "Phoenix Rising", "Shadow Corp"]

league, _ = League.objects.get_or_create(
    name="ESL Pro League Season 20", defaults={"short_name": "ESL Pro"}
)

def make_team(name, is_main, roster):
    team, _ = Team.objects.get_or_create(name=name, defaults={"game": "Counter-Strike 2", "is_main_team": is_main})
    entry, _ = TeamLeagueEntry.objects.get_or_create(team=team, league=league)

    players = []
    for i, (ingame_name, role, elo, skill_level) in enumerate(roster):
        email = f"{ingame_name.lower()}@demo.punishers.gg"
        user, created = CustomUser.objects.get_or_create(
            email=email,
            defaults={"username": ingame_name.lower(), "first_name": ingame_name, "team": team},
        )
        if created:
            user.set_password("DemoPass123!")
            user.save()
        player, _ = Player.objects.get_or_create(
            user=user,
            defaults={"team": team, "ingame_name": ingame_name, "role": role, "faceit_player_id": f"demo-{name}-{i}"},
        )
        if not player.faceit_player_id:
            player.faceit_player_id = f"demo-{name}-{i}"
            player.team = team
            player.save()

        matches_played = random.randint(80, 220)
        win_rate = round(random.uniform(48, 68), 1)
        kd = round(random.uniform(0.85, 1.45), 2)
        hs = round(random.uniform(35, 58), 1)
        PlayerFaceitStats.objects.update_or_create(
            player=player,
            defaults={
                "game_id": "cs2",
                "nickname": ingame_name,
                "skill_level": skill_level,
                "faceit_elo": elo,
                "matches": matches_played,
                "win_rate_percent": win_rate,
                "avg_kd_ratio": kd,
                "avg_headshots_percent": hs,
                "last_synced_at": timezone.now(),
            },
        )
        players.append(player)

    # Finished matches for this team, spread over the last ~6 weeks.
    matches = []
    for m in range(10):
        map_name = random.choice(MAPS)
        opponent = random.choice(OPPONENTS)
        team_score = random.choice([16, 16, 13, 10])
        opp_score = random.choice([14, 10, 16, 8])
        result = "win" if team_score > opp_score else "loss"
        # keep scores consistent with result
        if result == "win" and team_score <= opp_score:
            team_score, opp_score = opp_score, team_score
        if result == "loss" and team_score >= opp_score:
            team_score, opp_score = opp_score, team_score
        finished_at = timezone.now() - timedelta(days=random.randint(1, 42))
        match, _ = TeamFaceitMatch.objects.update_or_create(
            faceit_match_id=f"demo-{name}-match-{m}",
            defaults={
                "league_entry": entry,
                "competition_name": league.name,
                "status": "finished",
                "scheduled_at": finished_at,
                "finished_at": finished_at,
                "opponent_name": opponent,
                "team_score": team_score,
                "opponent_score": opp_score,
                "result": result,
                "map_name": map_name,
            },
        )
        matches.append((match, result))

    # Per-match player stats for a subset of matches, for each player.
    for match, result in matches[:6]:
        for player in players:
            kills = random.randint(8, 30)
            deaths = random.randint(8, 26)
            assists = random.randint(1, 9)
            headshots = random.randint(0, kills)
            PlayerMatchStats.objects.update_or_create(
                player=player,
                match=match,
                defaults={
                    "kills": kills,
                    "deaths": deaths,
                    "assists": assists,
                    "kd_ratio": round(kills / max(deaths, 1), 2),
                    "kr_ratio": round(kills / 27, 2),
                    "headshots": headshots,
                    "headshots_percent": round((headshots / max(kills, 1)) * 100, 1),
                    "mvps": random.randint(0, 4),
                    "triple_kills": random.randint(0, 2),
                    "quadro_kills": random.randint(0, 1),
                    "penta_kills": 1 if random.random() > 0.92 else 0,
                    "utility_damage": round(random.uniform(20, 140), 1),
                    "utility_successes": random.randint(1, 6),
                    "utility_count": random.randint(4, 8),
                    "flash_count": random.randint(2, 6),
                    "flash_successes": random.randint(1, 5),
                    "enemies_flashed": random.randint(1, 9),
                    "entry_count": random.randint(1, 6),
                    "entry_wins": random.randint(0, 4),
                    "clutch_1v1_count": random.randint(0, 3),
                    "clutch_1v1_wins": random.randint(0, 2),
                    "clutch_1v2_count": random.randint(0, 2),
                    "clutch_1v2_wins": random.randint(0, 1),
                    "result": result,
                    "last_synced_at": timezone.now(),
                },
            )

    return team, players


main_team, main_players = make_team(
    "Punishers Main",
    True,
    [
        ("Shockwave", "AWPer", 2450, 10),
        ("Vantage", "Entry Fragger", 2180, 9),
        ("Nullify", "Support", 1990, 8),
        ("Reaper", "IGL", 2050, 9),
        ("Ghost_", "Lurker", 2310, 9),
    ],
)

academy_team, academy_players = make_team(
    "Punishers Academy",
    False,
    [
        ("Ricochet", "AWPer", 1620, 6),
        ("Blitz", "Entry Fragger", 1540, 6),
        ("Fable", "Support", 1480, 5),
    ],
)

# Captain account: Teammanager role, assigned to Punishers Main.
captain_email = "captain.demo@punishers.gg"
captain, created = CustomUser.objects.get_or_create(
    email=captain_email, defaults={"username": "captain_demo", "first_name": "Captain", "team": main_team}
)
if created:
    captain.set_password("DemoPass123!")
    captain.save()
else:
    captain.team = main_team
    captain.save()
tm_group = Group.objects.get(name=ROLE_TEAM_MANAGER)
captain.groups.add(tm_group)

print("Demo data created:")
print(" Teams:", Team.objects.count())
print(" Players:", Player.objects.count())
print(" PlayerFaceitStats:", PlayerFaceitStats.objects.count())
print(" TeamFaceitMatch:", TeamFaceitMatch.objects.count())
print(" PlayerMatchStats:", PlayerMatchStats.objects.count())
print(" Captain login:", captain_email, "/ DemoPass123!")
print(" A player login (Punishers Main):", main_players[0].user.email, "/ DemoPass123!")
