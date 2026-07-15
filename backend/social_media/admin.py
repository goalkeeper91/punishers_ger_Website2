from django.contrib import admin
from .models import SocialMediaVaultSettings


@admin.register(SocialMediaVaultSettings)
class SocialMediaVaultSettingsAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'vault_url')

    def has_add_permission(self, request):
        return not SocialMediaVaultSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
