"""Transparent at-rest encryption for OAuth credentials (see
TwitchAuthorization.access_token/refresh_token). Unlike a password, these
must be decryptable again to actually call Twitch's API later on the
user's behalf, so this uses reversible symmetric encryption (Fernet -
AES-128-CBC + HMAC), not one-way hashing."""

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models


def _fernet() -> Fernet:
    return Fernet(settings.ENCRYPTION_KEY)


class EncryptedTextField(models.TextField):
    """A TextField that's encrypted at rest and transparently decrypted when
    read back through the ORM - every other call site (`_store_twitch_
    authorization()`, `social_stats/sync.py`) just reads/writes plain
    strings as normal, with no idea encryption is involved."""

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if not value:
            return value
        return _fernet().encrypt(value.encode()).decode()

    def from_db_value(self, value, expression, connection):
        if not value:
            return value
        try:
            return _fernet().decrypt(value.encode()).decode()
        except InvalidToken:
            # Not (yet) encrypted - e.g. a row written before this field
            # existed, before the encrypt-existing-rows migration ran.
            # Return as-is rather than crash; the next save re-encrypts it.
            return value
