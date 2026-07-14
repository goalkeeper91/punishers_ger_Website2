from django.db import models


class PlayerApplication(models.Model):
    # Matches the canonical game list hardcoded in frontend/app/routes/teams.tsx -
    # kept as a real choices field (not free text) since GET/PUT /admin/applications/
    # scope a Teammanager's visibility by exact-matching this against Team.game.
    GAME_CHOICES = [
        ("Counter-Strike 2", "Counter-Strike 2"),
        ("Valorant", "Valorant"),
        ("League of Legends", "League of Legends"),
        ("Rocket League", "Rocket League"),
        ("Rainbow Six Siege", "Rainbow Six Siege"),
    ]

    STATUS_CHOICES = [
        ("pending", "Offen"),
        ("accepted", "Angenommen"),
        ("rejected", "Abgelehnt"),
    ]

    ingame_name = models.CharField(max_length=100)
    game = models.CharField(max_length=100, choices=GAME_CHOICES)
    # The specific per-game rank options (FACEIT Level, Iron..Radiant, ...) live only
    # in the frontend dropdown - no need to duplicate/validate them server-side beyond
    # "non-empty", so this stays a plain CharField rather than a second choices field.
    rank = models.CharField(max_length=100)

    full_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField()
    discord_tag = models.CharField(max_length=50, blank=True)
    age = models.PositiveSmallIntegerField(null=True, blank=True)
    message = models.TextField(blank=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        "users.CustomUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_applications"
    )

    class Meta:
        verbose_name = "Spieler-Bewerbung"
        verbose_name_plural = "Spieler-Bewerbungen"
        ordering = ["-created_at"]
        permissions = [
            ("manage_applications", "Bewerbungen einsehen & bearbeiten (alle Spiele)"),
        ]

    def __str__(self):
        return f"{self.ingame_name} ({self.game})"
