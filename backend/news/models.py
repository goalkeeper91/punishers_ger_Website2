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

    class Meta:
        verbose_name = "News Artikel"
        verbose_name_plural = "News Artikel"
        ordering = ['-published_date']
        permissions = [
            ("manage_news", "Kann News-Artikel verwalten (erstellen/bearbeiten/löschen)"),
        ]

    def __str__(self):
        return self.title
