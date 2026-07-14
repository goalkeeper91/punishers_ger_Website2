"""Sync Redis client wrapper - the publish (announcements) and status-read
sides of the bridge to the org's Discord bot, a separate deployment (see
bot-plattform's services/discord-bot/). The bot and this backend's `backend`
container both join the same external `goalkeeper_prod_network` Docker
network in production, where a `redis` container from that other deployment
is already reachable - see DISCORD_REDIS_HOST/PORT in settings.py.

Uses the plain sync `redis` client (not `redis.asyncio`) since callers here
are either plain sync code (FACEIT sync, the background listener in
listener.py) or FastAPI endpoints that already wrap sync Django calls via
`sync_to_async` - no asyncio event loop needed on this side.
"""

import json
import logging
from typing import Optional

import redis
from django.conf import settings

from .models import AnnouncementLog, DiscordGuild, RuleAcceptanceConfig

logger = logging.getLogger(__name__)

STATUS_KEY = "discord_bot:status"
EVENTS_CHANNEL = "discord:events"
DEFAULT_EMBED_COLOR = 0x5865F2  # Discord "blurple"


def get_redis_client() -> redis.Redis:
    return redis.Redis(
        host=settings.DISCORD_REDIS_HOST,
        port=settings.DISCORD_REDIS_PORT,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )


def get_bot_status() -> Optional[dict]:
    """Reads the heartbeat key the discord-bot writes every 30s (see
    bot-plattform's services/discord-bot/app/senders/redis_sender.py).
    Returns None if the key is missing/expired (bot offline) or Redis is
    unreachable - callers render that as "offline", not an error."""
    try:
        client = get_redis_client()
        raw = client.get(STATUS_KEY)
    except redis.RedisError as exc:
        logger.warning("Discord-Bot-Status nicht abrufbar: %s", exc)
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def publish_notification(
    *,
    event_type: str,
    guild: Optional[DiscordGuild],
    channel_id: str,
    title: str,
    description: str = "",
    color: int = DEFAULT_EMBED_COLOR,
    fields: Optional[list[dict]] = None,
    triggered_by=None,
) -> bool:
    """Publishes a SEND_NOTIFICATION message on `discord:events` - the bot's
    existing, unchanged command contract (see bot-plattform's
    services/discord-bot/app/listeners/redis_listener.py) - and records an
    AnnouncementLog row either way. Never raises: a Redis outage degrades to
    a logged failure so callers (FACEIT sync, news publish, the Twitch-live
    poller) don't need their own try/except around this."""
    payload = {
        "type": "SEND_NOTIFICATION",
        "channel_id": str(channel_id),
        "embed": {
            "title": title,
            "description": description,
            "color": color,
            "fields": fields or [],
        },
    }
    success = True
    error_message = ""
    try:
        client = get_redis_client()
        client.publish(EVENTS_CHANNEL, json.dumps(payload))
    except redis.RedisError as exc:
        success = False
        error_message = str(exc)
        logger.error("Discord-Ankündigung fehlgeschlagen: %s", exc)

    AnnouncementLog.objects.create(
        event_type=event_type,
        guild=guild,
        channel_id=str(channel_id),
        title=title,
        description=description,
        triggered_by=triggered_by,
        success=success,
        error_message=error_message[:500],
    )
    return success


def _publish_reload_configs(guild_id: str, config_type: str, extra: dict) -> None:
    payload = {"type": "RELOAD_CONFIGS", "guild_id": str(guild_id), "config_type": config_type, **extra}
    try:
        client = get_redis_client()
        client.publish(EVENTS_CHANNEL, json.dumps(payload))
    except redis.RedisError as exc:
        logger.warning("Config-Sync (%s) für Guild %s fehlgeschlagen: %s", config_type, guild_id, exc)


def publish_guild_config(guild: DiscordGuild) -> None:
    """Pushes this guild's current Join-to-Create triggers and rule-role
    config to the bot as two RELOAD_CONFIGS messages (see bot-plattform's
    listeners/redis_listener.py, which now branches on config_type). Called
    on every dashboard save AND periodically by discord_bot/scheduler.py -
    Redis pub/sub has no replay, so a bot that restarted after the last save
    needs the periodic push to eventually converge. Never raises; a Redis
    outage just means the bot keeps running on its last-known config until
    the next successful push - same degrade-gracefully contract as
    publish_notification() above.

    Field names in `triggers` intentionally match bot-plattform's
    events/voice_events.py config dict exactly (channel_name_prefix,
    private_channel, ...), not this app's own model field names - that
    dict is fed directly into the bot's existing, unchanged
    create-on-join/delete-when-empty logic."""
    triggers = [
        {
            "channel_id": t.trigger_channel_id,
            "category_id": t.category_id,
            "channel_name_prefix": t.name_prefix,
            "user_limit": t.user_limit or 0,
            "private_channel": t.is_private,
            "enabled": True,
        }
        for t in guild.voice_triggers.all()
    ]
    _publish_reload_configs(guild.guild_id, "join_to_create", {"triggers": triggers})

    try:
        rule_role = guild.rule_role
    except RuleAcceptanceConfig.DoesNotExist:
        rule_role = None
    config = None
    if rule_role and rule_role.enabled:
        config = {
            "channel_id": rule_role.rules_channel_id,
            "message_id": rule_role.message_id,
            "emoji": rule_role.emoji,
            "role_id": rule_role.role_id,
        }
    _publish_reload_configs(guild.guild_id, "rule_role", {"config": config})
