from django.contrib import admin
from .models import PlayerSocialStats, TwitchAuthorization


@admin.register(PlayerSocialStats)
class PlayerSocialStatsAdmin(admin.ModelAdmin):
    list_display = ('user', 'platform', 'follower_count', 'view_count', 'data_source', 'stats_updated_at')
    list_filter = ('platform', 'data_source')
    search_fields = ('user__username', 'user__email')


@admin.register(TwitchAuthorization)
class TwitchAuthorizationAdmin(admin.ModelAdmin):
    list_display = ('twitch_login', 'user', 'social_link', 'connected_at', 'token_expires_at')
    search_fields = ('twitch_login', 'user__username', 'social_link__url')
    # Never shown, even to a superuser looking at this in Django admin - no
    # legitimate reason to ever display a live bearer token on screen.
    exclude = ('access_token', 'refresh_token')
