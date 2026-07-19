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


def _publish(payload: dict) -> bool:
    try:
        client = get_redis_client()
        client.publish(COMMANDS_CHANNEL, json.dumps(payload))
        return True
    except redis.RedisError as exc:
        logger.warning("Gameserver-Befehl (%s) fehlgeschlagen: %s", payload.get("type"), exc)
        return False


def publish_vps_power(power_on: bool) -> bool:
    """Requests the gameserver-plattform side power the whole VPS on/off via
    the Hetzner API. Never raises - a Redis outage just means the command
    doesn't go out; the caller should tell the admin, not crash the request."""
    return _publish({"type": "POWER_VPS", "power_on": power_on})


def publish_create_slot(slot) -> bool:
    """Asks the gameserver-plattform side to actually `docker run` this
    slot's container over SSH. `rcon_password` is decrypted automatically by
    ServerSlot.rcon_password's EncryptedTextField on read - this is the one
    place the plaintext value ever leaves PunishersGer's DB, sent once over
    the internal Redis instance, never logged or exposed via any API
    response (see ServerSlotSchema in fastapi_app/main.py, which omits it)."""
    return _publish({
        "type": "CREATE_SLOT",
        "slot_id": slot.id,
        "docker_container_name": slot.docker_container_name,
        "kind": slot.kind,
        "port": slot.port,
        "rcon_password": slot.rcon_password,
    })


def publish_slot_power(slot, start: bool) -> bool:
    return _publish({
        "type": "START_SLOT" if start else "STOP_SLOT",
        "slot_id": slot.id,
        "docker_container_name": slot.docker_container_name,
    })


def publish_delete_slot(slot) -> bool:
    return _publish({
        "type": "DELETE_SLOT",
        "slot_id": slot.id,
        "docker_container_name": slot.docker_container_name,
    })


def publish_load_config(slot, config) -> bool:
    """Asks the gameserver-plattform side to download `config.file` (a plain
    HTTP GET against this backend's own MEDIA_URL - the file isn't secret),
    push it into the slot's bind-mounted cfg dir via SFTP, then RCON
    `exec <filename>` on the running container. gameserver-plattform holds no
    DB of its own, so the RCON connection details (VPS IP, slot's game port
    doubling as the RCON port, decrypted rcon_password) have to ride along in
    this command the same way CREATE_SLOT's do - this is the one place this
    plaintext value crosses over, same as publish_create_slot() above."""
    return _publish({
        "type": "LOAD_CONFIG",
        "slot_id": slot.id,
        "docker_container_name": slot.docker_container_name,
        "config_id": config.id,
        "config_filename": config.file.name.rsplit("/", 1)[-1],
        "config_url": f"{settings.BACKEND_BASE_URL}{settings.MEDIA_URL}{config.file.name}",
        "host": slot.vps.ip_address,
        "port": slot.port,
        "rcon_password": slot.rcon_password,
    })


def publish_start_pracc(pracc) -> bool:
    """Asks the gameserver-plattform side to make sure the Pracc's assigned
    slot is actually running before the scheduled match starts - see
    Pracc's own docstring for why this deliberately stops there instead of
    auto-generating a full MatchZy match config. Reported back distinctly
    from a plain START_SLOT via PRACC_STATUS_CHANGED (see listener.py) so
    the Pracc's own status can react (revert to "scheduled" on failure)
    without conflating it with the slot's own status tracking."""
    return _publish({
        "type": "START_PRACC",
        "pracc_id": pracc.id,
        "slot_id": pracc.slot_id,
        "docker_container_name": pracc.slot.docker_container_name,
    })
