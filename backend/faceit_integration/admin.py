from django.contrib import admin
from .models import (
    PlayerFaceitStats,
    TeamFaceitMatch,
    PlayerFaceitMatch,
    PlayerMatchStats,
    FaceitSyncRun,
    MatchBroadcast,
)


@admin.register(PlayerFaceitStats)
class PlayerFaceitStatsAdmin(admin.ModelAdmin):
    list_display = ('player', 'game_id', 'nickname', 'skill_level', 'faceit_elo', 'matches', 'last_synced_at', 'last_sync_error')
    list_filter = ('game_id',)
    search_fields = ('player__ingame_name', 'nickname')
    readonly_fields = ('raw_data', 'last_synced_at', 'last_sync_error')


@admin.register(TeamFaceitMatch)
class TeamFaceitMatchAdmin(admin.ModelAdmin):
    list_display = ('league_entry', 'opponent_name', 'status', 'scheduled_at', 'result', 'team_score', 'opponent_score')
    list_filter = ('status', 'result', 'league_entry__league')
    search_fields = ('opponent_name', 'competition_name', 'faceit_match_id')
    readonly_fields = ('raw_data', 'last_synced_at')


@admin.register(PlayerFaceitMatch)
class PlayerFaceitMatchAdmin(admin.ModelAdmin):
    list_display = ('player', 'opponent_name', 'status', 'scheduled_at', 'result', 'player_score', 'opponent_score')
    list_filter = ('status', 'result')
    search_fields = ('player__ingame_name', 'opponent_name', 'faceit_match_id')
    readonly_fields = ('raw_data', 'last_synced_at')


@admin.register(PlayerMatchStats)
class PlayerMatchStatsAdmin(admin.ModelAdmin):
    list_display = ('player', 'match', 'solo_match', 'result', 'kills', 'deaths', 'assists', 'kd_ratio', 'enemies_flashed', 'last_synced_at')
    list_filter = ('result',)
    search_fields = ('player__ingame_name', 'match__faceit_match_id', 'solo_match__faceit_match_id')
    readonly_fields = ('raw_data', 'last_synced_at')


@admin.register(MatchBroadcast)
class MatchBroadcastAdmin(admin.ModelAdmin):
    list_display = ('match', 'caster_login', 'caster_url', 'is_live', 'viewer_count', 'live_checked_at')
    list_filter = ('is_live',)
    search_fields = ('match__opponent_name', 'match__faceit_match_id', 'caster_input', 'caster_login')
    readonly_fields = ('caster_url', 'caster_login', 'is_live', 'stream_title', 'stream_game', 'viewer_count', 'thumbnail_url', 'live_checked_at', 'created_at', 'updated_at')


@admin.register(FaceitSyncRun)
class FaceitSyncRunAdmin(admin.ModelAdmin):
    list_display = (
        'trigger', 'started_at', 'finished_at', 'players_synced', 'players_failed',
        'matches_synced', 'league_entries_failed', 'player_match_stats_synced',
        'player_match_stats_failed', 'solo_matches_synced', 'solo_match_stats_synced',
        'solo_match_stats_failed', 'error',
    )
    list_filter = ('trigger',)
    readonly_fields = [f.name for f in FaceitSyncRun._meta.fields]

    def has_add_permission(self, request):
        return False
