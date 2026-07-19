from django.db import models

from social_stats.crypto import EncryptedTextField


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


class ServerSlot(models.Model):
    """One CS2 dedicated-server Docker container on the VPS (one of "up to
    3" pracc servers, or the util-practice server). PunishersGer only ever
    stores the config and asks the gameserver-plattform repo to actually
    create/start/stop the container over SSH+Docker - see redis_bridge.py.

    Source-engine servers don't have a separate RCON port: RCON runs over
    TCP on the exact same port number the game listens on via UDP, so this
    model deliberately has one `port` field, not two - an earlier draft of
    this plan assumed a distinct rcon_port, which doesn't match how Source/
    CS2 networking actually works."""

    KIND_CHOICES = [
        ("pracc", "Pracc"),
        ("util", "Util"),
    ]

    STATUS_CHOICES = [
        ("unknown", "Unbekannt"),
        ("creating", "Wird erstellt"),
        ("running", "Läuft"),
        ("stopped", "Gestoppt"),
        ("starting", "Startet"),
        ("stopping", "Stoppt"),
    ]

    vps = models.ForeignKey(HetznerVPS, on_delete=models.CASCADE, related_name="slots")
    label = models.CharField(max_length=100, help_text='z.B. "Pracc-Server 1" oder "Util-Server".')
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    docker_container_name = models.CharField(max_length=64, unique=True, blank=True)
    port = models.PositiveIntegerField(
        help_text="UDP-Port für Spielverkehr - RCON läuft über TCP auf demselben Port (Source-Engine-Konvention)."
    )
    rcon_password = EncryptedTextField()
    last_known_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="unknown")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "CS2-Server-Slot"
        verbose_name_plural = "CS2-Server-Slots"
        ordering = ["vps", "label"]

    def __str__(self):
        return f"{self.label} ({self.get_kind_display()})"
