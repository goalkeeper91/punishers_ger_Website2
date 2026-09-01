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
                # maps_summary is either one bare map name (FACEIT-synced
                # single row - see faceit_integration/sync.py) or a real
                # "name score, name score, ..." list (manually-recorded
                # multi-map series) - phrased vaguely enough to cover both
                # without implying the bare-name case has its own score
                # attached (a previous wording, "Maps im Detail:", led the
                # model to pair a single map name with the Ergebnis line's
                # SERIES score above as if it were that map's own result -
                # confirmed live, produced a nonsensical "2:1 auf de_nuke").
                lines.append(f"Map-Info: {self.maps_summary}")
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


# Per-game hashtag, same keyword-matching idea as image_generation.py's
# GAME_STYLES (kept separate/duplicated rather than shared - that dict also
# carries colors this module has no use for, and the keyword sets only
# need to agree loosely, not be a single source of truth).
_GAME_HASHTAGS: list[tuple[tuple[str, ...], str]] = [
    (("cs2", "counter-strike", "counter strike"), "#CS2"),
    (("valorant",), "#Valorant"),
    (("league of legends", "lol"), "#LoL"),
    (("rocket league",), "#RocketLeague"),
    (("rainbow six", "r6", "siege"), "#R6"),
]


def _fallback_hashtags(ctx: MatchContext, count: int) -> str:
    """A guaranteed-present hashtag line, used only when the model's own
    response didn't include any (see generate_post_texts) - PLATFORM_
    INSTRUCTIONS above already asks for hashtags, but a small local model
    (llama3.2:3b, no GPU on this box) doesn't reliably follow every
    formatting instruction in a long prompt, and "no hashtags at all" is
    worse for reach than "the same handful every time"."""
    tags = ["#PunishersGermany"]
    game_lower = (ctx.game or "").lower()
    for keywords, tag in _GAME_HASHTAGS:
        if any(kw in game_lower for kw in keywords):
            tags.append(tag)
            break
    tags += ["#Esport", "#Gaming", "#Team"]
    return " ".join(tags[:count])


def _build_prompt(platform: str, ctx: MatchContext) -> str:
    intent = (
        "Kündige das folgende bevorstehende Match an, baue Vorfreude/Hype auf."
        if ctx.post_type == "announcement"
        else "Berichte über das folgende, bereits gespielte Match und sein Ergebnis."
    )
    return (
        f"{PLATFORM_INSTRUCTIONS[platform]}\n\n"
        f"{intent}\n\n"
        f"Fakten (dies ist ALLES was du weißt):\n{ctx.facts_block()}\n\n"
        "Wichtige Regeln:\n"
        "- Nutze NUR die obigen Fakten. Erfinde keine zusätzlichen Details - keine Turniertitel, "
        "Serien-/Siegesstrecken, Historie, Rivalitäten oder Zahlen, die dort nicht explizit stehen. "
        "Wenn du unsicher bist, ob etwas stimmt, lass es weg statt es zu erwähnen.\n"
        "- Schreibe in natürlichem, grammatikalisch korrektem Deutsch - keine wörtlich aus dem "
        "Englischen übersetzt klingenden Redewendungen.\n\n"
        "Gib NUR den fertigen Post-Text zurück, ohne Anführungszeichen, ohne Erklärung, ohne Vorspann."
    )


def generate_post_texts(ctx: MatchContext) -> tuple[dict[str, str], dict[str, str]]:
    """Returns (texts, errors) - texts has {"facebook": ..., "instagram":
    ..., "x": ...} for whichever platforms succeeded; errors has the actual
    OllamaError message for whichever didn't (platform missing from texts
    <=> present in errors). The caller (generation.py) folds errors into
    the draft's generation_error so a failure is diagnosable from the admin
    UI itself (e.g. via the manual "jetzt generieren" trigger) instead of
    needing server log access - a bare "fehlt für: ..." with no reason was
    the previous behavior and wasn't enough to debug a real misconfig."""
    client = OllamaClient()  # raises OllamaError immediately if unconfigured
    # Only facebook/instagram get an enforced fallback - x's own instructions
    # cap it at 2 hashtags in an already very tight character budget, where
    # a guaranteed-but-generic line would cost more than it's worth.
    fallback_counts = {"facebook": 3, "instagram": 5}
    texts: dict[str, str] = {}
    errors: dict[str, str] = {}
    for platform in ("facebook", "instagram", "x"):
        try:
            text = client.generate(_build_prompt(platform, ctx))
            if platform in fallback_counts and "#" not in text:
                text = f"{text}\n\n{_fallback_hashtags(ctx, fallback_counts[platform])}"
            texts[platform] = text
        except OllamaError as exc:
            logger.exception("Ollama-Textgenerierung für Plattform '%s' fehlgeschlagen", platform)
            errors[platform] = str(exc)
    return texts, errors
