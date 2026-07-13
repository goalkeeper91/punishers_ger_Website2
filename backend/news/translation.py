"""Automated translation for news articles: detect what language an article
was written in, then machine-translate it into every other supported
language via a self-hosted LibreTranslate instance (free, local - same
rationale as the Tesseract OCR choice in social_stats/ocr_client.py, since
the org has no sponsor revenue yet to offset a paid translation API).

Unlike the static-UI-text i18n system (frontend/app/i18n/), this only ever
runs against real article content, and only for the languages the site
supports (frontend/app/i18n/config.ts SUPPORTED_LANGUAGES)."""

import logging

import requests
from django.conf import settings
from langdetect import DetectorFactory, LangDetectException, detect

from .models import NewsArticle, NewsArticleTranslation

logger = logging.getLogger(__name__)

# Mirrors frontend/app/i18n/config.ts SUPPORTED_LANGUAGES - keep in sync if
# a third language is ever added on either side.
SUPPORTED_LANGUAGES = ("de", "en")
DEFAULT_LANGUAGE = "de"
DEFAULT_TIMEOUT = 15  # seconds - translating a full article can take a moment


class TranslationAPIError(Exception):
    """Raised for missing config, non-2xx responses, or network failures."""


# langdetect's detection is non-deterministic across runs unless seeded -
# fixing the seed makes detect_language() reproducible for the same input.
DetectorFactory.seed = 0


def detect_language(text: str) -> str:
    """Best-effort detection of which supported language `text` is written
    in, defaulting to DEFAULT_LANGUAGE (the org's primary language) on
    empty/ambiguous input or anything outside SUPPORTED_LANGUAGES."""
    if not text or not text.strip():
        return DEFAULT_LANGUAGE
    try:
        detected = detect(text)
    except LangDetectException:
        return DEFAULT_LANGUAGE
    return detected if detected in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE


def translate_text(text: str, source: str, target: str) -> str:
    """Translates `text` from `source` to `target` via LibreTranslate.
    Raises TranslationAPIError if LIBRETRANSLATE_URL isn't configured, the
    service is unreachable, or it returns a non-2xx response."""
    base_url = settings.LIBRETRANSLATE_URL
    if not base_url:
        raise TranslationAPIError(
            "LIBRETRANSLATE_URL ist nicht gesetzt. In backend/.env eintragen "
            "(z.B. http://libretranslate:5000 im Docker-Setup, siehe docker-compose.yml)."
        )
    try:
        response = requests.post(
            f"{base_url.rstrip('/')}/translate",
            json={"q": text, "source": source, "target": target, "format": "text"},
            timeout=DEFAULT_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise TranslationAPIError(f"Netzwerkfehler beim LibreTranslate-Aufruf: {exc}") from exc
    if not response.ok:
        raise TranslationAPIError(f"LibreTranslate-Fehler {response.status_code}: {response.text[:300]}")

    translated = response.json().get("translatedText")
    if not translated:
        raise TranslationAPIError("LibreTranslate hat keinen übersetzten Text zurückgegeben.")
    return translated


def sync_translations_for_article(article: NewsArticle) -> None:
    """Detects `article`'s original language and upserts a
    NewsArticleTranslation row for every other supported language. Never
    raises - a LibreTranslate outage logs a warning and leaves whichever
    languages it couldn't reach untranslated (falling back to the original
    when served, see fastapi_app/main.py), exactly like every other optional
    external integration in this codebase."""
    detected = detect_language(f"{article.title}\n\n{article.content}")
    if article.original_language != detected:
        article.original_language = detected
        article.save(update_fields=["original_language"])

    for target in SUPPORTED_LANGUAGES:
        if target == detected:
            continue
        try:
            translated_title = translate_text(article.title, detected, target)
            translated_content = translate_text(article.content, detected, target)
        except TranslationAPIError:
            logger.warning(
                "Skipping %s translation for article %s (translation service unavailable)",
                target, article.id, exc_info=True,
            )
            continue

        NewsArticleTranslation.objects.update_or_create(
            article=article,
            language=target,
            defaults={
                "title": translated_title,
                "content": translated_content,
                "is_machine_translated": True,
            },
        )
