from django.contrib import admin
from .models import AuditLogEntry


@admin.register(AuditLogEntry)
class AuditLogEntryAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'actor_username', 'action', 'resource_type', 'resource_id', 'resource_label')
    list_filter = ('action', 'resource_type')
    search_fields = ('actor_username', 'resource_label', 'resource_id')
    readonly_fields = [f.name for f in AuditLogEntry._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
