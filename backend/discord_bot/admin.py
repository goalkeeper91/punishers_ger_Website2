from django.contrib import admin
from .models import (
    DiscordGuild,
    AnnouncementChannelMapping,
    AnnouncementLog,
    VoiceChannelTrigger,
    ReactionRole,
)


class AnnouncementChannelMappingInline(admin.TabularInline):
    model = AnnouncementChannelMapping
    extra = 0


class VoiceChannelTriggerInline(admin.TabularInline):
    model = VoiceChannelTrigger
    extra = 0


class ReactionRoleInline(admin.TabularInline):
    model = ReactionRole
    extra = 0


@admin.register(DiscordGuild)
class DiscordGuildAdmin(admin.ModelAdmin):
    list_display = ('name', 'guild_id', 'member_count', 'is_active', 'last_seen_at')
    list_filter = ('is_active',)
    search_fields = ('name', 'guild_id')
    readonly_fields = ('last_seen_at',)
    inlines = [AnnouncementChannelMappingInline, VoiceChannelTriggerInline, ReactionRoleInline]


@admin.register(AnnouncementLog)
class AnnouncementLogAdmin(admin.ModelAdmin):
    list_display = ('title', 'event_type', 'guild', 'success', 'triggered_by', 'created_at')
    list_filter = ('event_type', 'success')
    search_fields = ('title', 'description')
    readonly_fields = ('created_at',)
