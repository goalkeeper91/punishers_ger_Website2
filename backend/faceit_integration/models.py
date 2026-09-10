from datetime import timedelta

from django.db import models
from django.db.models import Q
from django.utils import timezone


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
    # Groups the individual map rows of one manually-recorded Bo2/Bo3/Bo5
    # series together (one TeamFaceitMatch row per map, see
    # fastapi_app/main.py create_manual_match) - null for every row synced
    # from FACEIT and for a manual Bo1, since those are already exactly one
    # row. NOT a FK to itself - just a shared opaque grouping value, cheaper
    # than a real parent/child relation for something this simple.
    series_id = models.CharField(max_length=64, blank=True, null=True, db_index=True)
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


# --- External-caster broadcasts + the shared "live window" rule ---------------
#
# An external caster's stream is only ever polled/shown from 15 minutes
# before a match's scheduled start until 15 minutes after it finishes. The
# window is data-driven (TeamFaceitMatch.scheduled_at / .finished_at), never
# a guessed match duration. While finished_at is still NULL (match running,
# not yet synced as finished) the window stays open, but a hard 12h cap from
# scheduled_at stops a match that never flips to 'finished' from being
# polled forever. This is defined in exactly one place and reused by the
# Twitch poller (twitch_integration/scheduler.py) and the public
# /matches/live/ endpoint (fastapi_app/main.py).

BROADCAST_WINDOW_LEAD = timedelta(minutes=15)
BROADCAST_WINDOW_TRAIL = timedelta(minutes=15)
BROADCAST_WINDOW_HARD_CAP = timedelta(hours=12)


def broadcast_live_window_q(now=None) -> Q:
    """A Q filter (field prefix ``match__``) selecting MatchBroadcast rows
    whose match is currently inside its live window."""
    now = now or timezone.now()
    return (
        Q(match__scheduled_at__isnull=False)
        & Q(match__scheduled_at__lte=now + BROADCAST_WINDOW_LEAD)
        & (
            Q(match__finished_at__gte=now - BROADCAST_WINDOW_TRAIL)
            | (
                Q(match__finished_at__isnull=True)
                & Q(match__scheduled_at__gte=now - BROADCAST_WINDOW_HARD_CAP)
            )
        )
    )


def is_in_live_window(match, now=None) -> bool:
    """Python equivalent of broadcast_live_window_q for an already-loaded
    TeamFaceitMatch."""
    now = now or timezone.now()
    if not match.scheduled_at:
        return False
    if now < match.scheduled_at - BROADCAST_WINDOW_LEAD:
        return False
    if match.finished_at:
        return now <= match.finished_at + BROADCAST_WINDOW_TRAIL
    return now <= match.scheduled_at + BROADCAST_WINDOW_HARD_CAP


class MatchBroadcast(models.Model):
    """Caster / stream info for one upcoming TeamFaceitMatch, entered in the
    admin "Match-Caster" module. ``caster_input`` is the raw text an admin
    typed (a bare Twitch handle or a full URL); save() normalises it into
    ``caster_url`` (always a followable link) and ``caster_login`` (the
    Twitch login when it is a Twitch channel - empty for e.g. a YouTube
    link).

    The is_live/stream_* fields are a cache written only by
    twitch_integration/scheduler.py's poller while the match is inside its
    live window (see is_in_live_window) - never trusted outside it."""

    match = models.OneToOneField(
        TeamFaceitMatch, on_delete=models.CASCADE, related_name='broadcast'
    )
    caster_input = models.CharField(max_length=300, blank=True, help_text="Twitch-Name oder voller Stream-Link des Casters, wie eingegeben.")
    caster_url = models.CharField(max_length=300, blank=True, help_text="Normalisierter Stream-Link (automatisch aus caster_input gebaut).")
    caster_login = models.CharField(max_length=100, blank=True, help_text="Twitch-Login, falls erkennbar - Basis für Live-Check und eingebetteten Player.")

    is_live = models.BooleanField(default=False)
    stream_title = models.CharField(max_length=300, blank=True)
    stream_game = models.CharField(max_length=150, blank=True)
    viewer_count = models.PositiveIntegerField(blank=True, null=True)
    thumbnail_url = models.URLField(max_length=500, blank=True)
    live_checked_at = models.DateTimeField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Match-Broadcast"
        verbose_name_plural = "Match-Broadcasts"

    def __str__(self):
        return f"Broadcast: {self.match} ({self.caster_login or self.caster_url or 'kein Caster'})"

    def save(self, *args, **kwargs):
        # Imported here (not at module load) to keep faceit_integration free
        # of an import-time dependency on twitch_integration.
        from twitch_integration.client import normalize_caster

        new_url, new_login = normalize_caster(self.caster_input)
        new_login = new_login or ""
        if new_login != self.caster_login:
            # The caster changed - any cached live snapshot is now stale.
            self.is_live = False
            self.stream_title = ""
            self.stream_game = ""
            self.viewer_count = None
            self.thumbnail_url = ""
            self.live_checked_at = None
        self.caster_url = new_url
        self.caster_login = new_login
        super().save(*args, **kwargs)


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
