from django.db import models


class AuditLogEntry(models.Model):
    """Immutable record of an admin-mutating action, written by
    fastapi_app/main.py's _log_action() helper at the end of every
    create/update/delete/role/permission-changing endpoint. Lets a
    superadmin answer "wer hat wann was geändert" without needing to trust
    that everyone remembers to report their own changes."""

    actor = models.ForeignKey(
        'users.CustomUser', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='audit_log_entries',
    )
    actor_username = models.CharField(
        max_length=150, blank=True, null=True,
        help_text="Snapshot des Benutzernamens zum Zeitpunkt der Aktion - bleibt auch erhalten, wenn der Account später gelöscht wird.",
    )
    action = models.CharField(max_length=50, help_text="z.B. 'create', 'update', 'delete', 'activate', 'role_assign'.")
    resource_type = models.CharField(max_length=100, help_text="z.B. 'NewsArticle', 'Team', 'Sponsor', 'CustomUser', 'Group'.")
    resource_id = models.CharField(max_length=64, blank=True, null=True)
    resource_label = models.CharField(max_length=255, blank=True, null=True, help_text="Menschenlesbarer Bezug, z.B. Artikel-Titel oder Team-Name.")
    details = models.JSONField(blank=True, null=True, help_text="Zusätzlicher Kontext, z.B. geänderte Felder oder zugewiesene Rollen/Rechte.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Audit-Log-Eintrag"
        verbose_name_plural = "Audit-Log-Einträge"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.actor_username or 'System'} {self.action} {self.resource_type}#{self.resource_id or '?'} @ {self.created_at:%Y-%m-%d %H:%M}"
