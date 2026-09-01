"""Thin wrapper around a self-hosted Ollama instance's HTTP API
(https://github.com/ollama/ollama/blob/main/docs/api.md), reached over the
internal Docker network - no API key, no external cost. Mirrors
faceit_integration/client.py's shape (small, synchronous, `requests`-based).
"""

import threading
from typing import Optional

import requests
from django.conf import settings

# CPU-only local inference on a modest VPS, so a cold model load (the
# model isn't currently resident - see KEEP_ALIVE below) plus generating a
# few hundred characters can genuinely take more than a minute; confirmed
# live (a facebook-platform call timed out at the previous 60s). Always
# runs in a background task with nobody waiting on the HTTP response, so a
# generous timeout costs nothing - better to wait than to silently drop a
# platform's text.
DEFAULT_TIMEOUT = 180  # seconds

# Ollama keeps a model resident in memory for a while after each request -
# its own default is 5 minutes. A self-hosted 3B model idles at a couple
# GB RSS while resident (confirmed live: ~2.5GB, a third of this box's
# total RAM) for a feature that only fires a few times a day, so there's a
# real incentive to let it unload between bursts - but too short a value
# just trades that memory for more frequent cold-load timeouts (see
# DEFAULT_TIMEOUT above - this was tried at "2m" and produced exactly that
# regression). Left at Ollama's own default rather than overridden more
# aggressively.
KEEP_ALIVE = "5m"

# Every /api/generate call blocks on CPU-bound local inference (no GPU on
# this box) for several seconds. generate_post_texts() alone already makes
# 3 sequential calls per draft; on top of that, several matches syncing/
# finishing in the same run each fire their own background task calling in
# independently - without this lock, those would all hit Ollama at once,
# spiking CPU against everything else running on the same host. A
# process-wide lock is enough (not a cross-process/Redis lock): the backend
# runs as a single uvicorn worker, single replica (see
# docker-entrypoint.sh's comment on why - the in-process APScheduler jobs
# can't run more than once either), so every request in this app, no
# matter which thread, shares this one lock.
_call_lock = threading.Lock()

# Ollama's own default temperature (~0.8) favors creative/varied phrasing -
# fine for a chatbot, a liability here: this content has to stay factually
# grounded (team/score/date must be exactly right, nothing invented), and a
# higher temperature makes a small model more likely to wander off-script
# into fabricated details (confirmed live: an unprompted "auf dem Weg zu
# unserem 2. Titel" that wasn't in the facts at all). Lower trades away a
# little variety for staying on-topic more reliably - a reasonable trade
# for a sports-results generator, less so for a general chat assistant.
TEMPERATURE = 0.35


class OllamaError(Exception):
    """Raised for missing config, non-2xx responses, or network failures."""


class OllamaClient:
    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None):
        self.base_url = (base_url or getattr(settings, "OLLAMA_BASE_URL", None) or "").rstrip("/")
        if not self.base_url:
            raise OllamaError(
                "OLLAMA_BASE_URL ist nicht gesetzt. In backend/.env eintragen "
                "(z.B. http://goalkeeper_ollama_prod:11434 - interner Docker-Netzwerk-Name)."
            )
        self.model = model or getattr(settings, "OLLAMA_MODEL", None) or "llama3.2:3b"

    def generate(self, prompt: str) -> str:
        """POST /api/generate with stream=False - waits for the complete
        response instead of consuming Ollama's default streaming NDJSON
        (simpler for our one-shot use case: build a prompt, get text back).
        Serialized via _call_lock (see above) and asks Ollama to release
        the model shortly after (keep_alive)."""
        try:
            with _call_lock:
                response = requests.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model, "prompt": prompt, "stream": False, "keep_alive": KEEP_ALIVE,
                        "options": {"temperature": TEMPERATURE},
                        # Reasoning-capable models (Qwen3 and friends) default
                        # to generating a hidden <think>...</think> chain
                        # before the actual answer - a lot more tokens, a
                        # lot more CPU time on a GPU-less box. Confirmed
                        # live: switching to qwen3:4b without this caused
                        # every call to blow through the 180s timeout and,
                        # worse, pegged Ollama's CPU badly enough to take
                        # the whole shared host down, not just this
                        # feature. Ollama ignores "think" for models that
                        # don't support it (e.g. llama3.2:3b), so this is a
                        # no-op today and a safety net for the next model
                        # swap.
                        "think": False,
                    },
                    timeout=DEFAULT_TIMEOUT,
                )
        except requests.RequestException as exc:
            raise OllamaError(f"Netzwerkfehler bei Ollama-Aufruf: {exc}") from exc

        if not response.ok:
            raise OllamaError(f"Ollama-API-Fehler {response.status_code}: {response.text[:300]}")

        data = response.json()
        text = (data.get("response") or "").strip()
        if not text:
            raise OllamaError("Ollama hat eine leere Antwort geliefert.")
        return text
