"""Builds the three platform-specific post texts for one match, via a
self-hosted Ollama model (see ollama_client.py). Three separate prompts/
calls instead of one combined prompt - more LLM calls, but each response is
simple free text instead of a structured format the model would need to be
trusted to format correctly (no parsing/splitting to get subtly wrong)."""

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from .ollama_client import OllamaClient, OllamaError

logger = logging.getLogger(__name__)

# match_datetime always arrives UTC-aware (FACEIT timestamps are parsed as
# such in faceit_integration/sync.py._parse_timestamp, and Django's own
# TIME_ZONE is 'UTC' too) - but every post is written for a German-speaking
# audience, so display must convert to local time. Without this, a 16:00
# CEST match rendered as "14:00 Uhr" in both the post text and the template
# image (confirmed live) while the admin UI, which explicitly converts to
# this same zone, correctly showed 16:00.
DISPLAY_TZ = ZoneInfo("Europe/Berlin")


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
    def local_match_datetime(self) -> Optional[datetime]:
        """match_datetime converted to Europe/Berlin - use this (not
        match_datetime directly) for anything shown to a human. See
        DISPLAY_TZ above."""
        if self.match_datetime is None:
            return None
        return self.match_datetime.astimezone(DISPLAY_TZ)

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
        if self.local_match_datetime:
            lines.append(f"Datum/Uhrzeit: {self.local_match_datetime.strftime('%d.%m.%Y, %H:%M')} Uhr")
        if self.post_type == "result":
            if self.team_maps_won is not None and self.opponent_maps_won is not None:
                lines.append(f"Ergebnis: {self.result_word} ({self.team_maps_won}:{self.opponent_maps_won} Maps)")
            if self.maps_summary:
                # maps_summary is either a real "name score, name score, ..."
                # per-map list (any multi-map series now, FACEIT-synced or
                # manually recorded - see faceit_integration/sync.py
                # _extract_series_maps) or, only for a Bo1 / a payload
                # without per-map data, one bare unscored map name. Phrased
                # vaguely enough to cover both without implying the bare-name
                # case has its own score attached (a previous wording,
                # "Maps im Detail:", led the model to pair a single map name
                # with the Ergebnis line's SERIES score above as if it were
                # that map's own result - confirmed live, produced a
                # nonsensical "2:1 auf de_nuke").
                lines.append(f"Map-Info: {self.maps_summary}")
        return "\n".join(lines)


PLATFORM_INSTRUCTIONS = {
    "facebook": (
        "Schreibe einen Facebook-Post auf Deutsch aus Sicht des Esport-Teams Punishers Germany. "
        "Persönlich und herzlich, wie jemand aus dem Team, der direkt mit seiner Community spricht - "
        "kein nüchterner Vereinsbericht. Etwas ausführlicher als auf anderen Plattformen erlaubt, "
        "aber trotzdem knackig (max. ca. 500 Zeichen). Maximal 1-2 passende Emojis. "
        "Kein Hashtag-Spam (max. 2-3 am Ende)."
    ),
    "instagram": (
        "Schreibe eine Instagram-Caption auf Deutsch aus Sicht des Esport-Teams Punishers Germany. "
        "Locker, nahbar und voller Teamgeist, gerne mit 2-4 passenden Emojis. Max. ca. 300 Zeichen "
        "Fließtext, danach 4-6 relevante Hashtags in einer neuen Zeile "
        "(z.B. #Esport #CS2 #PunishersGermany)."
    ),
    "x": (
        "Schreibe einen Tweet auf Deutsch aus Sicht des Esport-Teams Punishers Germany. "
        "Kurz, emotional und punchy, unbedingt unter 250 Zeichen inklusive Leerzeichen. "
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


# What the post should make the reader FEEL, by occasion. Kept as a short,
# occasion-specific hint (instead of one long tone section listing all four
# cases) because a small local model follows a focused instruction far more
# reliably than a long list it has to pick the relevant entry from.
_TONE_BY_OCCASION = {
    "announcement": "Baue Vorfreude auf: Die Community soll Lust bekommen, mitzufiebern und das Team anzufeuern.",
    "Sieg": "Feiere gemeinsam mit der Community und bedanke dich bei allen, die mitgefiebert haben.",
    "Niederlage": (
        "Sei ehrlich und rede nichts schön, aber zeige Zusammenhalt: Wir stehen auch nach einem "
        "schweren Match zusammen. Respektvoll gegenüber dem Gegner, keine Ausreden."
    ),
    "Unentschieden": "Ordne das Ergebnis souverän und positiv ein, ohne mehr hineinzudeuten als in den Fakten steht.",
}

# One hand-written example post per occasion and platform. A small model
# imitates a concrete example far better than it follows an abstract "write
# warm, personal, inclusive" instruction - and the examples are where the
# actual voice (belonging, invitation, gratitude) is pinned down. They use a
# made-up match on purpose; the prompt tells the model to take only the tone,
# and _draft_problems rejects any draft that leaks the example's names
# (_EXAMPLE_MARKERS) or numbers.
_STYLE_EXAMPLES: dict[tuple[str, str], str] = {
    ("announcement", "facebook"): (
        "Matchday bei Punishers Germany! 🔥 Am 12.03. um 19:00 Uhr treten wir gegen Team Beispiel an - "
        "und wir wollen euch dabei haben. Schaut vorbei, fiebert mit uns und feuert unser Team an. "
        "Gemeinsam sind wir einfach stärker! 💪"
    ),
    ("announcement", "instagram"): (
        "Matchday! 🔥 Am 12.03. um 19:00 Uhr geht es für unser Team gegen Team Beispiel los. "
        "Seid dabei, fiebert mit und zeigt, dass ihr hinter uns steht - gemeinsam sind wir Punishers! 💙\n\n"
        "#Esport #PunishersGermany"
    ),
    ("announcement", "x"): (
        "Matchday! 🔥 Am 12.03. um 19:00 Uhr treten wir gegen Team Beispiel an. "
        "Fiebert mit und feuert uns an - gemeinsam sind wir Punishers! #PunishersGermany"
    ),
    ("Sieg", "facebook"): (
        "Was für ein Match! 🏆 Unser Team hat Team Beispiel mit 2:0 Maps geschlagen. Dieser Sieg gehört "
        "euch allen, die mit uns mitgefiebert haben - danke, dass ihr hinter uns steht! "
        "Das feiern wir jetzt gemeinsam."
    ),
    ("Sieg", "instagram"): (
        "Sieg! 🏆🔥 Unser Team hat Team Beispiel mit 2:0 Maps bezwungen. Danke an jeden, der mitgefiebert "
        "hat - ihr seid der Grund, warum wir alles geben! 💙\n\n#Esport #PunishersGermany"
    ),
    ("Sieg", "x"): (
        "Sieg! 🏆 2:0 Maps gegen Team Beispiel - danke an alle, die mitgefiebert haben. "
        "Das feiern wir gemeinsam! #PunishersGermany"
    ),
    ("Niederlage", "facebook"): (
        "Leider nicht unser Match: Unser Team musste sich Team Beispiel mit 0:2 Maps geschlagen geben. "
        "Das tut weh, aber wir sind ein Team - und ihr steht auch in solchen Momenten hinter uns. "
        "Danke dafür! Wir lernen daraus und greifen an. 💪"
    ),
    ("Niederlage", "instagram"): (
        "Das hat leider nicht gereicht: 0:2 Maps gegen Team Beispiel. Das tut weh - aber wir bleiben "
        "zusammen und greifen an. Danke, dass ihr auch jetzt hinter uns steht! 💙\n\n#Esport #PunishersGermany"
    ),
    ("Niederlage", "x"): (
        "0:2 Maps gegen Team Beispiel - das war leider nichts. Wir stehen zusammen und greifen an. "
        "Danke an alle, die hinter uns stehen! #PunishersGermany"
    ),
    ("Unentschieden", "facebook"): (
        "Unentschieden! ⚔️ Unser Team und Team Beispiel trennen sich 1:1 Maps. Danke an alle, die "
        "mitgefiebert haben - ihr seid das Herz von Punishers Germany! 💙"
    ),
    ("Unentschieden", "instagram"): (
        "1:1 Maps - Unentschieden gegen Team Beispiel! ⚔️ Danke an alle, die mitgefiebert haben, "
        "ihr seid das Herz von Punishers Germany. 💙\n\n#Esport #PunishersGermany"
    ),
    ("Unentschieden", "x"): (
        "Unentschieden: 1:1 Maps gegen Team Beispiel. ⚔️ Danke fürs Mitfiebern, "
        "ihr seid das Herz von Punishers Germany! #PunishersGermany"
    ),
}

# Names that only exist in _STYLE_EXAMPLES - if one shows up in a draft the
# model copied the example instead of writing about the real match.
_EXAMPLE_MARKERS = ("Team Beispiel",)


def _occasion(ctx: MatchContext) -> str:
    return "announcement" if ctx.post_type == "announcement" else (ctx.result_word or "")


def _tone_hint(ctx: MatchContext) -> str:
    return _TONE_BY_OCCASION.get(_occasion(ctx), "")


def _style_example_block(platform: str, ctx: MatchContext) -> str:
    example = _STYLE_EXAMPLES.get((_occasion(ctx), platform))
    if not example:
        return ""
    return (
        "Stilvorbild (ein ANDERES Match - übernimm daraus keine Namen, Zahlen oder ganzen Sätze, "
        "nur den Ton und die Wärme):\n"
        f"{example}\n\n"
    )


# Hard length budget per platform, repeated at the very END of the prompt:
# a small model weighs the last instruction most, and the warmer tone
# instructions above otherwise make it ramble (a first draft of this prompt
# produced a 1200-character Facebook post against a 500-character target).
_LENGTH_RULE = {
    "facebook": "Länge: höchstens 4 Sätze und 500 Zeichen. Kürzer ist besser.",
    "instagram": "Länge: höchstens 3 kurze Sätze und 300 Zeichen (ohne Hashtags). Kürzer ist besser.",
    "x": "Länge: höchstens 2 kurze Sätze und 240 Zeichen inklusive Hashtags. Kürzer ist besser.",
}


def _build_prompt(platform: str, ctx: MatchContext) -> str:
    intent = (
        "Kündige das folgende bevorstehende Match an."
        if ctx.post_type == "announcement"
        else "Berichte über das folgende, bereits gespielte Match und sein Ergebnis."
    )
    tone_hint = _tone_hint(ctx)
    tone_line = f"- {tone_hint}\n" if tone_hint else ""
    return (
        f"{PLATFORM_INSTRUCTIONS[platform]}\n\n"
        f"{intent}\n\n"
        f"Fakten (dies ist ALLES was du weißt):\n{ctx.facts_block()}\n\n"
        "Stimmung und Haltung (sehr wichtig):\n"
        "- Wer den Post liest, soll sich als Teil von Punishers Germany fühlen oder dazugehören "
        "wollen: Wir-Gefühl und Teamgeist. Sprich von 'unserem Team', 'unserer Community', 'bei uns'.\n"
        "- Lade die Leser herzlich ein mitzufiebern, anzufeuern oder mitzufeiern.\n"
        "- Warm und persönlich wie unter Freunden, keine Pressemitteilungs-Sprache "
        "(kein 'wir freuen uns, bekannt zu geben').\n"
        f"{tone_line}\n"
        f"{_style_example_block(platform, ctx)}"
        "Wichtige Regeln:\n"
        "- Nutze NUR die obigen Fakten. Gefühle und Haltung sind erlaubt, erfundene Fakten nicht: "
        "Beschreibe NICHT den Spielverlauf, die Stimmung in der Halle oder einzelne Szenen, und "
        "erfinde keine Turniertitel, Serien, Saisonstarts, Historie, Rivalitäten oder Zahlen. "
        "Verwende keine Wörter wie 'wieder', 'erneut', 'endlich', 'weiterhin', 'heute' oder 'gestern' - "
        "sie behaupten etwas, das nicht in den Fakten steht. Wenn du unsicher bist, lass es weg.\n"
        "- Behaupte NICHTS über offene Plätze, Tryouts, Aufnahme oder Rekrutierung.\n"
        "- Schreibe in natürlichem, grammatikalisch korrektem Deutsch - keine wörtlich aus dem "
        "Englischen übersetzt klingenden Redewendungen.\n"
        "- Adressiere die Leser AUSSCHLIESSLICH mit 'ihr'/'euch' (Plural, du sprichst eine ganze "
        "Community an, keine einzelne Person) - NIEMALS 'du'/'dich' (Singular) und NIEMALS die "
        "Höflichkeitsform 'Sie'/'Ihnen'. Genau eine Anredeform im ganzen Post, kein Wechsel. "
        "Beginne den Post nicht mit 'ihr'.\n"
        "- Sprich als das Team ('wir'), niemals als Einzelperson ('ich').\n"
        "- Gib NUR den reinen Text zurück, OHNE ihn in Anführungszeichen einzupacken.\n\n"
        f"{_LENGTH_RULE[platform]}\n"
        "Gib NUR den fertigen Post-Text zurück, ohne Anführungszeichen, ohne Erklärung, ohne Vorspann."
    )


_QUOTE_CHARS = '"\'„“”‚‘’»«'


def _strip_wrapping_quotes(text: str) -> str:
    """The prompt explicitly says not to wrap the response in quotation
    marks, but a model doesn't always comply (confirmed live) - relying on
    prompt compliance alone isn't reliable enough for something this cheap
    to just fix outright. Only acts when the text STARTS with a quote
    character - a post that happens to contain a quote somewhere in the
    middle (e.g. quoting someone) is left untouched. The closing quote
    isn't assumed to be the very last character either: a model sometimes
    tacks on a hashtag after the closing quote (confirmed live: '"...text
    ..." #Hashtag') - so this finds the LAST quote-like character anywhere
    in the text and treats everything after it (if any) as trailing
    content to keep, not part of the quoted body."""
    text = text.strip()
    if not text or text[0] not in _QUOTE_CHARS:
        return text
    closing_idx = max((text.rfind(ch) for ch in _QUOTE_CHARS), default=-1)
    if closing_idx <= 0:
        return text  # no matching closing quote found - leave the lone leading one alone
    inner = text[1:closing_idx].strip()
    trailing = text[closing_idx + 1:].strip()
    return f"{inner} {trailing}".strip() if trailing else inner


# --- Output guard ----------------------------------------------------------
# The warm, personal tone this module asks for also makes a small local model
# more prone to embellishing (observed with the first draft of the prompt:
# invented "Saisonstart", "Atmosphäre war elektrisch", 1200-character
# Facebook posts, "endlich wieder" for a team with no stated history). The
# prompt alone can't prevent that reliably, so each draft is checked for the
# failure modes that matter and, if it trips any, rewritten ONCE with the
# concrete problems named. Deliberately limited to mechanically checkable
# things - it cannot catch a wrong claim like attributing a lost map as won.

# Hard ceilings per platform (a little above the prompt's targets so a
# slightly-too-long but otherwise fine draft isn't rewritten for nothing).
_MAX_LENGTH = {"facebook": 650, "instagram": 450, "x": 270}

_HISTORY_RE = re.compile(r"\b(wieder|erneut|endlich|weiterhin|heute|gestern)\b", re.IGNORECASE)
# Singular "you" only - 'Sie'/'Ihr' are skipped on purpose: "sie" is also the
# ordinary third person ("sie haben stark gespielt") and "Ihr" is the plural
# "ihr" at a sentence start.
_SINGULAR_YOU_RE = re.compile(r"\b(du|dich|dir|dein|deine|deinen|deinem|deiner)\b", re.IGNORECASE)
_LEADING_IHR_RE = re.compile(r"^\W*(ihr|euch)\b", re.IGNORECASE)
_HASHTAG_RE = re.compile(r"#\w+")


def _draft_problems(text: str, platform: str, facts: str) -> list[str]:
    problems: list[str] = []
    if len(text) > _MAX_LENGTH[platform]:
        problems.append(f"zu lang ({len(text)} Zeichen, erlaubt sind höchstens {_MAX_LENGTH[platform]})")
    if _HISTORY_RE.search(text):
        problems.append(
            "enthält Wörter wie 'wieder', 'erneut', 'endlich', 'weiterhin', 'heute' oder 'gestern', "
            "die etwas behaupten, das nicht in den Fakten steht"
        )
    if _SINGULAR_YOU_RE.search(text):
        problems.append("spricht die Leser mit 'du'/'dich' an - erlaubt ist nur 'ihr'/'euch'")
    if _LEADING_IHR_RE.match(text):
        problems.append("beginnt mit 'ihr' - fange mit einem ganz normalen Satz an")
    if any(marker in text for marker in _EXAMPLE_MARKERS):
        problems.append("übernimmt Namen aus dem Stilvorbild - schreibe über das echte Match aus den Fakten")
    # Every number in the post must come from the facts (scores, dates...) -
    # hashtags are excluded since e.g. "#R6" legitimately carries a digit.
    allowed_numbers = set(re.findall(r"\d+", facts))
    invented = sorted(set(re.findall(r"\d+", _HASHTAG_RE.sub("", text))) - allowed_numbers)
    if invented:
        problems.append(f"nennt Zahlen, die nicht in den Fakten stehen: {', '.join(invented)}")
    return problems


def _trim_to_limit(text: str, limit: int) -> str:
    """Last-resort length cap for a draft that is still too long after its
    rewrite: keeps a trailing hashtag line intact, then cuts the body at the
    last full sentence that fits (or, failing that, at a word boundary)."""
    if len(text) <= limit:
        return text
    body, _, tail = text.rpartition("\n")
    if body and tail.strip() and all(token.startswith("#") for token in tail.split()):
        hashtags = tail.strip()
    else:
        body, hashtags = text, ""
    room = limit - (len(hashtags) + 2 if hashtags else 0)
    if len(body) > room:
        cut = body[:room]
        sentence_end = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"))
        if sentence_end >= room // 2:
            body = cut[: sentence_end + 1]
        else:
            body = cut.rsplit(" ", 1)[0].rstrip(" ,;:-") + "…"
    return f"{body}\n\n{hashtags}" if hashtags else body


def _generate_checked(client: OllamaClient, platform: str, ctx: MatchContext) -> str:
    prompt = _build_prompt(platform, ctx)
    facts = ctx.facts_block()
    text = _strip_wrapping_quotes(client.generate(prompt))
    problems = _draft_problems(text, platform, facts)
    if problems:
        logger.info("Entwurf für '%s' beanstandet (%s) - schreibe einmal neu", platform, "; ".join(problems))
        retry_prompt = (
            f"{prompt}\n\n"
            f"Dein letzter Entwurf war leider nicht brauchbar:\n{text}\n\n"
            f"Probleme: {'; '.join(problems)}.\n"
            "Schreibe den Post komplett neu und vermeide genau diese Probleme."
        )
        retry = _strip_wrapping_quotes(client.generate(retry_prompt))
        retry_problems = _draft_problems(retry, platform, facts)
        if len(retry_problems) <= len(problems):
            text, problems = retry, retry_problems
        if problems:
            logger.warning("Entwurf für '%s' hat nach dem Neuschreiben weiterhin Probleme: %s", platform, "; ".join(problems))
    return _trim_to_limit(text, _MAX_LENGTH[platform])


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
            text = _generate_checked(client, platform, ctx)
            if platform in fallback_counts and "#" not in text:
                text = f"{text}\n\n{_fallback_hashtags(ctx, fallback_counts[platform])}"
            texts[platform] = text
        except OllamaError as exc:
            logger.exception("Ollama-Textgenerierung für Plattform '%s' fehlgeschlagen", platform)
            errors[platform] = str(exc)
    return texts, errors
