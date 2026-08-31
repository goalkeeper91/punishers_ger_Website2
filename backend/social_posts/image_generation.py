"""Renders the shared template image for a social post - one square
(1080x1080, the safe universal size across Facebook/Instagram/X previews)
PNG per match, built entirely with Pillow (already a dependency, see
fastapi_app/main.py's upload handling) rather than a headless-browser
screenshot: no extra runtime dependency, and full control over exactly
where team names/score/branding land instead of hoping an HTML layout
renders consistently.
"""

import io
import logging
import os
from typing import Optional

import requests
from django.core.files.base import ContentFile
from PIL import Image, ImageDraw, ImageFont

from .text_generation import MatchContext

logger = logging.getLogger(__name__)

SIZE = 1080
ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'assets')
LOGO_PATH = os.path.join(ASSETS_DIR, 'punishers_logo.png')

# Debian's fonts-dejavu-core package (see backend/Dockerfile) - not present
# in a plain local venv (e.g. Windows dev), so every font load below falls
# back to PIL's built-in bitmap font instead of crashing. Looks noticeably
# worse locally, but this code only ever needs to look right in the
# container that actually ships it.
_FONT_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
_FONT_REGULAR_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

BG_CENTER = (38, 50, 68)   # slightly lighter than gray-800, the vignette's bright spot
BG_EDGE = (3, 7, 18)       # gray-950
DEFAULT_ACCENT = (220, 38, 38)  # the site's own accent red - used when the team's game isn't recognized
WHITE = (255, 255, 255)
GRAY = (156, 163, 175)

# Per-game identity: a short badge abbreviation + an accent color used
# throughout the template (diagonal lines, kicker banner, score, badge)
# instead of always the same red - gives each post some visual identity/
# variety by game at a glance, without needing any external logo assets
# (matched by substring against Team.game, which is free text - e.g.
# "Counter-Strike 2" or just "CS2" both need to resolve the same way).
GAME_STYLES: list[tuple[tuple[str, ...], str, tuple[int, int, int]]] = [
    (("cs2", "counter-strike", "counter strike"), "CS2", (249, 115, 22)),
    (("valorant",), "VAL", (255, 70, 85)),
    (("league of legends", "lol"), "LOL", (200, 155, 60)),
    (("rocket league",), "RL", (0, 145, 255)),
    (("rainbow six", "r6", "siege"), "R6", (242, 169, 0)),
]


# Per-map accent colors for the maps-played row (see _draw_maps_row) -
# stylized tiles, not real map screenshots: we have no rights to reproduce
# Valve's (or any other game's) actual map art, and this stays consistent
# with the rest of the template already being a from-scratch Pillow
# composition rather than photo/screenshot based. Keyed by the map's
# systemname (FACEIT gives "de_mirage" etc.); an unrecognized map still
# renders fine via DEFAULT_MAP_COLOR, just without its own hue.
MAP_COLORS: dict[str, tuple[int, int, int]] = {
    "de_mirage": (196, 154, 90),
    "de_inferno": (200, 110, 60),
    "de_ancient": (95, 145, 95),
    "de_nuke": (120, 150, 190),
    "de_overpass": (90, 140, 110),
    "de_vertigo": (150, 130, 170),
    "de_anubis": (190, 160, 90),
    "de_dust2": (190, 150, 100),
    "de_train": (110, 120, 140),
    "de_cache": (140, 150, 100),
}
DEFAULT_MAP_COLOR = (110, 118, 132)

# Real map artwork for the tile backgrounds (grayscale, low-alpha - see
# _map_background) - screenshots the user already owns/uses for their own
# broadcast overlays (backend/social_posts/assets/maps/), not fetched from
# the web, so no image-rights question here unlike the "programmatic
# template only" decision made earlier for the rest of the post (that
# decision was about not needing/wanting external assets at all; these were
# supplied directly). Only covers the maps a local file exists for - a map
# without one here still renders fine via the plain accent-colored tile,
# see _draw_maps_row's `if bg is not None` branch below. Covers the full
# current active-duty pool (mirage/ancient/inferno/dust2/nuke/anubis/
# overpass) plus vertigo. dust2.webp has no title-banner overlay baked in
# unlike the rest (different source screenshot) - fine, since the tile
# already draws its own "Dust2" label on top regardless.
MAPS_ASSETS_DIR = os.path.join(ASSETS_DIR, "maps")
MAP_IMAGE_FILES: dict[str, str] = {
    "de_mirage": "mirage.png",
    "de_inferno": "inferno.png",
    "de_ancient": "ancient.png",
    "de_nuke": "nuke.png",
    "de_anubis": "anubis.png",
    "de_overpass": "overpass.png",
    "de_vertigo": "vertigo.png",
    "de_dust2": "dust2.webp",
}


def _map_background(raw_name: str, tile_w: int, tile_h: int) -> Optional[Image.Image]:
    """A cover-fit (crop-to-fill, never distorted) grayscale crop of the
    map's own artwork, sized exactly to one tile - returns None when no
    local asset exists for this map (see MAP_IMAGE_FILES), which the caller
    treats as "no background image, plain tile" rather than an error."""
    filename = MAP_IMAGE_FILES.get(raw_name.lower())
    if not filename:
        return None
    try:
        source = Image.open(os.path.join(MAPS_ASSETS_DIR, filename)).convert("L").convert("RGBA")
    except OSError:
        return None
    src_ratio = source.width / source.height
    tile_ratio = tile_w / tile_h
    if src_ratio > tile_ratio:
        new_h, new_w = tile_h, int(tile_h * src_ratio)
    else:
        new_w, new_h = tile_w, int(tile_w / src_ratio)
    source = source.resize((new_w, new_h), Image.LANCZOS)
    left, top = (new_w - tile_w) // 2, (new_h - tile_h) // 2
    return source.crop((left, top, left + tile_w, top + tile_h))


def _map_display_name(raw_name: str) -> str:
    """'de_mirage' -> 'Mirage'. Falls back to the raw value unchanged for
    anything that doesn't follow the de_-prefix convention (other games,
    or a manually-typed map name)."""
    name = raw_name[3:] if raw_name.lower().startswith("de_") else raw_name
    return name.replace("_", " ").strip().title() or raw_name


def _map_color(raw_name: str) -> tuple[int, int, int]:
    return MAP_COLORS.get(raw_name.lower(), DEFAULT_MAP_COLOR)


def _game_style(game: Optional[str]) -> tuple[str, tuple[int, int, int]]:
    if game:
        game_lower = game.lower()
        for keywords, abbr, color in GAME_STYLES:
            if any(kw in game_lower for kw in keywords):
                return abbr, color
    return "", DEFAULT_ACCENT


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = _FONT_BOLD_PATH if bold else _FONT_REGULAR_PATH
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default(size=size)


def _draw_centered_text(draw: ImageDraw.ImageDraw, y: int, text: str, size: int, bold: bool, fill, max_width: Optional[int] = None) -> int:
    """Draws horizontally-centered text at a given y, returns the y for the
    next line. If max_width is set and the text doesn't fit, shrinks the
    font size until it does (team/opponent names are real, unpredictable-
    length data, not curated copy - a long name must not just run off the
    edge of the image)."""
    font = _font(size, bold=bold)
    while max_width and size > 24 and draw.textbbox((0, 0), text, font=font)[2] > max_width:
        size -= 4
        font = _font(size, bold=bold)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    draw.text(((SIZE - text_width) / 2, y), text, font=font, fill=fill)
    return y + text_height


def _radial_vignette(center_color: tuple[int, int, int], edge_color: tuple[int, int, int]) -> Image.Image:
    """A bright-center/dark-edge radial gradient - more depth than a flat
    top-to-bottom fade. Rendered small (cheap, pure-Python pixel loop) and
    upscaled with bicubic interpolation, a standard trick for smooth
    gradients in Pillow without pulling in numpy for one array op."""
    small_size = 128
    grad = Image.new("RGB", (small_size, small_size))
    pixels = grad.load()
    center = small_size / 2
    max_dist = (2 * center ** 2) ** 0.5
    for y in range(small_size):
        for x in range(small_size):
            t = min(((x - center) ** 2 + (y - center) ** 2) ** 0.5 / max_dist, 1.0)
            pixels[x, y] = tuple(int(center_color[i] + (edge_color[i] - center_color[i]) * t) for i in range(3))
    return grad.resize((SIZE, SIZE), Image.BICUBIC)


def _add_diagonal_accents(img: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for offset in range(-SIZE, SIZE * 2, 260):
        draw.line([(offset, SIZE), (offset + SIZE, 0)], fill=(*color, 45), width=3)
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def _add_logo_watermark(img: Image.Image) -> Image.Image:
    """A very faint copy of the org's own logo, filling almost the entire
    canvas as background texture - reused instead of drawing anything
    illustrative (a crude Pillow-primitives silhouette would read as
    amateurish, not "cool"), and instead of a third-party game logo (which
    we don't have the rights to reproduce). Centered and near-canvas-sized
    rather than tucked in a corner, so it reads as a background texture
    across the whole image instead of a small badge-like graphic."""
    try:
        logo = Image.open(LOGO_PATH).convert("RGBA")
    except OSError:
        return img
    logo_size = int(SIZE * 1.35)
    logo = logo.resize((logo_size, logo_size), Image.LANCZOS)
    _, _, _, alpha = logo.split()
    logo.putalpha(alpha.point(lambda p: int(p * 0.05)))
    img = img.convert("RGBA")
    position = (int((SIZE - logo_size) / 2), int((SIZE - logo_size) / 2))
    img.paste(logo, position, logo)
    return img.convert("RGB")


def _draw_game_badge(img: Image.Image, abbr: str, color: tuple[int, int, int]) -> Image.Image:
    """A small pill badge naming the game, top-right corner - a per-game
    cue that stays out of the way instead of dominating the image."""
    if not abbr:
        return img
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _font(24, bold=True)
    bbox = draw.textbbox((0, 0), abbr, font=font)
    text_w, text_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = 20, 10
    badge_w, badge_h = text_w + pad_x * 2, text_h + pad_y * 2
    x0, y0 = SIZE - badge_w - 50, 50
    draw.rounded_rectangle([x0, y0, x0 + badge_w, y0 + badge_h], radius=badge_h / 2, fill=(*color, 230))
    draw.text((x0 + pad_x, y0 + pad_y - bbox[1]), abbr, font=font, fill=WHITE)
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def _draw_angular_banner(img: Image.Image, y: int, height: int, color: tuple[int, int, int], width: int = 440) -> Image.Image:
    """A slanted (parallelogram) banner behind the announcement/result
    kicker text - more visual structure than plain text floating on the
    background."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx = SIZE / 2
    skew = 22
    points = [
        (cx - width / 2 + skew, y),
        (cx + width / 2 + skew, y),
        (cx + width / 2 - skew, y + height),
        (cx - width / 2 - skew, y + height),
    ]
    draw.polygon(points, fill=(*color, 50))
    draw.line([points[0], points[1]], fill=(*color, 140), width=2)
    draw.line([points[3], points[2]], fill=(*color, 140), width=2)
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def _circular_logo(source: Image.Image, diameter: int, ring_color: tuple[int, int, int]) -> Image.Image:
    """Crops to a square, masks to a circle, and adds a thin accent ring -
    the standard "team badge" treatment so a landscape/portrait/oddly-
    cropped uploaded logo always ends up looking consistent here."""
    side = min(source.width, source.height)
    source = source.convert("RGBA").crop((
        (source.width - side) // 2, (source.height - side) // 2,
        (source.width + side) // 2, (source.height + side) // 2,
    )).resize((diameter, diameter), Image.LANCZOS)

    mask = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, diameter, diameter), fill=255)

    badge = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    badge.paste(source, (0, 0), mask)
    ring_draw = ImageDraw.Draw(badge)
    ring_draw.ellipse((1, 1, diameter - 2, diameter - 2), outline=(*ring_color, 255), width=3)
    return badge


def _load_team_logo(path: Optional[str], diameter: int, ring_color: tuple[int, int, int]) -> Optional[Image.Image]:
    """Our own team's logo - a local file (Team.image), no network
    involved. Falls back to the org logo itself when the team has no
    custom image uploaded, so the "vs" matchup still has two badges
    instead of one badge and an empty gap."""
    candidates = [path, LOGO_PATH] if path else [LOGO_PATH]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            with Image.open(candidate) as source:
                return _circular_logo(source, diameter, ring_color)
        except (OSError, ValueError):
            continue
    return None


def _load_opponent_logo(url: Optional[str], diameter: int, ring_color: tuple[int, int, int]) -> Optional[Image.Image]:
    """The opponent's FACEIT team avatar - fetched over the network, so
    this must degrade to "no badge" rather than fail the whole image on a
    slow/dead URL (only ever set for FACEIT-synced matches to begin with;
    manually-recorded scrims have no FACEIT team object to pull one from)."""
    if not url:
        return None
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        with Image.open(io.BytesIO(response.content)) as source:
            return _circular_logo(source, diameter, ring_color)
    except Exception:
        logger.warning("Gegner-Logo konnte nicht geladen werden: %s", url, exc_info=True)
        return None


MATCHUP_LOGO_DIAMETER = 100  # shared by the loaders below and the vertical spacing in generate_match_image, so the two can never drift apart like they did before (that's exactly how the previous overlap bug happened - a hardcoded "110" here and an unrelated hardcoded "20" gap picked independently, with nothing tying them together)


def _draw_matchup_logos(img: Image.Image, y_center: int, team_logo: Optional[Image.Image], opponent_logo: Optional[Image.Image], gap: int) -> Image.Image:
    """Places the two circular badges flanking whatever sits at y_center
    (the "VS" text or the score) - skips a side entirely rather than
    leaving a placeholder when a logo isn't available, since a badge-
    shaped blank would look more like an error than "no logo configured"."""
    img = img.convert("RGBA")
    if team_logo:
        x = int(SIZE / 2 - gap / 2 - team_logo.width)
        y = int(y_center - team_logo.height / 2)
        img.paste(team_logo, (x, y), team_logo)
    if opponent_logo:
        x = int(SIZE / 2 + gap / 2)
        y = int(y_center - opponent_logo.height / 2)
        img.paste(opponent_logo, (x, y), opponent_logo)
    return img.convert("RGB")


def _draw_maps_row(img: Image.Image, y: int, maps: list[dict]) -> tuple[Image.Image, int]:
    """Draws up to 5 (Bo5) compact per-map tiles side by side - one rounded
    tile per played map, its own accent color (see MAP_COLORS), the map
    name, and that map's score/result. Returns (new image, y position right
    after the row) - like every other semi-transparent decoration in this
    module (_add_diagonal_accents, _draw_angular_banner, _draw_game_badge),
    this draws on its own RGBA overlay and alpha-composites it onto img,
    since a plain ImageDraw on the base RGB image can't blend a translucent
    fill color at all. Caller (generate_match_image) only calls this when
    ctx.maps is non-empty, so a Bo1 (or any post with no structured per-map
    data, e.g. every FACEIT-auto-synced post today - see sync.py's
    _generate_social_post_draft) simply never gets this row and keeps the
    plain aggregate score layout unchanged."""
    maps = maps[:5]
    count = len(maps)
    tile_w = 190
    gap = 14
    total_w = count * tile_w + (count - 1) * gap
    x0 = (SIZE - total_w) / 2
    tile_h = 130

    # Map-artwork backgrounds are pasted directly onto img (still fully
    # opaque at this point) first, in their own pass - NOT onto the
    # translucent `overlay` built below. Pasting an already-semi-
    # transparent image onto a fully-transparent RGBA canvas double-applies
    # the opacity (the paste blend uses the mask as a weight AND the
    # source's own alpha ends up scaled by that same weight again), which
    # made this render nearly invisible the first time around - pasting
    # onto the opaque base is a single, correct blend, exactly like
    # _add_logo_watermark does for the same reason.
    img = img.convert("RGBA")
    for i, map_entry in enumerate(maps):
        name = map_entry.get("name") or "?"
        x = x0 + i * (tile_w + gap)
        bg = _map_background(name, tile_w, tile_h)
        if bg is not None:
            tile_mask = Image.new("L", (tile_w, tile_h), 0)
            ImageDraw.Draw(tile_mask).rounded_rectangle([0, 0, tile_w, tile_h], radius=14, fill=int(255 * 0.4))
            bg.putalpha(tile_mask)
            img.paste(bg, (int(x), int(y)), bg)
    img = img.convert("RGB")

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for i, map_entry in enumerate(maps):
        name = map_entry.get("name") or "?"
        color = _map_color(name)
        display_name = _map_display_name(name)
        team_score = map_entry.get("team_score")
        opponent_score = map_entry.get("opponent_score")
        result = map_entry.get("result")

        x = x0 + i * (tile_w + gap)
        draw.rounded_rectangle([x, y, x + tile_w, y + tile_h], radius=14, fill=(*color, 40), outline=(*color, 220), width=2)

        name_font = _font(20, bold=True)
        while name_font.size > 12 and draw.textbbox((0, 0), display_name, font=name_font)[2] > tile_w - 20:
            name_font = _font(name_font.size - 2, bold=True)
        name_bbox = draw.textbbox((0, 0), display_name, font=name_font)
        draw.text((x + (tile_w - (name_bbox[2] - name_bbox[0])) / 2, y + 16), display_name, font=name_font, fill=(*WHITE, 255))

        if team_score is not None and opponent_score is not None:
            score_text = f"{team_score}:{opponent_score}"
        elif result:
            score_text = {"win": "W", "loss": "L", "draw": "U"}.get(result, "?")
        else:
            score_text = "–"
        score_font = _font(34, bold=True)
        score_bbox = draw.textbbox((0, 0), score_text, font=score_font)
        score_fill = (22, 163, 74) if result == "win" else (239, 68, 68) if result == "loss" else color
        draw.text((x + (tile_w - (score_bbox[2] - score_bbox[0])) / 2, y + 68), score_text, font=score_font, fill=(*score_fill, 255))

    composited = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return composited, int(y + tile_h)


def generate_match_image(ctx: MatchContext) -> ContentFile:
    game_abbr, accent = _game_style(ctx.game)

    img = _radial_vignette(BG_CENTER, BG_EDGE)
    img = _add_logo_watermark(img)
    img = _add_diagonal_accents(img, accent)
    img = _draw_angular_banner(img, 195, 62, accent)
    img = _draw_game_badge(img, game_abbr, accent)
    draw = ImageDraw.Draw(img)

    # Logo + wordmark, top center.
    try:
        logo = Image.open(LOGO_PATH).convert("RGBA")
        logo.thumbnail((90, 90))
        img.paste(logo, (int((SIZE - logo.width) / 2), 60), logo)
    except OSError:
        pass
    y = 170
    y = _draw_centered_text(draw, y, "PUNISHERS GERMANY", 28, True, GRAY) + 42

    # Kicker (sits inside the angular banner drawn above): announcement vs result.
    kicker = "NÄCHSTES MATCH" if ctx.post_type == "announcement" else "MATCH-ERGEBNIS"
    y = _draw_centered_text(draw, y + 4, kicker, 32, True, WHITE) + 56

    # Team names, "VS" between them (or the score, for a result) - flanked
    # by each side's circular logo badge where available (our own team's
    # local image, the opponent's FACEIT avatar for synced matches only).
    # The circular logo badges (MATCHUP_LOGO_DIAMETER across) are taller than
    # either the "VS"/score row or the padding a plain text layout would use
    # on its own, so the gap before/after that row has to be at least the
    # logo's radius (plus a small margin) or the badges creep up into the
    # team name / down into the opponent name above and below - exactly the
    # overlap this row padding was widened to fix.
    row_padding = MATCHUP_LOGO_DIAMETER // 2 + 20
    y = _draw_centered_text(draw, y, ctx.team_name, 64, True, WHITE, max_width=SIZE - 120) + row_padding
    vs_row_top = y
    if ctx.post_type == "result" and ctx.team_maps_won is not None and ctx.opponent_maps_won is not None:
        y = _draw_centered_text(draw, y, f"{ctx.team_maps_won} : {ctx.opponent_maps_won}", 80, True, accent) + row_padding
    else:
        y = _draw_centered_text(draw, y, "VS", 40, True, GRAY) + row_padding
    vs_row_bottom = y - row_padding

    team_logo_img = _load_team_logo(ctx.team_logo_path, MATCHUP_LOGO_DIAMETER, accent)
    opponent_logo_img = _load_opponent_logo(ctx.opponent_logo_url, MATCHUP_LOGO_DIAMETER, accent)
    if team_logo_img or opponent_logo_img:
        img = _draw_matchup_logos(img, int((vs_row_top + vs_row_bottom) / 2), team_logo_img, opponent_logo_img, gap=290)
        draw = ImageDraw.Draw(img)  # img was reassigned above - the old draw handle is now stale

    y = _draw_centered_text(draw, y, ctx.opponent_name, 64, True, WHITE, max_width=SIZE - 120) + 40

    if ctx.post_type == "result" and ctx.result_word:
        # Win/loss color is a fixed, universal green/red - not the per-game
        # accent, which for some games (LoL gold, R6 amber) wouldn't read
        # as "bad" for a loss at all. The accent stays reserved for neutral
        # decoration (score number, banner, diagonal lines).
        badge_color = (239, 68, 68) if ctx.result_word == "Niederlage" else (22, 163, 74) if ctx.result_word == "Sieg" else GRAY
        y = _draw_centered_text(draw, y, ctx.result_word.upper(), 36, True, badge_color) + 40

    # Per-map breakdown (Bo2/Bo3/Bo5 series only - see MatchContext.maps) -
    # only ever set today for manually-recorded matches, which record each
    # map explicitly; FACEIT-auto-synced results don't populate this yet.
    if ctx.maps:
        img, y = _draw_maps_row(img, y, ctx.maps)
        draw = ImageDraw.Draw(img)  # img was reassigned above - the old draw handle is now stale
        y += 30

    # Footer: a thin divider, then competition + date, bottom-anchored
    # rather than flush under the content above - the amount of content
    # above varies a lot (announcement vs. result, with/without a maps
    # breakdown), so anchoring the footer to the bottom keeps its position
    # consistent across every generated image instead of leaving a
    # different-sized gap each time.
    footer_y = max(SIZE - 200, y + 20)  # bottom-anchored as usual, but pushed further down if the maps row (when present) would otherwise run into it
    draw.line([(SIZE / 2 - 60, footer_y), (SIZE / 2 + 60, footer_y)], fill=accent, width=2)
    footer_y += 30
    if ctx.competition_name:
        footer_y = _draw_centered_text(draw, footer_y, ctx.competition_name, 26, False, GRAY, max_width=SIZE - 120) + 10
    if ctx.match_datetime:
        footer_y = _draw_centered_text(draw, footer_y, ctx.match_datetime.strftime("%d.%m.%Y, %H:%M Uhr"), 24, False, GRAY)

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return ContentFile(buffer.getvalue(), name="social_post.png")
