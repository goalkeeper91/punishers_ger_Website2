import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('discord_bot', '0002_ruleacceptanceconfig_voicechanneltrigger'),
    ]

    operations = [
        migrations.CreateModel(
            name='ReactionRole',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('channel_id', models.CharField(max_length=32)),
                ('message_id', models.CharField(max_length=32)),
                ('emoji', models.CharField(default='✅', max_length=16)),
                ('role_id', models.CharField(max_length=32)),
                ('label', models.CharField(blank=True, help_text='Admin-Notiz, z.B. "CS2" oder "Regeln akzeptiert" - wird nicht an Discord gesendet.', max_length=100)),
                ('removable', models.BooleanField(default=True, help_text='Rolle wird auch entfernt, wenn die Reaction entfernt wird. Bei Regel-Akzeptanz deaktivieren.')),
                ('enabled', models.BooleanField(default=True)),
                ('guild', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reaction_roles', to='discord_bot.discordguild')),
            ],
            options={
                'verbose_name': 'Reaction-Role',
                'verbose_name_plural': 'Reaction-Roles',
                'ordering': ['guild__name', 'label'],
                'unique_together': {('guild', 'message_id', 'emoji')},
            },
        ),
    ]
