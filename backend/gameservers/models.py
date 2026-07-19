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


class ServerConfig(models.Model):
    """A reusable, admin-uploaded CS2 server config file (a pracc config, a
    util-practice config, or a map-pool/map-cycle file). Loading one onto a
    ServerSlot just means "push this file into the slot's cfg dir, then RCON
    `exec <filename>`" - see redis_bridge.py's publish_load_config(). A
    "map pool" is deliberately just another config file here, not a separate
    concept - there's no live sync against an external Active-Duty map list,
    the admin curates the file's contents directly."""

    KIND_CHOICES = [
        ("pracc", "Pracc"),
        ("util", "Util"),
        ("map_pool", "Map-Pool"),
    ]

    label = models.CharField(max_length=100, help_text='z.B. "Standard Pracc" oder "Active Duty Map-Pool".')
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    file = models.FileField(upload_to='gameserver_configs/')
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Server-Config"
        verbose_name_plural = "Server-Configs"
        ordering = ["kind", "label"]

    def __str__(self):
        return f"{self.label} ({self.get_kind_display()})"


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
    current_config = models.ForeignKey(
        ServerConfig, on_delete=models.SET_NULL, null=True, blank=True, related_name="loaded_on_slots"
    )
    last_known_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="unknown")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "CS2-Server-Slot"
        verbose_name_plural = "CS2-Server-Slots"
        ordering = ["vps", "label"]

    def __str__(self):
        return f"{self.label} ({self.get_kind_display()})"


class Pracc(models.Model):
    """A scheduled scrim ("Pracc") between one of our own teams and an
    opponent, assigned to one of the CS2 slots on the rented VPS. Starting
    one (see redis_bridge.py's publish_start_pracc()) only makes sure the
    assigned slot's container is actually running - deliberately NOT the
    full MatchZy match-config automation (team rosters, map veto) the
    original plan sketched. Building even a one-sided roster from
    CustomUser.steam_id would be possible for own_team, but opponent_team_name
    is deliberately free text, not a linked Team - the opponent has no
    modeled roster in this system at all, so a real two-sided MatchZy config
    isn't buildable regardless. That (and the plan's own note that MatchZy's
    exact convars are unverified pending a real deploy) is why this stays at
    scheduling + Teammanager-scoped visibility + making sure the server is
    up, same guarantee START_SLOT already gives."""

    STATUS_CHOICES = [
        ("scheduled", "Geplant"),
        ("live", "Live"),
        ("finished", "Beendet"),
        ("cancelled", "Abgesagt"),
    ]

    slot = models.ForeignKey(ServerSlot, on_delete=models.CASCADE, related_name="praccs")
    own_team = models.ForeignKey('teams.Team', on_delete=models.CASCADE, related_name="praccs")
    opponent_team_name = models.CharField(max_length=100)
    scheduled_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="scheduled")
    created_by = models.ForeignKey(
        'users.CustomUser', on_delete=models.SET_NULL, null=True, blank=True, related_name="created_praccs"
    )
    # Populated once gameserver-plattform retrieves it post-match (Phase 5) -
    # empty until then.
    demo_file = models.FileField(upload_to='gameserver_demos/', null=True, blank=True)
    match_ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Pracc"
        verbose_name_plural = "Praccs"
        ordering = ["-scheduled_at"]

    def __str__(self):
        return f"{self.own_team.name} vs. {self.opponent_team_name} ({self.scheduled_at:%Y-%m-%d %H:%M})"
