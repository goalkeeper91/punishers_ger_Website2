"""In-process background thread subscribed to the Discord bot's `discord:status`
Redis channel (see bot-plattform's services/discord-bot/app/events/guild_events.py),
keeping the local DiscordGuild table in sync with which servers the bot is
actually in. Started/stopped from fastapi_app/main.py's lifespan, the same
way as faceit_integration/scheduler.py's start_scheduler()/stop_scheduler().

A plain thread (not asyncio) since redis-py's sync pubsub().listen() is a
simple blocking generator - no need to run this inside FastAPI's event loop.
"""

import json
import logging
import threading
from typing import Optional

import redis
from django.db import close_old_connections

from .models import DiscordGuild
from .redis_bridge import get_redis_client

logger = logging.getLogger(__name__)

STATUS_CHANNEL = "discord:status"
RECONNECT_DELAY_SECONDS = 5

_thread: Optional[threading.Thread] = None
_client: Optional[redis.Redis] = None
_stop_event = threading.Event()


def _handle_message(payload: dict) -> None:
    event = payload.get("type")
    guild_id = payload.get("guild_id")
    if not guild_id:
        return
    guild_id = str(guild_id)

    close_old_connections()
    try:
        if event == "GUILD_JOINED":
            DiscordGuild.objects.update_or_create(
                guild_id=guild_id,
                defaults=dict(
                    name=payload.get("guild_name") or guild_id,
                    icon_url=payload.get("icon_url") or None,
                    member_count=payload.get("member_count") or 0,
                    is_active=True,
                ),
            )
            logger.info("Discord-Server beigetreten: %s (%s)", payload.get("guild_name"), guild_id)
        elif event == "GUILD_LEFT":
            DiscordGuild.objects.filter(guild_id=guild_id).update(is_active=False)
            logger.info("Discord-Server verlassen: %s", guild_id)
    finally:
        close_old_connections()


def _listen_loop() -> None:
    global _client
    while not _stop_event.is_set():
        try:
            _client = get_redis_client()
            pubsub = _client.pubsub()
            pubsub.subscribe(STATUS_CHANNEL)
            logger.info("Discord-Status-Listener verbunden (%s)", STATUS_CHANNEL)

            for message in pubsub.listen():
                if _stop_event.is_set():
                    break
                if message.get("type") != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                except (TypeError, ValueError):
                    logger.warning("Ungültiges discord:status-Payload: %s", message.get("data"))
                    continue
                _handle_message(payload)

        except redis.RedisError as exc:
            if not _stop_event.is_set():
                logger.warning("Discord-Status-Listener Redis-Fehler: %s - neuer Versuch in %ss", exc, RECONNECT_DELAY_SECONDS)
                _stop_event.wait(RECONNECT_DELAY_SECONDS)
        except Exception:
            if not _stop_event.is_set():
                logger.exception("Discord-Status-Listener unerwarteter Fehler - neuer Versuch in %ss", RECONNECT_DELAY_SECONDS)
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
    _thread = threading.Thread(target=_listen_loop, name="discord-status-listener", daemon=True)
    _thread.start()
    logger.info("Discord-Status-Listener gestartet.")


def stop_listener() -> None:
    global _thread, _client
    _stop_event.set()
    if _client is not None:
        try:
            _client.close()
        except Exception:
            pass
    _thread = None
