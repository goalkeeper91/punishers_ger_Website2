"""Sync Redis client wrapper - bridges PunishersGer to the org's CS2
gameserver control service, a separate deployment (see the sibling
`gameserver-plattform` repo, which mirrors bot-plattform's role: it alone
holds the Hetzner API token, VPS SSH key, and RCON access - PunishersGer only
ever publishes commands and reacts to status pushed back).

Reuses the same Redis instance already shared with bot-plattform (see
discord_bot/redis_bridge.py and DISCORD_REDIS_HOST/PORT in settings.py) on
the `goalkeeper_prod_network` Docker network - no second Redis needed, this
is just a different pub/sub channel pair on it.
"""

import json
import logging

import redis
from django.conf import settings

logger = logging.getLogger(__name__)

COMMANDS_CHANNEL = "gameserver:commands"


def get_redis_client() -> redis.Redis:
    return redis.Redis(
        host=settings.DISCORD_REDIS_HOST,
        port=settings.DISCORD_REDIS_PORT,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )


def publish_vps_power(power_on: bool) -> bool:
    """Requests the gameserver-plattform side power the whole VPS on/off via
    the Hetzner API. Never raises - a Redis outage just means the command
    doesn't go out; the caller should tell the admin, not crash the request."""
    payload = {"type": "POWER_VPS", "power_on": power_on}
    try:
        client = get_redis_client()
        client.publish(COMMANDS_CHANNEL, json.dumps(payload))
        return True
    except redis.RedisError as exc:
        logger.warning("Gameserver-Power-Befehl fehlgeschlagen: %s", exc)
        return False
