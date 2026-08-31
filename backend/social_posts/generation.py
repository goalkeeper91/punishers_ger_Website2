"""Orchestrates creating one SocialPostDraft: builds the shared MatchContext,
generates the template image (always attempted - no external dependency)
and the three platform texts (skipped gracefully if Ollama isn't
configured/reachable), and saves everything as one draft row. Never raises -
called from background tasks/sync hooks that must not fail the actual match
sync/creation over a post-draft problem; failures are recorded on the row
itself (generation_error) instead."""

import logging

from .image_generation import generate_match_image
from .models import SocialPostDraft
from .ollama_client import OllamaError
from .text_generation import MatchContext, generate_post_texts

logger = logging.getLogger(__name__)


def generate_draft(
    *, team, post_type: str, opponent_name: str, competition_name: str | None = None,
    match_datetime=None, team_maps_won: int | None = None, opponent_maps_won: int | None = None,
    maps_summary: str | None = None, maps: list[dict] | None = None, opponent_logo_url: str | None = None,
) -> SocialPostDraft:
    ctx = MatchContext(
        team_name=team.name,
        opponent_name=opponent_name or "TBD",
        post_type=post_type,
        game=team.game,
        competition_name=competition_name,
        match_datetime=match_datetime,
        team_maps_won=team_maps_won,
        opponent_maps_won=opponent_maps_won,
        maps_summary=maps_summary,
        maps=maps,
        team_logo_path=team.image.path if team.image else None,
        opponent_logo_url=opponent_logo_url,
    )

    draft = SocialPostDraft(
        team=team,
        post_type=post_type,
        opponent_name=opponent_name,
        competition_name=competition_name,
        match_datetime=match_datetime,
        team_maps_won=team_maps_won,
        opponent_maps_won=opponent_maps_won,
        maps_summary=maps_summary,
        maps=maps,
        opponent_logo_url=opponent_logo_url,
    )

    errors = []

    try:
        draft.image.save("social_post.png", generate_match_image(ctx), save=False)
    except Exception as exc:
        logger.exception("Bild-Generierung für Social-Post-Entwurf fehlgeschlagen")
        errors.append(f"Bild: {exc}")

    try:
        texts, text_errors = generate_post_texts(ctx)
        draft.text_facebook = texts.get("facebook", "")
        draft.text_instagram = texts.get("instagram", "")
        draft.text_x = texts.get("x", "")
        if text_errors:
            # All three platforms usually fail for the identical reason
            # (Ollama unreachable/misconfigured) - collapse to one message
            # instead of repeating it three times; only fall back to a
            # per-platform breakdown when the failures actually differ.
            unique_messages = list(dict.fromkeys(text_errors.values()))
            if len(unique_messages) == 1:
                errors.append(f"Text fehlt für {', '.join(text_errors)}: {unique_messages[0]}")
            else:
                detail = "; ".join(f"{platform}: {message}" for platform, message in text_errors.items())
                errors.append(f"Text fehlt für {', '.join(text_errors)} ({detail})")
    except OllamaError as exc:
        # Most commonly OLLAMA_BASE_URL just isn't configured - not a real
        # error worth alarming over, the image-only draft is still useful.
        logger.warning("Ollama-Textgenerierung übersprungen: %s", exc)
        errors.append(f"Text: {exc}")

    draft.generation_error = " | ".join(errors) if errors else None
    draft.save()
    return draft
