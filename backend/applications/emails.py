import logging
from urllib.parse import urlencode

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


def send_application_accepted_email(application) -> None:
    # The applicant isn't necessarily a registered user yet (that's the
    # whole point of this email) - prefill the email field on /register so
    # whoever reviews the resulting pending account can match it back to
    # this application, rather than the applicant maybe typing a different
    # address than the one they applied with.
    register_url = f"{settings.FRONTEND_BASE_URL}/register?{urlencode({'email': application.email})}"
    context = {
        "ingame_name": application.ingame_name,
        "game": application.game,
        "register_url": register_url,
    }
    try:
        text_body = render_to_string("emails/application_accepted.txt", context)
        html_body = render_to_string("emails/application_accepted.html", context)
        message = EmailMultiAlternatives(
            subject="Deine Bewerbung bei Punishers Germany wurde angenommen!",
            body=text_body,
            to=[application.email],
        )
        message.attach_alternative(html_body, "text/html")
        message.send()
    except Exception:
        # A misconfigured/unreachable mail server shouldn't break the
        # accept-application request itself - log and move on, same
        # graceful-degradation approach as users/emails.py.
        logger.exception("Failed to send application-accepted email to %s", application.email)
