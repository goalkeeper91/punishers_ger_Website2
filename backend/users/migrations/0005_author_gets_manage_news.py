from django.db import migrations


def grant_manage_news_to_author(apps, schema_editor):
    """Backward compatibility: the Author system role used to be hardcoded
    to full news access (require_roles(ROLE_AUTHOR) in fastapi_app/main.py).
    Now that news access is gated by the real 'news.manage_news' permission
    instead, existing Author-role users must keep working without an admin
    having to manually re-grant it after this upgrade."""
    Group = apps.get_model('auth', 'Group')
    Permission = apps.get_model('auth', 'Permission')
    try:
        author_group = Group.objects.get(name="Author")
    except Group.DoesNotExist:
        return
    try:
        perm = Permission.objects.get(content_type__app_label="news", codename="manage_news")
    except Permission.DoesNotExist:
        return
    author_group.permissions.add(perm)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0004_alter_customuser_options'),
        ('news', '0002_alter_newsarticle_options'),
    ]

    operations = [
        migrations.RunPython(grant_manage_news_to_author, noop_reverse),
    ]
