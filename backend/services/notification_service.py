"""Mock notification service — logs WhatsApp/SMS messages to console (replace with real API later)."""

import logging

logger = logging.getLogger("civicpulse.notifications")


async def send_citizen_notification(
    phone_number: str, message: str, ticket_id: str
) -> dict:
    """
    Sends a notification to a citizen about their ticket status.
    Currently mocked — logs to console. Replace with WhatsApp Business API or SMS gateway.
    
    Args:
        phone_number: Citizen's phone number
        message: Notification message text
        ticket_id: Related ticket ID for tracking
    
    Returns:
        dict with status and message_id
    """
    logger.info(
        f"📱 NOTIFICATION → {phone_number} | Ticket: {ticket_id}\n"
        f"   Message: {message}"
    )
    return {
        "status": "sent_mock",
        "phone_number": phone_number,
        "ticket_id": ticket_id,
        "message": message,
        "provider": "mock",
    }


async def send_officer_notification(
    phone_number: str, message: str, ticket_id: str
) -> dict:
    """
    Sends a notification to a field officer about a new assignment.
    Currently mocked.
    """
    logger.info(
        f"👷 OFFICER NOTIFICATION → {phone_number} | Ticket: {ticket_id}\n"
        f"   Message: {message}"
    )
    return {
        "status": "sent_mock",
        "phone_number": phone_number,
        "ticket_id": ticket_id,
        "message": message,
        "provider": "mock",
    }


async def send_admin_alert(message: str, alert_id: str) -> dict:
    """
    Sends a hotspot alert notification to admins.
    Currently mocked.
    """
    logger.info(
        f"🚨 ADMIN ALERT | Alert: {alert_id}\n"
        f"   Message: {message}"
    )
    return {
        "status": "sent_mock",
        "alert_id": alert_id,
        "message": message,
        "provider": "mock",
    }
