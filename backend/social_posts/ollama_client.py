"""Thin wrapper around a self-hosted Ollama instance's HTTP API
(https://github.com/ollama/ollama/blob/main/docs/api.md), reached over the
internal Docker network - no API key, no external cost. Mirrors
faceit_integration/client.py's shape (small, synchronous, `requests`-based).
"""

import threading
from typing import Optional

import requests
from django.conf import settings

DEFAULT_TIMEOUT = 60  # seconds - local LLM inference, can genuinely take a while

# Ollama keeps a model resident in memory for a while after each request
# (its own default is 5 minutes) - fine for a chat app taking requests
# constantly, wasteful here: a self-hosted 3B model idles at ~2.5GB RSS on
# a modest VPS (confirmed live: 33% of the box's total RAM) for a feature
# that only fires a few times a day (match sync events, manual admin
# clicks). A short keep_alive lets Ollama release that memory back to the
# rest of the stack (Postgres, the backend itself, ...) shortly after each
# generation burst, at the cost of a few seconds' reload latency on the
# next one - an easy trade for a background task nobody is watching live.
KEEP_ALIVE = "2m"

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
                    json={"model": self.model, "prompt": prompt, "stream": False, "keep_alive": KEEP_ALIVE},
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
