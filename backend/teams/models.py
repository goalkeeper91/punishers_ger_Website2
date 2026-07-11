from django.db import models

class Team(models.Model):
    name = models.CharField(max_length=100, unique=True)
    game = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    image = models.ImageField(upload_to='teams/images/', blank=True, null=True)
    is_main_team = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Team"
        verbose_name_plural = "Teams"
        ordering = ['game', 'name']
        permissions = [
            ("manage_teams", "Kann alle Teams & Spieler verwalten (nicht nur das eigene Team)"),
        ]

    def __str__(self):
        return f"{self.name} ({self.game})"

class Player(models.Model):
    team = models.ForeignKey(Team, on_delete=models.SET_NULL, null=True, blank=True, related_name='players')
    # Re-enabled user field
    user = models.OneToOneField('users.CustomUser', on_delete=models.CASCADE, related_name='player_profile') # Assuming a CustomUser model in users app
    ingame_name = models.CharField(max_length=100)
    role = models.CharField(max_length=100, blank=True, null=True) # e.g., "AWPer", "Support", "Mid-Laner"
    image = models.ImageField(upload_to='players/images/', blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    # social_media_links = models.JSONField(blank=True, null=True) # Removed, as social media links are handled by CustomUser
    faceit_player_id = models.CharField(
        max_length=64, blank=True, null=True, unique=True,
        help_text="FACEIT Player ID (Data API v4), z.B. aus der FACEIT-Profil-URL ableitbar.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Spieler"
        verbose_name_plural = "Spieler"
        ordering = ['ingame_name']

    def __str__(self):
        return self.ingame_name

class TeamLeagueEntry(models.Model):
    """A team's registration in a specific league/championship on FACEIT.

    The same Team can play in multiple leagues (e.g. DACH CS and ESEA) under
    different FACEIT team IDs, so the FACEIT team ID lives here rather than
    on Team directly - this is what lets match syncing tell the leagues apart.
    """
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name='league_entries')
    league = models.ForeignKey('leagues.League', on_delete=models.CASCADE, related_name='team_entries')
    faceit_team_id = models.CharField(
        max_length=64, blank=True, null=True,
        help_text="FACEIT Team ID as registered for this specific league/championship.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Team-Liga-Zuordnung"
        verbose_name_plural = "Team-Liga-Zuordnungen"
        unique_together = [('team', 'league')]
        ordering = ['team__name', 'league__name']

    def __str__(self):
        return f"{self.team.name} @ {self.league.name}"
