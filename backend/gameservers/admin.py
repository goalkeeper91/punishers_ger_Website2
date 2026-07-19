from django.contrib import admin
from .models import HetznerVPS, Pracc, ServerConfig, ServerSlot


@admin.register(HetznerVPS)
class HetznerVPSAdmin(admin.ModelAdmin):
    list_display = ('name', 'hetzner_server_id', 'ip_address', 'last_known_status', 'last_synced_at')
    readonly_fields = ('last_known_status', 'last_synced_at')


@admin.register(ServerConfig)
class ServerConfigAdmin(admin.ModelAdmin):
    list_display = ('label', 'kind', 'file', 'created_at')
    list_filter = ('kind',)


@admin.register(ServerSlot)
class ServerSlotAdmin(admin.ModelAdmin):
    list_display = ('label', 'kind', 'vps', 'port', 'current_config', 'last_known_status', 'last_synced_at')
    list_filter = ('kind', 'vps')
    readonly_fields = ('docker_container_name', 'last_known_status', 'last_synced_at')


@admin.register(Pracc)
class PraccAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'own_team', 'slot', 'status', 'scheduled_at', 'created_by', 'map_pool_config', 'demo_filename')
    list_filter = ('status', 'own_team', 'slot')
    readonly_fields = ('match_ended_at', 'demo_filename', 'demo_uploaded_at')
