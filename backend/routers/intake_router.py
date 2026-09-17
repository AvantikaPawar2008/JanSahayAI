"""Handles new citizen complaint submissions — voice, text, photo + GPS.

Pipeline (revised):
  1. Transcribe audio (if provided)
  2. Upload image (if provided); vision-describe if no text
  3. Embed text
  4. **Triage first** — classify department + sub_category (needed for dedup hard-filter)
  5. Dedup — hard-filter by department + sub_category, then semantic similarity
     → If duplicate: link to existing master ticket, skip re-triage
     → If new: use triage result to create master ticket
  6. Store ticket_report (always) with location_source
  7. Notify citizen
"""

import uuid
import logging
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

from backend.services.transcription_service import transcribe_audio
from backend.services.embedding_service import get_embedding
from backend.services.dedup_service import find_duplicate, increment_upvote
from backend.services.triage_service import triage_complaint
from backend.services.vision_service import analyze_complaint_photo
from backend.services.notification_service import send_citizen_notification
from backend.services.priority_service import compute_priority_components, update_ticket_priority
from backend.db.supabase_client import get_supabase_client
from backend.models.schemas import IntakeResponse
from datetime import datetime, timezone

logger = logging.getLogger("civicpulse.intake")
router = APIRouter(prefix="/api/intake", tags=["Intake"])


@router.post("", response_model=IntakeResponse)
async def submit_complaint(
    lat: float = Form(...),
    lng: float = Form(...),
    citizen_phone: str = Form(default=""),
    text: Optional[str] = Form(default=None),
    audio_file: Optional[UploadFile] = File(default=None),
    image_file: Optional[UploadFile] = File(default=None),
    location_source: Optional[str] = Form(default="gps"),  # 'gps' | 'manual'
):
    """
    Accepts a citizen complaint via text, audio, and/or photo with GPS.
    text, audio_file, and image_file are fully independent — any combination is accepted.

    Pipeline: transcribe → embed → triage (for hard-filter) → dedup → store → notify
    """
    supabase = get_supabase_client()
    complaint_text = text or ""
    transcript = None
    translated_text = None
    image_url = None

    # Normalise location_source
    if location_source not in ("gps", "manual"):
        location_source = "gps"

    # ----------------------------------------------------------------
    # Step 1: Transcribe audio if provided
    # ----------------------------------------------------------------
    if audio_file:
        audio_bytes = await audio_file.read()
        if audio_bytes:
            try:
                transcription_result = await transcribe_audio(
                    audio_bytes, audio_file.filename or "audio.webm"
                )
                transcript = transcription_result["transcript"]
                translated_text = transcription_result["translated_text"]
                # Append transcription to any existing text
                if not complaint_text:
                    complaint_text = translated_text or transcript
                else:
                    complaint_text = f"{complaint_text}. {translated_text or transcript}"
            except Exception as e:
                logger.error(f"Transcription failed: {e}")
                # Continue without transcription — text or photo might still work

    # ----------------------------------------------------------------
    # Step 2: Upload image to Supabase Storage if provided
    # ----------------------------------------------------------------
    if image_file:
        image_bytes = await image_file.read()
        if image_bytes:
            try:
                file_ext = (image_file.filename or "photo.jpg").split(".")[-1]
                storage_path = f"complaints/{uuid.uuid4()}.{file_ext}"
                supabase.storage.from_("complaint-media").upload(
                    storage_path, image_bytes,
                    file_options={"content-type": image_file.content_type or "image/jpeg"}
                )
                image_url = supabase.storage.from_("complaint-media").get_public_url(storage_path)
            except Exception as e:
                logger.error(f"Image upload failed: {e}")

    # Step 2b: If image provided but no text, use vision model to describe the photo
    if image_url and not complaint_text:
        try:
            vision_result = await analyze_complaint_photo(image_url)
            complaint_text = vision_result.get("description", "Civic issue reported via photo")
        except Exception as e:
            logger.error(f"Vision analysis failed: {e}")
            complaint_text = "Civic issue reported via photo"

    # Ensure we have some complaint text
    if not complaint_text:
        raise HTTPException(
            status_code=400,
            detail="No complaint content provided (text, audio, or photo required)"
        )

    # ----------------------------------------------------------------
    # Step 3: Generate text embedding
    # ----------------------------------------------------------------
    text_embedding = get_embedding(complaint_text)

    # ----------------------------------------------------------------
    # Step 4: Triage FIRST (needed for department/sub_category hard-filter in dedup)
    # ----------------------------------------------------------------
    triage_result = await triage_complaint(complaint_text, lat, lng)

    # ----------------------------------------------------------------
    # Step 5: Check for duplicates — department + sub_category hard-filter applied
    # ----------------------------------------------------------------
    duplicate = await find_duplicate(
        lat=lat,
        lng=lng,
        text_embedding=text_embedding,
        department=triage_result.department,
        sub_category=triage_result.sub_category,
    )

    if duplicate:
        # ---- DUPLICATE PATH: link to existing master ticket ----
        master_ticket_id = duplicate["id"]
        new_upvote_count = await increment_upvote(master_ticket_id)

        # If a citizen reports an issue on a ticket that was marked as resolved pending review,
        # reopen the ticket immediately so officers re-inspect the site.
        if duplicate.get("status") == "RESOLVED_PENDING_CITIZEN":
            try:
                supabase.table("master_tickets").update(
                    {"status": "REOPENED", "needs_admin_review": True}
                ).eq("id", master_ticket_id).execute()
                logger.warning(
                    f"Master ticket {master_ticket_id} reverted from RESOLVED_PENDING_CITIZEN to REOPENED "
                    f"due to citizen duplicate report."
                )
            except Exception as re_err:
                logger.error(f"Failed to reopen pending ticket {master_ticket_id}: {re_err}")

        # Recalculate priority with incremented duplicate count
        try:
            update_ticket_priority(master_ticket_id)
        except Exception as e:
            logger.error(f"Failed to update priority for ticket {master_ticket_id}: {e}")

        # Insert the citizen's report linked to the existing master ticket
        report_data = {
            "master_ticket_id": master_ticket_id,
            "raw_text": text,
            "transcript": transcript,
            "translated_text": translated_text,
            "image_url": image_url,
            "text_embedding": text_embedding,
            "lat": lat,
            "lng": lng,
        }
        # Graceful: include location_source only if column exists
        try:
            supabase.table("ticket_reports").insert(
                {**report_data, "location_source": location_source}
            ).execute()
        except Exception:
            supabase.table("ticket_reports").insert(report_data).execute()

        logger.info(f"Duplicate complaint merged into master ticket {master_ticket_id} "
                    f"(dept={triage_result.department}, sub_cat={triage_result.sub_category})")

        return IntakeResponse(
            master_ticket_id=master_ticket_id,
            is_duplicate=True,
            category=duplicate.get("category", "Unknown"),
            sub_category=duplicate.get("sub_category"),
            department=duplicate.get("department"),
            urgency=duplicate.get("urgency"),
            message=(
                f"Your report has been added to an existing ticket. "
                f"{new_upvote_count} citizens have reported this issue."
            ),
            upvote_count=new_upvote_count,
        )

    # ---- NEW TICKET PATH ----
    # Calculate initial priority components
    init_priority = compute_priority_components(
        created_at=datetime.now(timezone.utc),
        urgency=triage_result.urgency,
        duplicate_count=1,
    )

    # Step 6: Create master ticket
    master_ticket_data = {
        "category": triage_result.category,
        "department": triage_result.department,
        "urgency": triage_result.urgency,
        "status": "OPEN",
        "lat": lat,
        "lng": lng,
        "sop_steps": triage_result.sop_steps,
        "tools_required": triage_result.tools_required,
        "citizen_sms_draft": triage_result.citizen_sms_draft,
        "description": complaint_text,
        "upvote_count": 1,
        "priority_score": init_priority["priority_score"],
        "priority_sla_component": init_priority["priority_sla_component"],
        "priority_urgency_component": init_priority["priority_urgency_component"],
        "priority_duplicate_component": init_priority["priority_duplicate_component"],
        "needs_admin_review": triage_result.needs_admin_review,
    }

    # Gracefully add sub_category if the column exists in the database
    if triage_result.sub_category:
        master_ticket_data["sub_category"] = triage_result.sub_category

    try:
        ticket_result = supabase.table("master_tickets").insert(master_ticket_data).execute()
    except Exception as e:
        err_str = str(e)
        if "needs_admin_review" in err_str:
            master_ticket_data.pop("needs_admin_review", None)
            ticket_result = supabase.table("master_tickets").insert(master_ticket_data).execute()
        elif "sub_category" in err_str:
            master_ticket_data.pop("sub_category", None)
            ticket_result = supabase.table("master_tickets").insert(master_ticket_data).execute()
        else:
            raise e

    master_ticket = ticket_result.data[0]
    master_ticket_id = master_ticket["id"]

    # Step 7: Insert the citizen's report
    report_data = {
        "master_ticket_id": master_ticket_id,
        "raw_text": text,
        "transcript": transcript,
        "translated_text": translated_text,
        "image_url": image_url,
        "text_embedding": text_embedding,
        "lat": lat,
        "lng": lng,
    }
    # Graceful: include location_source only if column exists
    try:
        supabase.table("ticket_reports").insert(
            {**report_data, "location_source": location_source}
        ).execute()
    except Exception:
        supabase.table("ticket_reports").insert(report_data).execute()

    # Step 8: Send citizen notification
    if citizen_phone:
        await send_citizen_notification(
            citizen_phone,
            triage_result.citizen_sms_draft,
            master_ticket_id,
        )

    logger.info(
        f"New master ticket created: {master_ticket_id} | "
        f"Category: {triage_result.category} | Sub: {triage_result.sub_category} | "
        f"Urgency: {triage_result.urgency} | Dept: {triage_result.department}"
    )

    return IntakeResponse(
        master_ticket_id=master_ticket_id,
        is_duplicate=False,
        category=triage_result.category,
        sub_category=triage_result.sub_category,
        department=triage_result.department,
        urgency=triage_result.urgency,
        message=triage_result.citizen_sms_draft,
        upvote_count=1,
    )
