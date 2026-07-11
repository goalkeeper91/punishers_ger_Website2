from django.contrib import admin
from .models import Team, Player, TeamLeagueEntry


class TeamLeagueEntryInline(admin.TabularInline):
    model = TeamLeagueEntry
    extra = 1


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ('name', 'game', 'is_main_team')
    list_filter = ('game', 'is_main_team')
    search_fields = ('name',)
    inlines = [TeamLeagueEntryInline]


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('ingame_name', 'team', 'role', 'user', 'faceit_player_id')
    list_filter = ('team',)
    search_fields = ('ingame_name', 'faceit_player_id')


@admin.register(TeamLeagueEntry)
class TeamLeagueEntryAdmin(admin.ModelAdmin):
    list_display = ('team', 'league', 'faceit_team_id')
    list_filter = ('league',)
    search_fields = ('team__name', 'league__name', 'faceit_team_id')
