from django.db import models


class SiteSettings(models.Model):
    hero_video = models.FileField(upload_to='site/', blank=True, null=True)

    class Meta:
        verbose_name = "Seiteneinstellungen"
        verbose_name_plural = "Seiteneinstellungen"
        permissions = [
            ("manage_site_settings", "Kann Hero-Video & Seiten-Hintergründe verwalten"),
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
        return "Seiteneinstellungen"


class PageBackground(models.Model):
    PAGE_CHOICES = [
        ("news", "News"),
        ("teams", "Teams"),
        ("about_us", "Über uns"),
        ("sponsors", "Sponsoren"),
        ("contact", "Kontakt"),
        ("join_us", "Join Us"),
        ("privacy", "Datenschutz"),
        ("imprint", "Impressum"),
        ("creators", "Creators"),
    ]

    page_key = models.CharField(max_length=30, unique=True, choices=PAGE_CHOICES)
    image = models.ImageField(upload_to='site/page_backgrounds/', blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Seiten-Hintergrundbild"
        verbose_name_plural = "Seiten-Hintergrundbilder"
        ordering = ['page_key']

    def __str__(self):
        return self.get_page_key_display()
