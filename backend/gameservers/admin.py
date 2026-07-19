from django.contrib import admin
from .models import HetznerVPS, ServerSlot


@admin.register(HetznerVPS)
class HetznerVPSAdmin(admin.ModelAdmin):
    list_display = ('name', 'hetzner_server_id', 'ip_address', 'last_known_status', 'last_synced_at')
    readonly_fields = ('last_known_status', 'last_synced_at')


@admin.register(ServerSlot)
class ServerSlotAdmin(admin.ModelAdmin):
    list_display = ('label', 'kind', 'vps', 'port', 'last_known_status', 'last_synced_at')
    list_filter = ('kind', 'vps')
    readonly_fields = ('docker_container_name', 'last_known_status', 'last_synced_at')
