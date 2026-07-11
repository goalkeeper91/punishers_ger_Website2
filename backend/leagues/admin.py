from django.contrib import admin
from .models import League


@admin.register(League)
class LeagueAdmin(admin.ModelAdmin):
    list_display = ('name', 'short_name', 'faceit_organizer_id')
    search_fields = ('name', 'short_name', 'faceit_organizer_id')
