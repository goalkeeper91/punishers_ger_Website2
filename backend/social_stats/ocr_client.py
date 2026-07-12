"""Local, free OCR for social-media screenshots (Tesseract via pytesseract) -
chosen over a paid vision API since the org has no sponsors yet and needs to
keep running costs at zero. Precision is deliberately not perfect - every
number this module guesses is always shown back to a human (player/admin)
to confirm or correct before anything is saved (see the "Speichern" flow in
fastapi_app/main.py's update_org_social_stats/update_player_social_stats/
update_my_social_stats endpoints, which this only ever feeds suggested
starting values into).

One screenshot (e.g. an Instagram/TikTok insights card showing followers,
views, likes, comments, shares, reach and impressions all at once) can fill
several fields at once - see METRIC_KEYWORDS below, one entry per
social_stats.models.ENGAGEMENT_METRIC_FIELDS field (plus follower_count).

The screenshot itself is never written to disk here - Tesseract runs
directly on the in-memory image bytes, and those bytes go out of scope (and
get garbage collected) the moment the request finishes, per the "delete the
screenshot afterwards" requirement - there's nothing to delete because
nothing was ever persisted."""

import io
import re
from typing import Optional, TypedDict

import pytesseract
from PIL import Image, UnidentifiedImageError

# Matches numbers like "45.3K", "1,2M", "12,345", "12.345", "1234", "892" -
# the separator immediately before a K/M suffix is always a decimal point
# regardless of locale (nobody writes "45,300K"). Greedily consumes the
# whole digit run first (rather than grouping in 3s) so a plain "1234" with
# no separator isn't mis-split into "123" + "4" as two separate matches.
# No whitespace is allowed before the suffix (real usage is always tight,
# "45.3K") and it can't be followed by another letter - without both of
# those, a German "2.345 Kommentare" gets misread as "2.345" + a bogus "K"
# suffix, silently eating the label's leading letter and corrupting the
# keyword-matching context right after it.
NUMBER_RE = re.compile(r"(\d[\d,.]*\d|\d)([KkMm])?(?![a-zA-Z])")
CONTEXT_WINDOW = 20  # chars scanned before/after a number for a label keyword

# Order matters only in that earlier entries win when two metrics' keyword
# lists could both plausibly match the same number (rare, since the lists
# below are disjoint by construction). Keywords are matched as whole words
# (word-boundaried) to avoid substrings like "like" inside "likely".
METRIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "follower_count": ("follower", "followers", "abonnent", "abonnenten", "subscriber", "subscribers"),
    "like_count": ("likes", "like", "gefällt"),
    "comment_count": ("comments", "comment", "kommentare", "kommentar"),
    "share_count": ("shares", "share", "geteilt", "retweets", "retweet", "reposts", "repost"),
    "reach_count": ("reach", "reichweite"),
    "impressions_count": ("impressions", "impressionen"),
    "view_count": ("views", "view", "aufrufe", "wiedergaben", "plays"),
}
# "X Following" must never be misread as a follower_count match - "follow"
# is a substring of "following" too, so this needs its own explicit check.
FOLLOWING_EXCLUSION = ("following", "gefolgt")


class OcrResult(TypedDict):
    raw_text: str
    candidates: list[int]
    metrics: dict[str, int]


class OcrError(Exception):
    """Raised when Tesseract itself isn't installed/reachable, or the
    upload isn't a readable image - never for "couldn't find a number",
    which is a normal, expected outcome handled via an empty metrics dict."""


def _normalize(number_str: str, suffix: Optional[str]) -> Optional[int]:
    try:
        if suffix:
            base = float(number_str.replace(",", "."))
            multiplier = 1_000_000 if suffix.lower() == "m" else 1_000
            return int(base * multiplier)
        return int(number_str.replace(",", "").replace(".", ""))
    except ValueError:
        return None


def _has_keyword(context: str, keywords: tuple[str, ...]) -> bool:
    return any(re.search(rf"\b{re.escape(kw)}\b", context) for kw in keywords)


def extract_follower_candidates(image_bytes: bytes) -> OcrResult:
    try:
        image = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(image)
    except pytesseract.TesseractNotFoundError as exc:
        raise OcrError(
            "Tesseract-OCR ist auf dem Server nicht installiert. Siehe README "
            "'Environment-Variablen' / Setup für Installationshinweise."
        ) from exc
    except UnidentifiedImageError as exc:
        raise OcrError("Datei konnte nicht als Bild gelesen werden.") from exc

    candidates: list[int] = []
    raw_matches: list[tuple[int, int, int]] = []  # (start, end, value)
    for match in NUMBER_RE.finditer(text):
        number_str, suffix = match.groups()
        value = _normalize(number_str, suffix)
        if value is None or value <= 0:
            continue
        candidates.append(value)
        raw_matches.append((match.start(), match.end(), value))

    # Each number's "after" context stops at whichever comes first: the next
    # number, the next line break, or CONTEXT_WINDOW chars - so one line's
    # trailing label never bleeds into the next line's number. Computed as
    # a first pass so "before" context (below) can bound itself against the
    # PREVIOUS number's already-claimed "after" region specifically, rather
    # than against every line break - a label may still legitimately sit on
    # its own line just above a number (vertical stat cards), and that
    # cross-line reach must stay intact as long as the line above didn't
    # already have its own number claiming that text as ITS trailing label.
    after_boundaries: list[int] = []
    for i, (start, end, value) in enumerate(raw_matches):
        next_start = raw_matches[i + 1][0] if i + 1 < len(raw_matches) else len(text)
        next_newline = text.find("\n", end)
        if next_newline == -1:
            next_newline = len(text)
        after_boundaries.append(min(next_start, next_newline, end + CONTEXT_WINDOW))

    matches: list[tuple[int, str, str]] = []  # (value, before_context, after_context)
    for i, (start, end, value) in enumerate(raw_matches):
        prev_after_boundary = after_boundaries[i - 1] if i > 0 else 0
        before = text[max(prev_after_boundary, start - CONTEXT_WINDOW) : start].lower()
        after = text[end : after_boundaries[i]].lower()
        matches.append((value, before, after))

    def is_following_context(before: str, after: str) -> bool:
        return after.strip().startswith("following") or any(kw in before for kw in FOLLOWING_EXCLUSION)

    metrics: dict[str, int] = {}
    for metric_name, keywords in METRIC_KEYWORDS.items():
        # Instagram/Twitter/TikTok all show "<number> <label>" (label AFTER
        # the number, e.g. "45.3K followers") - that's the dominant
        # convention, checked first. "<label> <number>" (some
        # vertically-stacked stat cards) is only a fallback.
        found: Optional[int] = None
        for value, before, after in matches:
            if metric_name == "follower_count" and is_following_context(before, after):
                continue
            if _has_keyword(after, keywords):
                found = value
                break
        if found is None:
            for value, before, after in matches:
                if metric_name == "follower_count" and is_following_context(before, after):
                    continue
                if _has_keyword(before, keywords):
                    found = value
                    break
        if found is not None:
            metrics[metric_name] = found

    return {"raw_text": text.strip(), "candidates": candidates, "metrics": metrics}
