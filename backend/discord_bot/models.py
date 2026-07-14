from django.db import models


class DiscordGuild(models.Model):
    """One Discord server the bot has been invited to. Rows are upserted by
    discord_bot/listener.py from the bot's GUILD_JOINED/GUILD_LEFT Redis
    events (see services/discord-bot/app/events/guild_events.py in the
    separate bot-plattform repo) - never created/edited by hand."""

    guild_id = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=200)
    icon_url = models.URLField(max_length=500, blank=True, null=True)
    member_count = models.PositiveIntegerField(default=0)
    # False on GUILD_LEFT rather than deleting the row, so channel mappings
    # aren't silently lost if the bot briefly leaves and rejoins.
    is_active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Discord-Server"
        verbose_name_plural = "Discord-Server"
        ordering = ["name"]
        permissions = [
            ("manage_discord_bot", "Discord-Bot verwalten"),
        ]

    def __str__(self):
        return self.name


class AnnouncementChannelMapping(models.Model):
    """Which Discord channel a given announcement type should be posted to,
    for one guild. Manually configured (channel_id typed in by an admin) -
    the bot doesn't expose a live per-guild channel list today, see the plan
    this app was built from."""

    EVENT_TYPE_CHOICES = [
        ("match_result", "Match-Ergebnisse"),
        ("news_published", "Neue News-Artikel"),
        ("stream_live", "Stream-Start"),
    ]

    guild = models.ForeignKey(DiscordGuild, on_delete=models.CASCADE, related_name="channel_mappings")
    event_type = models.CharField(max_length=30, choices=EVENT_TYPE_CHOICES)
    channel_id = models.CharField(max_length=32)
    # Free-text admin note (e.g. "#match-ergebnisse") - we can't resolve the
    # real channel name without the live-channel-list protocol this app
    # deliberately doesn't build (see plan).
    channel_label = models.CharField(max_length=100, blank=True)

    class Meta:
        verbose_name = "Ankündigungs-Kanal"
        verbose_name_plural = "Ankündigungs-Kanäle"
        unique_together = [("guild", "event_type")]

    def __str__(self):
        return f"{self.guild.name} / {self.get_event_type_display()}"


class AnnouncementLog(models.Model):
    EVENT_TYPE_CHOICES = AnnouncementChannelMapping.EVENT_TYPE_CHOICES + [("manual", "Manuell")]

    event_type = models.CharField(max_length=30, choices=EVENT_TYPE_CHOICES)
    guild = models.ForeignKey(DiscordGuild, on_delete=models.SET_NULL, null=True, blank=True)
    channel_id = models.CharField(max_length=32)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    # Null for automatic triggers (match result, news published, stream live).
    triggered_by = models.ForeignKey(
        "users.CustomUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="discord_announcements"
    )
    success = models.BooleanField(default=True)
    error_message = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Discord-Ankündigung"
        verbose_name_plural = "Discord-Ankündigungen"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} ({self.created_at:%Y-%m-%d %H:%M})"


class VoiceChannelTrigger(models.Model):
    """One "join this channel and get your own temporary voice channel"
    trigger. The actual create-on-join/delete-when-empty logic already lives
    in bot-plattform's events/voice_events.py - this row only gets pushed to
    the bot over Redis (see redis_bridge.publish_guild_config) so it knows
    which channels are triggers and how to configure what it creates."""

    guild = models.ForeignKey(DiscordGuild, on_delete=models.CASCADE, related_name="voice_triggers")
    trigger_channel_id = models.CharField(max_length=32)
    category_id = models.CharField(max_length=32, help_text="Kategorie, in der die neuen Kanäle entstehen.")
    name_prefix = models.CharField(max_length=50, default="Voice")
    user_limit = models.PositiveSmallIntegerField(null=True, blank=True, help_text="Leer = kein Limit.")
    is_private = models.BooleanField(default=False, help_text="Nur der Ersteller sieht/betritt den Kanal.")

    class Meta:
        verbose_name = "Sprachkanal-Trigger"
        verbose_name_plural = "Sprachkanal-Trigger"
        unique_together = [("guild", "trigger_channel_id")]

    def __str__(self):
        return f"{self.guild.name} / {self.trigger_channel_id}"


class RuleAcceptanceConfig(models.Model):
    """Reaction-role used to grant the "Verified Member" (or similar) role
    when a user reacts to the rules message - see bot-plattform's
    events/rule_role_events.py. The admin creates/pins the actual message in
    Discord by hand and pastes its ID here (same manual-ID pattern as
    AnnouncementChannelMapping.channel_id - the bot doesn't expose a live
    message picker)."""

    guild = models.OneToOneField(DiscordGuild, on_delete=models.CASCADE, related_name="rule_role")
    rules_channel_id = models.CharField(max_length=32)
    message_id = models.CharField(max_length=32)
    emoji = models.CharField(max_length=16, default="✅")
    role_id = models.CharField(max_length=32)
    enabled = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Regel-Akzeptanz"
        verbose_name_plural = "Regel-Akzeptanz"

    def __str__(self):
        return f"{self.guild.name} / Regel-Akzeptanz"
