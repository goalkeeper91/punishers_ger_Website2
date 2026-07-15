from django.db import models


class Sponsor(models.Model):
    TIER_CHOICES = [
        ("premium", "Premium"),
        ("general", "Allgemein"),
    ]

    name = models.CharField(max_length=100)
    logo = models.ImageField(upload_to='sponsors/logos/', blank=True, null=True)
    website_url = models.URLField(max_length=200, blank=True, null=True)
    tier = models.CharField(max_length=20, choices=TIER_CHOICES, default="general")
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0, help_text="Niedrigere Werte werden zuerst angezeigt.")
    click_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Sponsor"
        verbose_name_plural = "Sponsoren"
        ordering = ['order', 'name']
        permissions = [
            ("manage_sponsors", "Kann Sponsoren & Social Links verwalten"),
        ]

    def __str__(self):
        return self.name


class SocialLink(models.Model):
    PLATFORM_CHOICES = [
        ("twitch", "Twitch"),
        ("youtube", "YouTube"),
        ("twitter", "Twitter/X"),
        ("instagram", "Instagram"),
        ("facebook", "Facebook"),
        ("discord", "Discord"),
        ("tiktok", "TikTok"),
        ("other", "Sonstiges"),
    ]
    DATA_SOURCE_CHOICES = [
        ("auto", "Automatisch synchronisiert"),
        ("manual", "Manuell gepflegt"),
    ]

    platform = models.CharField(max_length=20, choices=PLATFORM_CHOICES)
    url = models.URLField(max_length=200)
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0, help_text="Niedrigere Werte werden zuerst angezeigt.")
    click_count = models.PositiveIntegerField(default=0)

    # Reichweiten-Statistik für die Sponsoren-Auswertung (siehe social_stats
    # App). YouTube/Discord werden automatisch synchronisiert; für Twitch/
    # Twitter/Instagram/TikTok gibt es (Stand heute) keine öffentliche API
    # ohne Kanal-eigenes OAuth mehr, daher pflegt ein Admin diese Werte hier
    # manuell.
    follower_count = models.PositiveIntegerField(blank=True, null=True, help_text="Follower/Abonnenten/Mitglieder, je nach Plattform.")
    view_count = models.PositiveIntegerField(blank=True, null=True, help_text="Gesamt-Views, falls von der Plattform bereitgestellt (z.B. YouTube).")
    like_count = models.PositiveIntegerField(blank=True, null=True)
    comment_count = models.PositiveIntegerField(blank=True, null=True)
    share_count = models.PositiveIntegerField(blank=True, null=True)
    reach_count = models.PositiveIntegerField(blank=True, null=True, help_text="Anzahl erreichter Accounts/Personen.")
    impressions_count = models.PositiveIntegerField(blank=True, null=True, help_text="Anzahl Anzeigen des Inhalts, inkl. Mehrfachansichten.")
    data_source = models.CharField(max_length=10, choices=DATA_SOURCE_CHOICES, default="manual")
    stats_updated_at = models.DateTimeField(blank=True, null=True, help_text="Letzte automatische Synchronisation oder manuelle Pflege der Reichweiten-Zahlen.")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Social Link"
        verbose_name_plural = "Social Links"
        ordering = ['order']

    def __str__(self):
        return f"{self.get_platform_display()} ({self.url})"
