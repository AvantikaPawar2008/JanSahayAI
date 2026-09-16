"""WhatsApp Business API webhook — stub implementation for future integration."""

import logging
from fastapi import APIRouter, Request

logger = logging.getLogger("civicpulse.whatsapp")
router = APIRouter(prefix="/api/webhook", tags=["WhatsApp"])


@router.post("/whatsapp")
async def whatsapp_webhook(request: Request):
    """
    Receives incoming WhatsApp messages via webhook.
    
    TODO: Implement WhatsApp Business API integration:
    - Parse incoming message (text, audio, image)
    - Extract phone number
    - Route to intake pipeline or citizen response handler
    """
    body = await request.json()
    logger.info(f"WhatsApp webhook received: {body}")

    return {"status": "received", "message": "WhatsApp integration not yet implemented"}


@router.get("/whatsapp")
async def whatsapp_verify(request: Request):
    """WhatsApp webhook verification endpoint (responds to challenge)."""
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    if mode == "subscribe" and challenge:
        logger.info("WhatsApp webhook verified")
        return int(challenge)

    return {"status": "error", "message": "Verification failed"}
