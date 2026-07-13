from django.contrib import admin
from .models import NewsArticle, NewsArticleTranslation

@admin.register(NewsArticle)
class NewsArticleAdmin(admin.ModelAdmin):
    list_display = ('title', 'author', 'published_date', 'status', 'original_language')
    list_filter = ('status', 'published_date', 'author', 'original_language')
    search_fields = ('title', 'content')
    prepopulated_fields = {'slug': ('title',)}
    date_hierarchy = 'published_date'
    ordering = ('-published_date',)
    fields = ('title', 'slug', 'content', 'author', 'image', 'status', 'original_language')
    readonly_fields = ('original_language',)

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if request.user.is_superuser:
            return qs
        return qs.filter(author=request.user)

    def save_model(self, request, obj, form, change):
        if not obj.author_id:
            obj.author = request.user
        super().save_model(request, obj, form, change)


@admin.register(NewsArticleTranslation)
class NewsArticleTranslationAdmin(admin.ModelAdmin):
    list_display = ('article', 'language', 'is_machine_translated', 'translated_at')
    list_filter = ('language', 'is_machine_translated')
    search_fields = ('article__title', 'title', 'content')
    readonly_fields = ('translated_at',)
