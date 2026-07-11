from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import CustomUser


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = ('username', 'email', 'is_active', 'is_staff', 'is_superuser', 'is_content_creator', 'team')
    list_filter = UserAdmin.list_filter + ('is_content_creator', 'is_featured_creator')
    fieldsets = UserAdmin.fieldsets + (
        ("eSport-Profil", {
            'fields': ('profile_picture', 'steam_id', 'game_profile_link', 'team'),
        }),
        ("Social Media", {
            'fields': ('twitter_link', 'twitch_link', 'youtube_link'),
        }),
        ("Content Creator", {
            'fields': ('is_content_creator', 'is_featured_creator', 'creator_bio'),
        }),
    )
