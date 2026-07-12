from django.conf import settings
from django.db import models

# Reuse the same platform set as sponsors.SocialLink (org channels) so
# players and the org are always compared on the same axis.
PLATFORM_CHOICES = [
    ("twitch", "Twitch"),
    ("youtube", "YouTube"),
    ("twitter", "Twitter/X"),
    ("instagram", "Instagram"),
    ("tiktok", "TikTok"),
]
DATA_SOURCE_CHOICES = [
    ("auto", "Automatisch synchronisiert"),
    ("manual", "Manuell gepflegt"),
]

# Beyond raw follower counts (which say little about actual sponsor value -
# bought/inactive followers inflate them), a real sponsor report needs
# engagement: how many people actually saw/interacted with content. These
# five are what the screenshot OCR and the manual-entry forms both fill in,
# named consistently across PlayerSocialStats/SocialLink/SocialStatsSnapshot
# below so a single constant drives model fields, schemas, and the OCR
# keyword map (see ocr_client.py) without them drifting out of sync.
ENGAGEMENT_METRIC_FIELDS = ["view_count", "like_count", "comment_count", "share_count", "reach_count", "impressions_count"]


class PlayerSocialStats(models.Model):
    """One row per (player, platform) with the player's audience size and
    engagement on that platform. YouTube syncs follower/view counts
    automatically (public Data API, no OAuth needed) and Twitch syncs
    follower counts automatically once the player connects their account
    (see TwitchAuthorization below) - every other metric here (and every
    other platform) is manually maintained, either typed in directly or
    read off an uploaded screenshot (see ocr_client.py) - never synced
    automatically, since none of these platforms expose engagement data
    through a free, key-only API."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='social_stats')
    platform = models.CharField(max_length=20, choices=PLATFORM_CHOICES)
    follower_count = models.PositiveIntegerField(blank=True, null=True)
    view_count = models.PositiveIntegerField(blank=True, null=True)
    like_count = models.PositiveIntegerField(blank=True, null=True)
    comment_count = models.PositiveIntegerField(blank=True, null=True)
    share_count = models.PositiveIntegerField(blank=True, null=True)
    reach_count = models.PositiveIntegerField(blank=True, null=True, help_text="Anzahl erreichter Accounts/Personen.")
    impressions_count = models.PositiveIntegerField(blank=True, null=True, help_text="Anzahl Anzeigen des Inhalts, inkl. Mehrfachansichten.")
    data_source = models.CharField(max_length=10, choices=DATA_SOURCE_CHOICES, default="manual")
    stats_updated_at = models.DateTimeField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Spieler-Social-Media-Statistik"
        verbose_name_plural = "Spieler-Social-Media-Statistiken"
        constraints = [
            models.UniqueConstraint(fields=["user", "platform"], name="unique_player_platform_stats"),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.get_platform_display()}"


class TwitchAuthorization(models.Model):
    """One Twitch OAuth grant (moderator:read:followers scope), letting us
    read a channel's follower count going forward - Twitch removed public
    follower counts in 2023, so this consent from the broadcaster themselves
    is now the only way (see twitch_integration/client.py). Owned by
    exactly one of `user` (a player connecting their own channel) or
    `social_link` (an admin connecting one of the org's own channels) -
    enforced in the OAuth callback view, not a DB constraint, to keep this
    portable across the small SQLite/Postgres split this project already
    has."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name='twitch_authorization'
    )
    social_link = models.OneToOneField(
        'sponsors.SocialLink', on_delete=models.CASCADE, null=True, blank=True, related_name='twitch_authorization'
    )
    twitch_user_id = models.CharField(max_length=64)
    twitch_login = models.CharField(max_length=100)
    # Plain-text like the rest of this project's credential storage (Django's
    # own session/password infra aside) - protected by the same DB access
    # boundary as everything else, never returned via any API response.
    access_token = models.TextField()
    refresh_token = models.TextField()
    token_expires_at = models.DateTimeField()

    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Twitch-Autorisierung"
        verbose_name_plural = "Twitch-Autorisierungen"

    def __str__(self):
        return f"Twitch: {self.twitch_login}"


class SocialStatsSnapshot(models.Model):
    """One point-in-time follower/view measurement, appended (never
    overwritten) every time a number is set - via auto-sync, manual entry,
    a Twitch OAuth connect, or screenshot OCR. This is what makes "growth
    over time" possible without any extra platform integration: it's just
    historical bookkeeping of numbers already being collected. Owned by
    exactly one of `user` or `social_link`, same convention as
    TwitchAuthorization above."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name='social_stats_snapshots'
    )
    social_link = models.ForeignKey(
        'sponsors.SocialLink', on_delete=models.CASCADE, null=True, blank=True, related_name='snapshots'
    )
    platform = models.CharField(max_length=20, choices=PLATFORM_CHOICES)
    follower_count = models.PositiveIntegerField(blank=True, null=True)
    view_count = models.PositiveIntegerField(blank=True, null=True)
    like_count = models.PositiveIntegerField(blank=True, null=True)
    comment_count = models.PositiveIntegerField(blank=True, null=True)
    share_count = models.PositiveIntegerField(blank=True, null=True)
    reach_count = models.PositiveIntegerField(blank=True, null=True)
    impressions_count = models.PositiveIntegerField(blank=True, null=True)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Social-Media-Reichweiten-Snapshot"
        verbose_name_plural = "Social-Media-Reichweiten-Snapshots"
        indexes = [
            models.Index(fields=["user", "platform", "recorded_at"]),
            models.Index(fields=["social_link", "platform", "recorded_at"]),
        ]

    def __str__(self):
        owner = self.user.username if self.user else str(self.social_link)
        return f"{owner} - {self.platform}: {self.follower_count} ({self.recorded_at:%Y-%m-%d})"


class TwitchViewerSnapshot(models.Model):
    """Point-in-time live-viewer count, logged opportunistically whenever
    the periodic social-stats sync finds a connected/linked Twitch channel
    live (see sync.py's sync_twitch_viewer_snapshots()). Sparse by nature -
    sampled every SOCIAL_STATS_SYNC_INTERVAL_MINUTES, not continuously -
    but still a directional "typical stream size" signal without needing a
    dedicated always-on poller."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name='twitch_viewer_snapshots'
    )
    social_link = models.ForeignKey(
        'sponsors.SocialLink', on_delete=models.CASCADE, null=True, blank=True, related_name='viewer_snapshots'
    )
    viewer_count = models.PositiveIntegerField()
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Twitch-Zuschauer-Snapshot"
        verbose_name_plural = "Twitch-Zuschauer-Snapshots"
        indexes = [
            models.Index(fields=["user", "recorded_at"]),
            models.Index(fields=["social_link", "recorded_at"]),
        ]

    def __str__(self):
        owner = self.user.username if self.user else str(self.social_link)
        return f"{owner}: {self.viewer_count} Zuschauer ({self.recorded_at:%Y-%m-%d %H:%M})"
