"""In-process background thread subscribed to the gameserver-plattform
repo's `gameserver:status` Redis channel, keeping the local HetznerVPS row's
cached status in sync with reality (the actual Hetzner API polling and power
actions happen entirely on that side - see redis_bridge.py's module
docstring). Started/stopped from fastapi_app/main.py's lifespan, the same
way as discord_bot/listener.py's start_listener()/stop_listener().

A plain thread (not asyncio) since redis-py's sync pubsub().listen() is a
simple blocking generator - no need to run this inside FastAPI's event loop.
"""

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Optional

import redis
from django.db import close_old_connections

from .models import HetznerVPS, Pracc, ServerSlot
from .redis_bridge import get_redis_client

logger = logging.getLogger(__name__)

STATUS_CHANNEL = "gameserver:status"
RECONNECT_DELAY_SECONDS = 5

_thread: Optional[threading.Thread] = None
_client: Optional[redis.Redis] = None
_stop_event = threading.Event()


def _handle_message(payload: dict) -> None:
    event = payload.get("type")

    close_old_connections()
    try:
        if event == "VPS_STATUS_CHANGED":
            hetzner_server_id = payload.get("hetzner_server_id")
            new_status = payload.get("status")
            if not hetzner_server_id or not new_status:
                return
            updated = HetznerVPS.objects.filter(hetzner_server_id=str(hetzner_server_id)).update(
                last_known_status=new_status,
                last_synced_at=datetime.now(timezone.utc),
            )
            if updated:
                logger.info("VPS-Status aktualisiert: %s -> %s", hetzner_server_id, new_status)
            else:
                logger.warning("VPS_STATUS_CHANGED für unbekannte hetzner_server_id: %s", hetzner_server_id)

        elif event == "SLOT_STATUS_CHANGED":
            slot_id = payload.get("slot_id")
            new_status = payload.get("status")
            if not slot_id or not new_status:
                return
            updated = ServerSlot.objects.filter(id=slot_id).update(
                last_known_status=new_status,
                last_synced_at=datetime.now(timezone.utc),
            )
            if updated:
                logger.info("Slot-Status aktualisiert: %s -> %s", slot_id, new_status)
            else:
                logger.warning("SLOT_STATUS_CHANGED für unbekannte slot_id: %s", slot_id)

        elif event == "CONFIG_LOADED":
            slot_id = payload.get("slot_id")
            config_id = payload.get("config_id")
            success = payload.get("success", True)
            if not slot_id:
                return
            if not success:
                logger.warning(
                    "CONFIG_LOADED meldet Fehlschlag für Slot %s (Config %s): %s",
                    slot_id, config_id, payload.get("error"),
                )
                return
            updated = ServerSlot.objects.filter(id=slot_id).update(
                current_config_id=config_id,
                last_synced_at=datetime.now(timezone.utc),
            )
            if updated:
                logger.info("Config %s auf Slot %s geladen.", config_id, slot_id)
            else:
                logger.warning("CONFIG_LOADED für unbekannte slot_id: %s", slot_id)

        elif event == "PRACC_STATUS_CHANGED":
            # Reports back whether the assigned slot actually came up for a
            # Pracc that fastapi_app/main.py already optimistically marked
            # "live" - reverts to "scheduled" on failure (see
            # redis_bridge.py's publish_start_pracc() docstring), or just
            # confirms "live" on success.
            pracc_id = payload.get("pracc_id")
            new_status = payload.get("status")
            if not pracc_id or not new_status:
                return
            updated = Pracc.objects.filter(id=pracc_id).update(status=new_status)
            if updated:
                logger.info("Pracc-Status aktualisiert: %s -> %s", pracc_id, new_status)
            else:
                logger.warning("PRACC_STATUS_CHANGED für unbekannte pracc_id: %s", pracc_id)
    finally:
        close_old_connections()


def _listen_loop() -> None:
    global _client
    while not _stop_event.is_set():
        try:
            _client = get_redis_client()
            pubsub = _client.pubsub()
            pubsub.subscribe(STATUS_CHANNEL)
            logger.info("Gameserver-Status-Listener verbunden (%s)", STATUS_CHANNEL)

            for message in pubsub.listen():
                if _stop_event.is_set():
                    break
                if message.get("type") != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                except (TypeError, ValueError):
                    logger.warning("Ungültiges gameserver:status-Payload: %s", message.get("data"))
                    continue
                _handle_message(payload)

        except redis.RedisError as exc:
            if not _stop_event.is_set():
                logger.warning("Gameserver-Status-Listener Redis-Fehler: %s - neuer Versuch in %ss", exc, RECONNECT_DELAY_SECONDS)
                _stop_event.wait(RECONNECT_DELAY_SECONDS)
        except Exception:
            if not _stop_event.is_set():
                logger.exception("Gameserver-Status-Listener unerwarteter Fehler - neuer Versuch in %ss", RECONNECT_DELAY_SECONDS)
                _stop_event.wait(RECONNECT_DELAY_SECONDS)
        finally:
            if _client is not None:
                try:
                    _client.close()
                except Exception:
                    pass
                _client = None


def start_listener() -> None:
    global _thread
    if _thread is not None:
        return
    _stop_event.clear()
    _thread = threading.Thread(target=_listen_loop, name="gameserver-status-listener", daemon=True)
    _thread.start()
    logger.info("Gameserver-Status-Listener gestartet.")


def stop_listener() -> None:
    global _thread, _client
    _stop_event.set()
    if _client is not None:
        try:
            _client.close()
        except Exception:
            pass
    _thread = None
