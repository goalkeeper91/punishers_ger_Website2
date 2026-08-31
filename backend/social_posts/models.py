from django.db import models


class SocialPostDraft(models.Model):
    """An auto-generated draft social-media post (announcement or result)
    for one match/series - text per platform (character limits and tone
    differ) plus one shared template-rendered image. Created by
    social_posts/generation.py, triggered from faceit_integration/sync.py
    (a match newly becoming upcoming/ongoing, or newly finished - same
    "only once, on the real transition" signal the existing Discord
    announcement already uses) and from fastapi_app/main.py's
    create_manual_match (always a result, since manual matches are always
    recorded as already finished).

    Deliberately NOT a FK to TeamFaceitMatch: a Bo2/Bo3/Bo5 series is
    several TeamFaceitMatch rows sharing a series_id (see
    faceit_integration.models.TeamFaceitMatch.series_id), but is exactly
    one social post - and the match a draft was generated for could later
    be edited/deleted, which shouldn't retroactively invalidate or cascade
    into an already-generated draft. All the match context needed to
    display/regenerate a draft is snapshotted directly on this row instead.
    """

    POST_TYPE_CHOICES = [
        ('announcement', 'Ankündigung (bevorstehendes Match)'),
        ('result', 'Ergebnis'),
    ]

    team = models.ForeignKey('teams.Team', on_delete=models.CASCADE, related_name='social_post_drafts')
    post_type = models.CharField(max_length=20, choices=POST_TYPE_CHOICES)

    # Snapshotted match context - independent of the source TeamFaceitMatch
    # row(s) still existing/being unchanged.
    opponent_name = models.CharField(max_length=200, blank=True, null=True)
    competition_name = models.CharField(max_length=200, blank=True, null=True)
    match_datetime = models.DateTimeField(blank=True, null=True)
    team_maps_won = models.PositiveSmallIntegerField(blank=True, null=True)
    opponent_maps_won = models.PositiveSmallIntegerField(blank=True, null=True)
    maps_summary = models.CharField(
        max_length=300, blank=True, null=True,
        help_text="z.B. 'de_mirage 13:7, de_inferno 10:16, de_ancient 16:12' - für den KI-Prompt und die Anzeige.",
    )
    maps = models.JSONField(
        blank=True, null=True,
        help_text="Strukturierte Maps-Liste fürs Bild-Template (Maps-Zeile), z.B. "
                   "[{'name': 'de_mirage', 'team_score': 13, 'opponent_score': 7, 'result': 'win'}, ...]. "
                   "Separat von maps_summary (Freitext für den KI-Prompt) gehalten - siehe generation.py.",
    )
    opponent_logo_url = models.URLField(
        max_length=500, blank=True, null=True,
        help_text="FACEIT-Team-Avatar des Gegners (nur bei synchronisierten Matches vorhanden, nicht bei manuell erfassten) - fürs Bild-Template.",
    )

    text_facebook = models.TextField(blank=True)
    text_instagram = models.TextField(blank=True)
    text_x = models.TextField(blank=True)
    image = models.ImageField(upload_to='social_posts/', blank=True, null=True)

    generation_error = models.TextField(
        blank=True, null=True,
        help_text="Gesetzt, wenn Text- und/oder Bild-Generierung fehlgeschlagen ist (z.B. Ollama nicht erreichbar) - der Entwurf existiert trotzdem, ggf. nur teilweise befüllt.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Social-Media-Post-Entwurf"
        verbose_name_plural = "Social-Media-Post-Entwürfe"
        ordering = ['-created_at']
        permissions = [
            ("manage_social_posts", "Kann Social-Media-Post-Entwürfe einsehen/verwalten"),
        ]

    def __str__(self):
        return f"{self.get_post_type_display()}: {self.team.name} vs {self.opponent_name or '?'}"
