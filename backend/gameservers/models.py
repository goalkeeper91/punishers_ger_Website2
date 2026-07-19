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
    opponent, assigned to one of the CS2 slots on the rented VPS.

    If `map_pool_config` is set, starting the Pracc (see redis_bridge.py's
    publish_start_pracc()) loads a generated MatchZy match config (team
    names + this map pool, `num_maps=1`) via RCON `matchzy_loadmatch_url`
    once the slot's container is confirmed running - see
    fastapi_app/main.py's get_pracc_matchzy_config(). From there MatchZy
    itself runs the veto (if the pool has more than one map) and each
    team's own `.ready` - no further dashboard involvement needed. This is
    deliberately NOT a Steam-ID-locked competitive config (no player
    rosters, no side-picking override): opponent_team_name is free text,
    not a linked Team, so there's no modeled roster for that side anyway,
    and a pracc doesn't need one - team names + a map pool is enough for
    MatchZy's own connect-and-ready flow. If `map_pool_config` is left
    unset, starting a Pracc still just guarantees the slot is running
    (the original, more conservative behavior) - useful for slots where
    MatchZy isn't installed, or for a manually-run practice session.
    MatchZy's exact command/JSON-shape is a best-effort guess at its
    documented config schema - verify against a real deploy before relying
    on this for an actual scrim."""

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
    # Optional - see the class docstring. Restricted to kind='map_pool' at
    # the API validation layer (fastapi_app/main.py's create_pracc()), not
    # via a DB constraint, same convention as ServerSlot.current_config above.
    map_pool_config = models.ForeignKey(
        ServerConfig, on_delete=models.SET_NULL, null=True, blank=True, related_name="praccs_using_pool"
    )
    created_by = models.ForeignKey(
        'users.CustomUser', on_delete=models.SET_NULL, null=True, blank=True, related_name="created_praccs"
    )
    # Populated once gameserver-plattform retrieves it post-match (Phase 5) -
    # empty until then. Deliberately a plain filename, not a Django FileField:
    # a FileField is stored/served under MEDIA_ROOT, which fastapi_app/main.py
    # mounts as a fully public StaticFiles directory - anyone with the URL
    # could download a demo regardless of team membership or the 7-day
    # download window below. The file itself lives in
    # settings.GAMESERVER_DEMOS_ROOT instead (never mounted as static), and is
    # only ever served through the authenticated, expiry-checked
    # GET /gameservers/praccs/{id}/demo/ endpoint in fastapi_app/main.py.
    demo_filename = models.CharField(max_length=255, null=True, blank=True)
    demo_uploaded_at = models.DateTimeField(null=True, blank=True)
    match_ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Pracc"
        verbose_name_plural = "Praccs"
        ordering = ["-scheduled_at"]

    def __str__(self):
        return f"{self.own_team.name} vs. {self.opponent_team_name} ({self.scheduled_at:%Y-%m-%d %H:%M})"
