from django.contrib import admin
from .models import SiteSettings, PageBackground


@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'hero_video')

    def has_add_permission(self, request):
        return not SiteSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PageBackground)
class PageBackgroundAdmin(admin.ModelAdmin):
    list_display = ('page_key', 'image', 'updated_at')
