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
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Header
from typing import Optional

from backend.services.transcription_service import transcribe_audio
from backend.services.embedding_service import get_embedding
from backend.services.dedup_service import find_duplicate
from backend.services.triage_service import triage_complaint
from backend.services.vision_service import analyze_complaint_photo
from backend.services.notification_service import send_citizen_notification
from backend.services.priority_service import compute_priority_components, update_ticket_priority
from backend.services.geo_service import reverse_geocode
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
    authorization: Optional[str] = Header(default=None),
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

    # Look up or create citizen record for tracking and citizen history (RLS compatibility)
    citizen_id = None
    auth_user_id = None

    if authorization:
        try:
            token_str = authorization.replace("Bearer ", "").strip()
            user_res = supabase.auth.get_user(token_str)
            if user_res and user_res.user:
                auth_user_id = str(user_res.user.id)
                # Ensure record exists in citizens table with id = auth.uid()
                # so FK constraint on ticket_reports.citizen_id holds and RLS policies match
                cit_phone = citizen_phone or f"+91-{auth_user_id[:8]}"
                supabase.table("citizens").upsert({
                    "id": auth_user_id,
                    "auth_user_id": auth_user_id,
                    "phone_number": cit_phone,
                    "name": user_res.user.user_metadata.get("full_name", f"Citizen {auth_user_id[:4]}")
                }).execute()
                citizen_id = auth_user_id
        except Exception as auth_err:
            logger.debug(f"Auth user mapping skipped or failed: {auth_err}")

    if not citizen_id and citizen_phone:
        try:
            cit_query = supabase.table("citizens").select("id").eq("phone_number", citizen_phone).limit(1).execute()
            if cit_query.data:
                citizen_id = cit_query.data[0]["id"]
            else:
                cit_name = f"Citizen {citizen_phone[-4:]}" if len(citizen_phone) >= 4 else "Citizen"
                new_cit = supabase.table("citizens").insert({
                    "phone_number": citizen_phone,
                    "name": cit_name
                }).execute()
                if new_cit.data:
                    citizen_id = new_cit.data[0]["id"]
        except Exception as e:
            logger.debug(f"Citizen record handling skipped: {e}")

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

        # Sybil defense: Check if this citizen has already reported/upvoted this specific ticket
        already_reported = False
        if citizen_id:
            try:
                prev_report = (
                    supabase.table("ticket_reports")
                    .select("id")
                    .eq("master_ticket_id", master_ticket_id)
                    .eq("citizen_id", citizen_id)
                    .limit(1)
                    .execute()
                )
                if prev_report.data and len(prev_report.data) > 0:
                    already_reported = True
            except Exception:
                pass

        # Anti-DOS reopening: Only revert status to REOPENED if photo evidence is provided
        if duplicate.get("status") == "RESOLVED_PENDING_CITIZEN":
            try:
                if image_url:
                    supabase.table("master_tickets").update(
                        {"status": "REOPENED", "needs_admin_review": True}
                    ).eq("id", master_ticket_id).execute()
                    logger.warning(
                        f"Master ticket {master_ticket_id} reverted from RESOLVED_PENDING_CITIZEN to REOPENED with photo proof."
                    )
                else:
                    supabase.table("master_tickets").update(
                        {"needs_admin_review": True}
                    ).eq("id", master_ticket_id).execute()
                    logger.info(
                        f"Master ticket {master_ticket_id} flagged needs_admin_review (text report without photo proof)."
                    )
            except Exception as re_err:
                logger.error(f"Failed to handle pending ticket {master_ticket_id}: {re_err}")

        # Insert the citizen's report linked to the existing master ticket.
        # With Migration 007, sync_ticket_upvote_count trigger automatically syncs master_tickets.upvote_count.
        report_data = {
            "master_ticket_id": master_ticket_id,
            "raw_text": text,
            "transcript": transcript,
            "translated_text": translated_text,
            "image_url": image_url,
            "text_embedding": text_embedding,
            "lat": lat,
            "lng": lng,
            **({"citizen_id": citizen_id} if citizen_id else {}),
        }
        # Graceful: include location_source only if column exists
        try:
            supabase.table("ticket_reports").insert(
                {**report_data, "location_source": location_source}
            ).execute()
        except Exception:
            supabase.table("ticket_reports").insert(report_data).execute()

        # Read trigger-derived upvote count from master_tickets
        try:
            curr_res = supabase.table("master_tickets").select("upvote_count").eq("id", master_ticket_id).single().execute()
            new_upvote_count = (curr_res.data or {}).get("upvote_count", duplicate.get("upvote_count", 1))
        except Exception:
            new_upvote_count = duplicate.get("upvote_count", 1)

        if not already_reported:
            try:
                update_ticket_priority(master_ticket_id)
            except Exception as e:
                logger.error(f"Failed to update priority for ticket {master_ticket_id}: {e}")

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
                if not already_reported else
                f"You have already reported this issue. Your update has been noted on ticket."
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
        "text_embedding": text_embedding,
    }

    # Gracefully add sub_category if the column exists in the database
    if triage_result.sub_category:
        master_ticket_data["sub_category"] = triage_result.sub_category

    try:
        ticket_result = supabase.table("master_tickets").insert(master_ticket_data).execute()
    except Exception as e:
        err_str = str(e)
        if "text_embedding" in err_str:
            master_ticket_data.pop("text_embedding", None)
            ticket_result = supabase.table("master_tickets").insert(master_ticket_data).execute()
        elif "needs_admin_review" in err_str:
            master_ticket_data.pop("needs_admin_review", None)
            ticket_result = supabase.table("master_tickets").insert(master_ticket_data).execute()
        elif "sub_category" in err_str:
            master_ticket_data.pop("sub_category", None)
            ticket_result = supabase.table("master_tickets").insert(master_ticket_data).execute()
        else:
            raise e

    master_ticket = ticket_result.data[0]
    master_ticket_id = master_ticket["id"]

    # Step 6b: Reverse geocode once for human-readable address on novel tickets
    address_str = f"{lat:.5f}, {lng:.5f}"
    try:
        address_str = await reverse_geocode(lat, lng)
    except Exception as e:
        logger.warning(f"Reverse geocode failed, fallback to coordinates: {e}")

    try:
        supabase.table("master_tickets").update({"address_text": address_str}).eq("id", master_ticket_id).execute()
    except Exception as e:
        logger.warning(f"Could not update address_text on master ticket {master_ticket_id}: {e}")

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
        **({"citizen_id": citizen_id} if citizen_id else {}),
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
        f"Urgency: {triage_result.urgency} | Dept: {triage_result.department} | "
        f"Address: {address_str}"
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
        address_text=address_str,
    )
