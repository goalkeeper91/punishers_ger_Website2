from django.contrib import admin
from .models import Sponsor, SocialLink


@admin.register(Sponsor)
class SponsorAdmin(admin.ModelAdmin):
    list_display = ('name', 'tier', 'is_active', 'order', 'click_count')
    list_filter = ('tier', 'is_active')
    search_fields = ('name',)
    ordering = ('order', 'name')


@admin.register(SocialLink)
class SocialLinkAdmin(admin.ModelAdmin):
    list_display = ('platform', 'url', 'is_active', 'order', 'click_count')
    list_filter = ('platform', 'is_active')
    ordering = ('order',)
