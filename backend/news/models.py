from django.db import models
from django.conf import settings

class NewsArticle(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('published', 'Published'),
    ]

    title = models.CharField(max_length=200, verbose_name="Titel")
    slug = models.SlugField(max_length=200, unique=True, verbose_name="Slug")
    content = models.TextField(verbose_name="Inhalt")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='news_articles',
        verbose_name="Autor"
    )
    image = models.ImageField(
        upload_to='news_images/',
        blank=True,
        null=True,
        verbose_name="Titelbild"
    )
    published_date = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Veröffentlichungsdatum"
    )
    updated_date = models.DateTimeField(
        auto_now=True,
        verbose_name="Zuletzt aktualisiert"
    )
    status = models.CharField(
        max_length=10,
        choices=STATUS_CHOICES,
        default='draft',
        verbose_name="Status"
    )
    # Auto-detected from title+content at save time (news/translation.py) -
    # title/content above always stay in this language; other supported
    # languages are auto-translated into NewsArticleTranslation rows below.
    original_language = models.CharField(max_length=5, default="de", verbose_name="Originalsprache")

    class Meta:
        verbose_name = "News Artikel"
        verbose_name_plural = "News Artikel"
        ordering = ['-published_date']
        permissions = [
            ("manage_news", "Kann News-Artikel verwalten (erstellen/bearbeiten/löschen)"),
        ]

    def __str__(self):
        return self.title


class NewsArticleTranslation(models.Model):
    """An auto-translated copy of a NewsArticle's title/content in one other
    language - see news/translation.py. The article's own title/content
    fields are always the author's original text in `original_language`;
    this table holds the machine-translated versions for every other
    supported language, refreshed whenever the article is created/updated
    (or manually re-triggered from the admin UI)."""

    article = models.ForeignKey(NewsArticle, on_delete=models.CASCADE, related_name="translations")
    language = models.CharField(max_length=5)
    title = models.CharField(max_length=200)
    content = models.TextField()
    is_machine_translated = models.BooleanField(default=True)
    translated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "News-Artikel-Übersetzung"
        verbose_name_plural = "News-Artikel-Übersetzungen"
        unique_together = [("article", "language")]

    def __str__(self):
        return f"{self.article.title} ({self.language})"
