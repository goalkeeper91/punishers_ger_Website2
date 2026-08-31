"""Thin wrapper around a self-hosted Ollama instance's HTTP API
(https://github.com/ollama/ollama/blob/main/docs/api.md), reached over the
internal Docker network - no API key, no external cost. Mirrors
faceit_integration/client.py's shape (small, synchronous, `requests`-based).
"""

from typing import Optional

import requests
from django.conf import settings

DEFAULT_TIMEOUT = 60  # seconds - local LLM inference, can genuinely take a while


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
        (simpler for our one-shot use case: build a prompt, get text back)."""
        try:
            response = requests.post(
                f"{self.base_url}/api/generate",
                json={"model": self.model, "prompt": prompt, "stream": False},
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
