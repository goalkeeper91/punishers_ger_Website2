from django.contrib import admin
from .models import PlayerApplication


@admin.register(PlayerApplication)
class PlayerApplicationAdmin(admin.ModelAdmin):
    list_display = ('ingame_name', 'game', 'rank', 'email', 'status', 'created_at', 'reviewed_by')
    list_filter = ('game', 'status')
    search_fields = ('ingame_name', 'full_name', 'email', 'discord_tag')
    readonly_fields = ('created_at',)
