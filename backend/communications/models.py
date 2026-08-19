from django.db import models


class EmailLog(models.Model):
    """One admin-sent free-text email (see fastapi_app/main.py
    send_free_text_email endpoint + communications/emails.py) - mirrors
    discord_bot.AnnouncementLog's send-log pattern so admins can see what
    was sent, from which address, and whether it actually went out."""

    from_alias = models.CharField(max_length=50, help_text="z.B. 'info', 'orga', 'self'.")
    from_address = models.EmailField()
    to = models.TextField(help_text="Kommagetrennte Empfängerliste, wie eingegeben.")
    subject = models.CharField(max_length=200)
    body = models.TextField()
    sent_by = models.ForeignKey(
        'users.CustomUser', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sent_emails',
    )
    sent_by_username = models.CharField(
        max_length=150, blank=True, null=True,
        help_text="Snapshot des Benutzernamens - bleibt auch erhalten, wenn der Account später gelöscht wird.",
    )
    success = models.BooleanField(default=True)
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Gesendete E-Mail"
        verbose_name_plural = "Gesendete E-Mails"
        ordering = ['-created_at']
        permissions = [
            ("send_email", "Kann Freitext-E-Mails über das Dashboard versenden"),
        ]

    def __str__(self):
        return f"{self.subject} -> {self.to}"
