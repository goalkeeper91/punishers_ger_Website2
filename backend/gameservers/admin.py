from django.contrib import admin
from .models import HetznerVPS


@admin.register(HetznerVPS)
class HetznerVPSAdmin(admin.ModelAdmin):
    list_display = ('name', 'hetzner_server_id', 'ip_address', 'last_known_status', 'last_synced_at')
    readonly_fields = ('last_known_status', 'last_synced_at')
