FROM python:3.12-slim

# Tesseract for the OCR screenshot-upload feature (social_stats/ocr_client.py)
# - matches the "local/free over paid API" convention already used there.
# fonts-dejavu-core: python:3.12-slim ships no fonts at all, needed for
# Pillow's ImageFont.truetype() in social_posts/image_generation.py to
# render real (non-bitmap) text on the generated social-post images.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
    fonts-dejavu-core \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
