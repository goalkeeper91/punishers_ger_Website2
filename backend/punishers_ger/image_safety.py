"""Single place that decides which image formats Pillow may DECODE for
content that doesn't come from our own repo assets (user uploads, OCR
screenshots, the opponent logo fetched from FACEIT).

Pillow's format plugins are a large attack surface (TIFF, EPS, PDF, BMP,
SPIDER, FPX, ...: most of Pillow's published memory-corruption and
decompression-bomb advisories live in decoders for formats we never need).
Image.open() normally auto-detects any of them from the file CONTENT, so a
TIFF renamed to "avatar.png" would sail through an extension allow-list and
reach the TIFF decoder. Restricting Image.open() to the formats we actually
serve keeps those decoders unreachable from user input regardless of which
Pillow version is installed."""
from PIL import Image

# Matches fastapi_app.main.ALLOWED_IMAGE_EXTENSIONS (.jpg/.jpeg/.png/.gif/.webp).
UNTRUSTED_IMAGE_FORMATS = ["JPEG", "PNG", "GIF", "WEBP"]


def open_untrusted_image(fp):
    """Image.open() restricted to UNTRUSTED_IMAGE_FORMATS - raises
    PIL.UnidentifiedImageError (an OSError) for anything else."""
    return Image.open(fp, formats=UNTRUSTED_IMAGE_FORMATS)
