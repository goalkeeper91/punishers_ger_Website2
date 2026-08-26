from django.db import migrations


def seed_pracc_league(apps, schema_editor):
    # No faceit_organizer_id - this league is deliberately never touched by
    # the FACEIT sync, it only exists so every team has a default "Liga"
    # option for manually-recorded practice/scrim results (see
    # fastapi_app/main.py create_manual_match) without an admin first
    # having to set up a real competitive league via Django admin.
    League = apps.get_model('leagues', 'League')
    League.objects.get_or_create(name='Pracc', defaults={'short_name': 'Pracc'})


def remove_pracc_league(apps, schema_editor):
    League = apps.get_model('leagues', 'League')
    League.objects.filter(name='Pracc').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('leagues', '0003_remove_league_faceit_championship_id_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_pracc_league, remove_pracc_league),
    ]
