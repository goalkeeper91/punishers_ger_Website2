import io

from django.test import SimpleTestCase
from PIL import Image, UnidentifiedImageError

from punishers_ger.image_safety import open_untrusted_image


def _encode(fmt: str) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), (200, 30, 30)).save(buffer, format=fmt)
    return buffer.getvalue()


class UntrustedImageFormatTests(SimpleTestCase):
    """Only the formats we actually serve may reach Pillow's decoders -
    a TIFF/BMP renamed to .png must not get through on content alone."""

    def test_allowed_formats_open(self):
        for fmt in ("JPEG", "PNG", "GIF", "WEBP"):
            with self.subTest(fmt=fmt):
                with open_untrusted_image(io.BytesIO(_encode(fmt))) as image:
                    self.assertEqual(image.format, fmt)
                    self.assertEqual(image.size, (16, 16))

    def test_other_formats_rejected(self):
        for fmt in ("TIFF", "BMP", "PPM", "ICO"):
            with self.subTest(fmt=fmt):
                with self.assertRaises(UnidentifiedImageError):
                    open_untrusted_image(io.BytesIO(_encode(fmt)))

    def test_garbage_rejected(self):
        with self.assertRaises(UnidentifiedImageError):
            open_untrusted_image(io.BytesIO(b"not an image" * 10))
