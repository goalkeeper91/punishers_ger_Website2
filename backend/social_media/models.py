from django.db import models


class SocialMediaVaultSettings(models.Model):
    """Singleton pointing the Social Media Manager dashboard at the org's
    self-hosted Vaultwarden instance (see docker-compose.yml's `vaultwarden`
    service) - PunishersGer only embeds that server's own web vault in an
    iframe (admin/social-media.tsx), it never stores or sees the actual
    credentials. Set once by a superuser via this app's Django admin."""

    vault_url = models.URLField(blank=True, help_text="z.B. https://vault.punishersgermany.de/")

    class Meta:
        verbose_name = "Social-Media-Vault-Einstellungen"
        verbose_name_plural = "Social-Media-Vault-Einstellungen"
        permissions = [
            ("manage_social_media_vault", "Social-Media-Zugangsdaten verwalten (Vaultwarden)"),
        ]

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Social-Media-Vault-Einstellungen"
