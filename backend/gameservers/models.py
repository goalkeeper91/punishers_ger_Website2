from django.db import models


class HetznerVPS(models.Model):
    """The rented Hetzner Cloud VPS hosting the CS2 practice servers. This
    table is purely a status cache - PunishersGer never calls the Hetzner API
    itself. Power on/off and status polling happen in the separate
    gameserver-plattform repo (mirrors bot-plattform's role for Discord),
    which reports changes back over Redis pub/sub (see redis_bridge.py/
    listener.py) after PunishersGer requests a change or the other side's
    own idle-shutdown loop fires."""

    STATUS_CHOICES = [
        ("unknown", "Unbekannt"),
        ("running", "Läuft"),
        ("off", "Ausgeschaltet"),
        ("starting", "Startet"),
        ("stopping", "Fährt herunter"),
    ]

    hetzner_server_id = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=100)
    ip_address = models.GenericIPAddressField(blank=True, null=True)
    last_known_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="unknown")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Hetzner-VPS"
        verbose_name_plural = "Hetzner-VPS"
        permissions = [
            ("manage_gameservers", "CS2-Gameserver verwalten"),
        ]

    def __str__(self):
        return f"{self.name} ({self.last_known_status})"
