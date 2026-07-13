from django.db import models
from django.db.models import Q


class PlayerFaceitStats(models.Model):
    """Cached snapshot of a player's FACEIT stats, refreshed by the sync
    handler (see faceit_integration/sync.py). Kept separate from
    teams.Player so re-syncing never touches player-managed profile fields."""

    player = models.OneToOneField(
        'teams.Player', on_delete=models.CASCADE, related_name='faceit_stats'
    )
    game_id = models.CharField(max_length=32, default='cs2', help_text="FACEIT game ID, z.B. 'cs2'.")
    nickname = models.CharField(max_length=100, blank=True, null=True)
    skill_level = models.PositiveSmallIntegerField(blank=True, null=True)
    faceit_elo = models.PositiveIntegerField(blank=True, null=True)
    matches = models.PositiveIntegerField(blank=True, null=True)
    win_rate_percent = models.FloatField(blank=True, null=True)
    avg_kd_ratio = models.FloatField(blank=True, null=True)
    avg_headshots_percent = models.FloatField(blank=True, null=True)
    raw_data = models.JSONField(blank=True, null=True, help_text="Vollständige zuletzt abgerufene FACEIT-API-Antwort, für spätere Auswertungen.")
    last_synced_at = models.DateTimeField(blank=True, null=True)
    last_sync_error = models.TextField(blank=True, null=True)

    class Meta:
        verbose_name = "FACEIT Spieler-Statistik"
        verbose_name_plural = "FACEIT Spieler-Statistiken"

    def __str__(self):
        return f"FACEIT-Stats: {self.player.ingame_name}"


class TeamFaceitMatch(models.Model):
    """A single match (upcoming or past) for a team's league entry, synced
    from the FACEIT championship the league is registered under."""

    STATUS_CHOICES = [
        ('upcoming', 'Bevorstehend'),
        ('ongoing', 'Laufend'),
        ('finished', 'Beendet'),
        ('cancelled', 'Abgesagt'),
    ]
    RESULT_CHOICES = [
        ('win', 'Sieg'),
        ('loss', 'Niederlage'),
        ('draw', 'Unentschieden'),
    ]

    league_entry = models.ForeignKey(
        'teams.TeamLeagueEntry', on_delete=models.CASCADE, related_name='matches'
    )
    faceit_match_id = models.CharField(max_length=64, unique=True)
    competition_name = models.CharField(max_length=200, blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='upcoming')
    scheduled_at = models.DateTimeField(blank=True, null=True)
    finished_at = models.DateTimeField(blank=True, null=True)
    opponent_name = models.CharField(max_length=200, blank=True, null=True)
    team_score = models.PositiveIntegerField(blank=True, null=True)
    opponent_score = models.PositiveIntegerField(blank=True, null=True)
    result = models.CharField(max_length=10, choices=RESULT_CHOICES, blank=True, null=True)
    map_name = models.CharField(
        max_length=100, blank=True, null=True,
        help_text="Gespielte Map, falls von FACEIT verfügbar (z.B. 'de_mirage'). Basis für die Team-Map-Statistiken.",
    )
    raw_data = models.JSONField(blank=True, null=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        verbose_name = "FACEIT Match"
        verbose_name_plural = "FACEIT Matches"
        ordering = ['-scheduled_at']

    def __str__(self):
        return f"{self.league_entry} vs {self.opponent_name or '?'} ({self.status})"


class PlayerFaceitMatch(models.Model):
    """A single match from a teamless player's own FACEIT match history
    (synced via GET /players/{id}/history), not tied to any team/league
    entry. Mirrors TeamFaceitMatch's shape so PlayerMatchStats can point at
    either one - see PlayerMatchStats.solo_match. Only ever populated for
    players with no team (see sync.py sync_all_solo_matches), so a team
    player's league matches are never double-counted here too."""

    player = models.ForeignKey('teams.Player', on_delete=models.CASCADE, related_name='solo_matches')
    # Not globally unique: two teamless players could play the same real
    # FACEIT match together, each getting their own row for it (unlike
    # TeamFaceitMatch, which is genuinely one row per match since it's
    # always scoped to a single team's perspective).
    faceit_match_id = models.CharField(max_length=64)
    competition_name = models.CharField(max_length=200, blank=True, null=True)
    status = models.CharField(max_length=20, choices=TeamFaceitMatch.STATUS_CHOICES, default='upcoming')
    scheduled_at = models.DateTimeField(blank=True, null=True)
    finished_at = models.DateTimeField(blank=True, null=True)
    opponent_name = models.CharField(max_length=200, blank=True, null=True)
    player_score = models.PositiveIntegerField(blank=True, null=True)
    opponent_score = models.PositiveIntegerField(blank=True, null=True)
    result = models.CharField(max_length=10, choices=TeamFaceitMatch.RESULT_CHOICES, blank=True, null=True)
    map_name = models.CharField(max_length=100, blank=True, null=True)
    raw_data = models.JSONField(blank=True, null=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        verbose_name = "FACEIT Solo-Match"
        verbose_name_plural = "FACEIT Solo-Matches"
        ordering = ['-scheduled_at']
        unique_together = [('player', 'faceit_match_id')]

    def __str__(self):
        return f"{self.player.ingame_name} solo vs {self.opponent_name or '?'} ({self.status})"


class PlayerMatchStats(models.Model):
    """Detailed per-match CS2 stats for one of our own roster players,
    synced from FACEIT's GET /matches/{id}/stats (see sync.py). Opponents'
    stats are never stored here - we only track our own players'
    performance. One row per player per match; a finished match's numbers
    never change on FACEIT, so once a row exists it's never re-fetched.

    Exactly one of match/solo_match is set: `match` for a roster player's
    league match (see TeamFaceitMatch), `solo_match` for a teamless
    player's own FACEIT history (see PlayerFaceitMatch) - enforced by the
    CheckConstraint below, not just app-level convention."""

    player = models.ForeignKey('teams.Player', on_delete=models.CASCADE, related_name='match_stats')
    match = models.ForeignKey(
        TeamFaceitMatch, on_delete=models.CASCADE, related_name='player_stats', blank=True, null=True
    )
    solo_match = models.ForeignKey(
        PlayerFaceitMatch, on_delete=models.CASCADE, related_name='player_stats', blank=True, null=True
    )

    kills = models.PositiveIntegerField(blank=True, null=True)
    deaths = models.PositiveIntegerField(blank=True, null=True)
    assists = models.PositiveIntegerField(blank=True, null=True)
    kd_ratio = models.FloatField(blank=True, null=True)
    kr_ratio = models.FloatField(blank=True, null=True)
    headshots = models.PositiveIntegerField(blank=True, null=True)
    headshots_percent = models.FloatField(blank=True, null=True)
    mvps = models.PositiveIntegerField(blank=True, null=True)
    triple_kills = models.PositiveIntegerField(blank=True, null=True)
    quadro_kills = models.PositiveIntegerField(blank=True, null=True)
    penta_kills = models.PositiveIntegerField(blank=True, null=True)

    # "Advanced stats" FACEIT added specifically for CS2.
    utility_damage = models.FloatField(blank=True, null=True)
    utility_successes = models.PositiveIntegerField(blank=True, null=True)
    utility_count = models.PositiveIntegerField(blank=True, null=True)
    flash_count = models.PositiveIntegerField(blank=True, null=True)
    flash_successes = models.PositiveIntegerField(blank=True, null=True)
    enemies_flashed = models.PositiveIntegerField(blank=True, null=True)
    entry_count = models.PositiveIntegerField(blank=True, null=True)
    entry_wins = models.PositiveIntegerField(blank=True, null=True)
    clutch_1v1_count = models.PositiveIntegerField(blank=True, null=True)
    clutch_1v1_wins = models.PositiveIntegerField(blank=True, null=True)
    clutch_1v2_count = models.PositiveIntegerField(blank=True, null=True)
    clutch_1v2_wins = models.PositiveIntegerField(blank=True, null=True)

    result = models.CharField(max_length=10, choices=TeamFaceitMatch.RESULT_CHOICES, blank=True, null=True)
    raw_data = models.JSONField(blank=True, null=True, help_text="Rohe player_stats + Runden-Kontext von FACEIT für dieses Match.")
    last_synced_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        verbose_name = "FACEIT Spieler-Match-Statistik"
        verbose_name_plural = "FACEIT Spieler-Match-Statistiken"
        unique_together = [('player', 'match')]
        constraints = [
            models.CheckConstraint(
                condition=Q(match__isnull=False) ^ Q(solo_match__isnull=False),
                name='playermatchstats_exactly_one_match_source',
            ),
            models.UniqueConstraint(fields=['player', 'solo_match'], name='uniq_player_solo_match'),
        ]
        # No Meta.ordering: '-match__finished_at' would break/mis-sort rows
        # where match is null (solo_match rows) - callers order explicitly
        # (see fastapi_app/main.py _build_player_stats_schema).

    def __str__(self):
        source = self.match or self.solo_match
        return f"{self.player.ingame_name} @ {source.faceit_match_id if source else '?'}"


class FaceitSyncRun(models.Model):
    """Audit log of each sync run (automatic or manual), so the admin
    dashboard can show 'last synced at' / 'last run succeeded' without
    re-querying FACEIT."""

    TRIGGER_CHOICES = [
        ('scheduled', 'Automatisch'),
        ('manual', 'Manuell'),
        ('command', 'CLI-Befehl'),
    ]

    trigger = models.CharField(max_length=20, choices=TRIGGER_CHOICES)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(blank=True, null=True)
    players_synced = models.PositiveIntegerField(default=0)
    players_failed = models.PositiveIntegerField(default=0)
    matches_synced = models.PositiveIntegerField(default=0)
    league_entries_failed = models.PositiveIntegerField(default=0)
    player_match_stats_synced = models.PositiveIntegerField(default=0)
    player_match_stats_failed = models.PositiveIntegerField(default=0)
    solo_matches_synced = models.PositiveIntegerField(default=0, help_text="Solo-Matches teamloser Spieler (siehe PlayerFaceitMatch).")
    solo_match_stats_synced = models.PositiveIntegerField(default=0)
    solo_match_stats_failed = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True, null=True, help_text="Gesetzt, wenn der gesamte Lauf fehlgeschlagen ist (z.B. fehlender API-Key).")

    class Meta:
        verbose_name = "FACEIT Sync-Lauf"
        verbose_name_plural = "FACEIT Sync-Läufe"
        ordering = ['-started_at']

    def __str__(self):
        return f"Sync {self.get_trigger_display()} @ {self.started_at:%Y-%m-%d %H:%M}"
