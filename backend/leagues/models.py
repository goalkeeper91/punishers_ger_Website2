from django.db import models

class League(models.Model):
    name = models.CharField(max_length=100, unique=True)
    short_name = models.CharField(max_length=20, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    logo = models.ImageField(upload_to='leagues/logos/', blank=True, null=True)
    website_url = models.URLField(max_length=200, blank=True, null=True)
    faceit_organizer_id = models.CharField(
        max_length=64, blank=True, null=True, unique=True,
        help_text=(
            "FACEIT Organizer ID (Data API v4), z.B. für ESEA oder DACH CS getrennt. "
            "Ablesbar aus der Organizer-URL: faceit.com/de/organizers/<diese-id>/<name>. "
            "Daraus werden die Championships (Seasons) und darüber die Matches abgerufen."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Liga"
        verbose_name_plural = "Ligen"
        ordering = ['name']

    def __str__(self):
        return self.name
