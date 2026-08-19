from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string


def send_free_text_email(*, from_address: str, from_display_name: str, to: list[str], subject: str, body: str, sender_username: str) -> None:
    """Sends an admin-composed free-text email (see fastapi_app/main.py's
    send_free_text_email endpoint). Unlike applications/emails.py and
    users/emails.py, this deliberately does NOT swallow exceptions - the
    caller needs to know synchronously whether the send actually worked,
    since sending is the entire point of the request, not a side-effect of
    something else."""
    context = {"body": body, "sender_username": sender_username}
    text_body = render_to_string("emails/free_text.txt", context)
    html_body = render_to_string("emails/free_text.html", context)
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=f"{from_display_name} <{from_address}>",
        to=to,
    )
    message.attach_alternative(html_body, "text/html")
    message.send()
