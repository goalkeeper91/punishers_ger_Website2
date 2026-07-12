from django.contrib.auth.models import AbstractUser
from django.db import models

# "System roles": Django Group names with actual enforced meaning in
# fastapi_app/main.py (require_roles / ensure_team_access), unlike other
# groups an admin might create purely as display labels. Auto-provisioned
# via users/migrations/0002_create_system_roles.py so the exact names are
# never left to chance/typos in the admin UI.
ROLE_TEAM_MANAGER = "Teammanager"
ROLE_AUTHOR = "Author"
SYSTEM_ROLES = [ROLE_TEAM_MANAGER, ROLE_AUTHOR]

class CustomUser(AbstractUser):
    # Zusätzliche Felder für den Benutzer
    profile_picture = models.ImageField(upload_to='profile_pics/', blank=True, null=True)
    
    # eSport relevante Daten
    steam_id = models.CharField(max_length=17, unique=True, blank=True, null=True, help_text="Steam 64-bit ID")
    # Weitere eSport-spezifische IDs könnten hier hinzugefügt werden (z.B. Riot ID, Epic Games ID)

    # Spieler Profil Verknüpfungen
    game_profile_link = models.URLField(max_length=200, blank=True, null=True, help_text="Link zum Spielerprofil im Spiel")

    # Social Media Präsentation
    twitter_link = models.URLField(max_length=200, blank=True, null=True)
    twitch_link = models.URLField(max_length=200, blank=True, null=True)
    youtube_link = models.URLField(max_length=200, blank=True, null=True)
    instagram_link = models.URLField(max_length=200, blank=True, null=True)
    tiktok_link = models.URLField(max_length=200, blank=True, null=True)

    # Content-Creator-Präsenz auf /creators. Getrennt von den "roles" (Gruppen)
    # gehalten, da das reine Content-Kategorisierung ist, keine Berechtigung.
    is_content_creator = models.BooleanField(default=False, help_text="Auf der /creators-Seite anzeigen?")
    is_featured_creator = models.BooleanField(default=False, help_text="Nur relevant, wenn is_content_creator gesetzt ist: größere Karte in der 'Featured'-Sektion.")
    creator_bio = models.TextField(blank=True, null=True, help_text="Kurzbeschreibung für die Creators-Seite.")

    # Das 'team'-Feld wird aus CustomUser entfernt, da es im Player-Modell besser aufgehoben ist.
    team = models.ForeignKey('teams.Team', on_delete=models.SET_NULL, null=True, blank=True, related_name='members')

    # Hier könnten weitere Felder für Zu-/Absagen, etc. hinzugefügt werden
    # z.B. availability_status = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        permissions = [
            ("manage_users", "Kann Nutzer aktivieren/deaktivieren"),
        ]

    def __str__(self):
        return self.username

    @property
    def roles(self):
        """
        Returns a list of role names (Django group names) the user belongs to.
        """
        return [group.name for group in self.groups.all()]
