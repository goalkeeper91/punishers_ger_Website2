from django.db import migrations

SYSTEM_ROLES = ["Teammanager", "Author"]


def create_system_roles(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    for name in SYSTEM_ROLES:
        Group.objects.get_or_create(name=name)


def noop_reverse(apps, schema_editor):
    # Deliberately not deleting the groups on reverse: doing so could
    # silently strip permissions from users who were already assigned to
    # them, well after this migration ran.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0001_initial'),
        ('auth', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(create_system_roles, noop_reverse),
    ]
