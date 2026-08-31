"""Builds the three platform-specific post texts for one match, via a
self-hosted Ollama model (see ollama_client.py). Three separate prompts/
calls instead of one combined prompt - more LLM calls, but each response is
simple free text instead of a structured format the model would need to be
trusted to format correctly (no parsing/splitting to get subtly wrong)."""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from .ollama_client import OllamaClient, OllamaError

logger = logging.getLogger(__name__)


@dataclass
class MatchContext:
    team_name: str
    opponent_name: str
    post_type: str  # 'announcement' | 'result'
    game: Optional[str] = None  # Team.game, e.g. "Counter-Strike 2" - drives the image's per-game accent color/watermark
    competition_name: Optional[str] = None
    match_datetime: Optional[datetime] = None
    team_maps_won: Optional[int] = None
    opponent_maps_won: Optional[int] = None
    maps_summary: Optional[str] = None
    # Structured per-map results for the image template's maps-played row
    # (see social_posts/image_generation.py _draw_maps_row) - one dict per
    # map: {"name": str, "team_score": int|None, "opponent_score": int|None,
    # "result": "win"|"loss"|"draw"|None}. Deliberately separate from
    # maps_summary above (a flat string for the LLM text prompt) rather than
    # deriving one from the other - the two have different shapes for
    # different consumers, and keeping them independent means neither
    # rendering path has to parse the other's format back apart.
    maps: Optional[list[dict]] = None
    team_logo_path: Optional[str] = None  # local filesystem path (Team.image), no network fetch needed
    opponent_logo_url: Optional[str] = None  # FACEIT avatar URL - only present for synced matches

    @property
    def result_word(self) -> Optional[str]:
        if self.team_maps_won is None or self.opponent_maps_won is None:
            return None
        if self.team_maps_won > self.opponent_maps_won:
            return "Sieg"
        if self.team_maps_won < self.opponent_maps_won:
            return "Niederlage"
        return "Unentschieden"

    def facts_block(self) -> str:
        lines = [f"Team: {self.team_name}", f"Gegner: {self.opponent_name}"]
        if self.game:
            lines.append(f"Spiel: {self.game}")
        if self.competition_name:
            lines.append(f"Wettbewerb: {self.competition_name}")
        if self.match_datetime:
            lines.append(f"Datum/Uhrzeit: {self.match_datetime.strftime('%d.%m.%Y, %H:%M')} Uhr")
        if self.post_type == "result":
            if self.team_maps_won is not None and self.opponent_maps_won is not None:
                lines.append(f"Ergebnis: {self.result_word} ({self.team_maps_won}:{self.opponent_maps_won} Maps)")
            if self.maps_summary:
                lines.append(f"Maps im Detail: {self.maps_summary}")
        return "\n".join(lines)


PLATFORM_INSTRUCTIONS = {
    "facebook": (
        "Schreibe einen Facebook-Post auf Deutsch für einen Esport-Verein (Punishers Germany). "
        "Etwas ausführlicher und informativer als für andere Plattformen erlaubt, aber trotzdem knackig "
        "(max. ca. 500 Zeichen). Maximal 1-2 passende Emojis. Kein Hashtag-Spam (max. 2-3 am Ende)."
    ),
    "instagram": (
        "Schreibe eine Instagram-Caption auf Deutsch für einen Esport-Verein (Punishers Germany). "
        "Locker, community-nah, gerne mit 2-4 passenden Emojis. Max. ca. 300 Zeichen Fließtext, "
        "danach 4-6 relevante Hashtags in einer neuen Zeile (z.B. #Esport #CS2 #PunishersGermany)."
    ),
    "x": (
        "Schreibe einen Tweet auf Deutsch für einen Esport-Verein (Punishers Germany). "
        "Sehr knapp und punchy, unbedingt unter 250 Zeichen inklusive Leerzeichen. "
        "Maximal 1 Emoji, maximal 2 Hashtags."
    ),
}


def _build_prompt(platform: str, ctx: MatchContext) -> str:
    intent = (
        "Kündige das folgende bevorstehende Match an, baue Vorfreude/Hype auf."
        if ctx.post_type == "announcement"
        else "Berichte über das folgende, bereits gespielte Match und sein Ergebnis."
    )
    return (
        f"{PLATFORM_INSTRUCTIONS[platform]}\n\n"
        f"{intent}\n\n"
        f"Fakten (nutze nur diese, erfinde nichts dazu):\n{ctx.facts_block()}\n\n"
        "Gib NUR den fertigen Post-Text zurück, ohne Anführungszeichen, ohne Erklärung, ohne Vorspann."
    )


def generate_post_texts(ctx: MatchContext) -> dict[str, str]:
    """Returns {"facebook": ..., "instagram": ..., "x": ...} - a platform
    missing from the result means its generation call failed; the caller
    (generation.py) decides how to surface that (e.g. leaving that field
    blank on the draft, recording generation_error)."""
    client = OllamaClient()  # raises OllamaError immediately if unconfigured
    texts: dict[str, str] = {}
    for platform in ("facebook", "instagram", "x"):
        try:
            texts[platform] = client.generate(_build_prompt(platform, ctx))
        except OllamaError:
            logger.exception("Ollama-Textgenerierung für Plattform '%s' fehlgeschlagen", platform)
    return texts
