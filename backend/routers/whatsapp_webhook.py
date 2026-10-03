"""Production-grade WhatsApp Business API webhook router.

Features:
  1. Meta URL-verification handshake (hub.challenge with configured verify token)
  2. Cryptographic signature check (X-Hub-Signature-256 HMAC-SHA256)
  3. Inbound delivery deduplication (prevents Meta retry storms from spawning duplicate tickets)
  4. Interactive citizen sign-off routing (handles 48h [Confirm] / [Dispute] quick replies)
  5. Multi-modal complaint routing (text, location GPS, media) with idempotency key
"""

import hmac
import hashlib
import time
import logging
from collections import OrderedDict
from typing import Optional
from fastapi import APIRouter, Request, Header, HTTPException, Response, BackgroundTasks

from backend.config import get_settings
from backend.db.supabase_client import get_supabase_client
from backend.services.event_service import record_ticket_event

logger = logging.getLogger("civicpulse.whatsapp")
router = APIRouter(prefix="/api/webhook", tags=["WhatsApp"])

# In-memory LRU cache to deduplicate Meta message deliveries (retaining up to 5,000 message IDs)
_PROCESSED_MESSAGE_IDS = OrderedDict()
_MAX_PROCESSED_CACHE = 5000


def is_duplicate_delivery(message_id: str) -> bool:
    """Checks if message_id was already received and processed within recent window."""
    now = time.time()
    if message_id in _PROCESSED_MESSAGE_IDS:
        logger.warning(f"Duplicate WhatsApp delivery ignored for message_id={message_id}")
        return True
    
    _PROCESSED_MESSAGE_IDS[message_id] = now
    if len(_PROCESSED_MESSAGE_IDS) > _MAX_PROCESSED_CACHE:
        _PROCESSED_MESSAGE_IDS.popitem(last=False)
    return False


def verify_whatsapp_signature(payload_bytes: bytes, signature_header: Optional[str], app_secret: str) -> bool:
    """Validates X-Hub-Signature-256 HMAC signature against Meta App Secret."""
    if not app_secret:
        return True  # Dev fallback if WHATSAPP_APP_SECRET is not configured
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
    provided = signature_header.split("sha256=")[-1]
    return hmac.compare_digest(expected, provided)


async def handle_whatsapp_message_async(value_data: dict):
    """Background task to parse and process inbound WhatsApp payloads without delaying ACK."""
    settings = get_settings()
    supabase = get_supabase_client()

    messages = value_data.get("messages", [])
    contacts = value_data.get("contacts", [])
    user_name = contacts[0].get("profile", {}).get("name", "WhatsApp Citizen") if contacts else "WhatsApp Citizen"

    for msg in messages:
        msg_id = msg.get("id")
        sender_phone = msg.get("from", "")
        msg_type = msg.get("type", "text")

        # ------------------------------------------------------------------
        # 1. Handle Interactive Quick-Reply (Citizen Closed-Loop 48h Sign-Off)
        # ------------------------------------------------------------------
        if msg_type == "interactive":
            interactive = msg.get("interactive", {})
            reply = interactive.get("button_reply", {})
            button_id = reply.get("id", "")

            if button_id.startswith("confirm_"):
                ticket_id = button_id.replace("confirm_", "").strip()
                logger.info(f"Citizen confirmed ticket {ticket_id} via WhatsApp button reply")
                try:
                    supabase.table("master_tickets").update({
                        "status": "RESOLVED",
                        "citizen_confirmation_status": "CONFIRMED",
                    }).eq("id", ticket_id).execute()
                    record_ticket_event(
                        ticket_id=ticket_id,
                        event_type="CITIZEN_CONFIRMED",
                        actor_role="citizen",
                        metadata={"channel": "whatsapp", "phone": sender_phone},
                    )
                except Exception as e:
                    logger.error(f"Failed to confirm ticket {ticket_id}: {e}")
                continue

            elif button_id.startswith("dispute_"):
                ticket_id = button_id.replace("dispute_", "").strip()
                logger.info(f"Citizen disputed ticket {ticket_id} via WhatsApp button reply")
                try:
                    supabase.table("master_tickets").update({
                        "status": "REOPENED",
                        "citizen_confirmation_status": "DISPUTED",
                        "needs_admin_review": True,
                    }).eq("id", ticket_id).execute()
                    record_ticket_event(
                        ticket_id=ticket_id,
                        event_type="CITIZEN_DISPUTED",
                        actor_role="citizen",
                        metadata={"channel": "whatsapp", "phone": sender_phone},
                    )
                except Exception as e:
                    logger.error(f"Failed to dispute ticket {ticket_id}: {e}")
                continue

        # ------------------------------------------------------------------
        # 2. Handle Civic Complaint (Text or Location Pin)
        # ------------------------------------------------------------------
        report_text = ""
        report_lat = 18.5204  # Default Pune central fallback if only text
        report_lng = 73.8567
        location_source = "remote"

        if msg_type == "text":
            report_text = msg.get("text", {}).get("body", "").strip()
        elif msg_type == "location":
            loc = msg.get("location", {})
            report_lat = loc.get("latitude", report_lat)
            report_lng = loc.get("longitude", report_lng)
            report_text = loc.get("name") or loc.get("address") or "Civic issue reported at pinned location"
            location_source = "gps"

        if not report_text:
            continue

        idempotency_key = hashlib.md5(f"wa_{msg_id}".encode()).hexdigest()
        logger.info(f"Processing WhatsApp complaint from {sender_phone} ({user_name}): '{report_text[:60]}...'")

        # Ingest directly via intake pipeline logic
        try:
            from backend.services.triage_service import fast_triage_classification
            from backend.services.embedding_service import get_embedding
            from backend.services.dedup_service import find_duplicate

            # Fast classify
            triage = await fast_triage_classification(report_text)
            embedding = get_embedding(report_text)

            duplicate = await find_duplicate(
                lat=report_lat,
                lng=report_lng,
                text_embedding=embedding,
                department=triage.department,
                sub_category=triage.sub_category,
                new_report_text=report_text,
                location_source=location_source,
            )

            if duplicate:
                m_id = duplicate["id"]
                supabase.table("ticket_reports").insert({
                    "master_ticket_id": m_id,
                    "raw_text": report_text,
                    "lat": report_lat,
                    "lng": report_lng,
                    "location_source": location_source,
                    "idempotency_key": idempotency_key,
                }).execute()
                record_ticket_event(
                    ticket_id=m_id,
                    event_type="MERGED_AS_UPVOTE",
                    actor_role="citizen",
                    metadata={"channel": "whatsapp", "phone": sender_phone},
                )
                logger.info(f"WhatsApp complaint merged into master ticket {m_id}")
            else:
                new_ticket_res = supabase.table("master_tickets").insert({
                    "category": triage.category,
                    "department": triage.department,
                    "urgency": triage.urgency,
                    "sub_category": triage.sub_category,
                    "lat": report_lat,
                    "lng": report_lng,
                    "description": report_text,
                    "status": "OPEN",
                    "upvote_count": 1,
                    "text_embedding": embedding,
                }).execute()
                if new_ticket_res.data:
                    new_m_id = new_ticket_res.data[0]["id"]
                    supabase.table("ticket_reports").insert({
                        "master_ticket_id": new_m_id,
                        "raw_text": report_text,
                        "lat": report_lat,
                        "lng": report_lng,
                        "location_source": location_source,
                        "idempotency_key": idempotency_key,
                    }).execute()
                    record_ticket_event(
                        ticket_id=new_m_id,
                        event_type="CREATED",
                        actor_role="citizen",
                        metadata={"channel": "whatsapp", "phone": sender_phone},
                    )
                    logger.info(f"New master ticket created from WhatsApp: {new_m_id}")
        except Exception as proc_err:
            logger.error(f"Error processing WhatsApp intake for {msg_id}: {proc_err}")


@router.post("/whatsapp")
async def whatsapp_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: Optional[str] = Header(default=None),
):
    """
    Receives incoming WhatsApp messages via Meta webhook.
    Verifies HMAC signature, deduplicates message IDs, queues async processing,
    and returns HTTP 200 within sub-second compliance window.
    """
    settings = get_settings()
    payload_bytes = await request.body()

    # 1. Cryptographic HMAC-SHA256 signature verification
    if not verify_whatsapp_signature(payload_bytes, x_hub_signature_256, settings.whatsapp_app_secret):
        logger.warning("WhatsApp webhook signature verification failed.")
        raise HTTPException(status_code=403, detail="Invalid signature")

    try:
        body = await request.json()
    except Exception:
        return Response(content="Invalid JSON", status_code=400)

    # 2. Parse Meta Webhook Wrapper
    for entry in body.get("entry", []):
        for change in entry.get("changes", []):
            val = change.get("value", {})
            for m in val.get("messages", []):
                m_id = m.get("id")
                if m_id and is_duplicate_delivery(m_id):
                    # Meta retried delivery — acknowledge immediately without reprocessing
                    return Response(content="EVENT_RECEIVED", status_code=200)

            # 3. Offload processing to background task to guarantee fast ACK
            background_tasks.add_task(handle_whatsapp_message_async, val)

    return Response(content="EVENT_RECEIVED", status_code=200)


@router.get("/whatsapp")
async def whatsapp_verify(request: Request):
    """
    Meta URL-verification handshake endpoint (responds to hub.challenge
    only when hub.verify_token matches configured secret).
    """
    settings = get_settings()
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    if mode == "subscribe" and token == settings.whatsapp_verify_token:
        logger.info("WhatsApp webhook verified successfully with Meta challenge")
        return Response(content=challenge or "", media_type="text/plain", status_code=200)

    logger.warning("WhatsApp webhook verification token mismatch")
    return Response(content="Verification failed", status_code=403)
