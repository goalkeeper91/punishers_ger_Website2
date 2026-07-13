import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


def _send(subject: str, template_stem: str, context: dict, to_email: str) -> None:
    # A misconfigured/unreachable mail server shouldn't break the request
    # that triggered it (activation, password-reset request, ...) - log and
    # move on, same graceful-degradation approach used for the other
    # optional external integrations in this project (Twitch, YouTube, OCR).
    try:
        text_body = render_to_string(f"emails/{template_stem}.txt", context)
        html_body = render_to_string(f"emails/{template_stem}.html", context)
        message = EmailMultiAlternatives(subject=subject, body=text_body, to=[to_email])
        message.attach_alternative(html_body, "text/html")
        message.send()
    except Exception:
        logger.exception("Failed to send email (%s) to %s", template_stem, to_email)


def send_account_activated_email(user) -> None:
    _send(
        subject="Dein Punishers Germany Konto wurde aktiviert",
        template_stem="account_activated",
        context={"username": user.username, "login_url": f"{settings.FRONTEND_BASE_URL}/login"},
        to_email=user.email,
    )


def send_password_reset_email(user, reset_url: str) -> None:
    _send(
        subject="Punishers Germany - Passwort zurücksetzen",
        template_stem="password_reset",
        context={
            "username": user.username,
            "reset_url": reset_url,
            "expire_minutes": settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES,
        },
        to_email=user.email,
    )
