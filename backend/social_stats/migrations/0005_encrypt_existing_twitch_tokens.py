from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import migrations


def encrypt_existing_tokens(apps, schema_editor):
    # Runs while access_token/refresh_token are still plain TextField (the
    # AlterField to EncryptedTextField happens in the next migration), so
    # this operates on raw values with no transparent encrypt/decrypt in
    # the way - encrypts anything not already encrypted, in place.
    TwitchAuthorization = apps.get_model("social_stats", "TwitchAuthorization")
    fernet = Fernet(settings.ENCRYPTION_KEY)
    for auth in TwitchAuthorization.objects.all():
        update_fields = []
        for field_name in ("access_token", "refresh_token"):
            value = getattr(auth, field_name)
            if not value:
                continue
            try:
                fernet.decrypt(value.encode())
                continue  # already encrypted
            except InvalidToken:
                setattr(auth, field_name, fernet.encrypt(value.encode()).decode())
                update_fields.append(field_name)
        if update_fields:
            auth.save(update_fields=update_fields)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("social_stats", "0004_playersocialstats_comment_count_and_more"),
    ]

    operations = [
        migrations.RunPython(encrypt_existing_tokens, noop),
    ]
