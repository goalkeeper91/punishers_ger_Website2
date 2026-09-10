# Generated for the admin "Match-Caster" module + site-wide live popup.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('faceit_integration', '0005_teamfaceitmatch_series_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='MatchBroadcast',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('caster_input', models.CharField(blank=True, help_text='Twitch-Name oder voller Stream-Link des Casters, wie eingegeben.', max_length=300)),
                ('caster_url', models.CharField(blank=True, help_text='Normalisierter Stream-Link (automatisch aus caster_input gebaut).', max_length=300)),
                ('caster_login', models.CharField(blank=True, help_text='Twitch-Login, falls erkennbar - Basis für Live-Check und eingebetteten Player.', max_length=100)),
                ('is_live', models.BooleanField(default=False)),
                ('stream_title', models.CharField(blank=True, max_length=300)),
                ('stream_game', models.CharField(blank=True, max_length=150)),
                ('viewer_count', models.PositiveIntegerField(blank=True, null=True)),
                ('thumbnail_url', models.URLField(blank=True, max_length=500)),
                ('live_checked_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('match', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='broadcast', to='faceit_integration.teamfaceitmatch')),
            ],
            options={
                'verbose_name': 'Match-Broadcast',
                'verbose_name_plural': 'Match-Broadcasts',
            },
        ),
    ]
