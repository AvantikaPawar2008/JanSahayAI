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
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Header, BackgroundTasks
from typing import Optional
import asyncio

from backend.services.transcription_service import transcribe_audio
from backend.services.embedding_service import get_embedding
from backend.services.dedup_service import find_duplicate, assign_or_update_before_photo
from backend.services.triage_service import (
    triage_complaint,
    fast_triage_classification,
    async_enrich_master_ticket_sop,
)
from backend.services.vision_service import analyze_complaint_photo, compute_sharpness_score
from backend.services.notification_service import send_citizen_notification
from backend.services.priority_service import compute_priority_components, update_ticket_priority
from backend.services.geo_service import reverse_geocode, resolve_incident_location
from backend.services.event_service import record_ticket_event
from backend.services.warranty_service import check_warranty_breach
from backend.db.supabase_client import get_supabase_client
from backend.models.schemas import IntakeResponse
from datetime import datetime, timezone

logger = logging.getLogger("civicpulse.intake")
router = APIRouter(prefix="/api/intake", tags=["Intake"])


@router.post("", response_model=IntakeResponse)
async def submit_complaint(
    background_tasks: BackgroundTasks,
    lat: float = Form(...),
    lng: float = Form(...),
    citizen_phone: str = Form(default=""),
    text: Optional[str] = Form(default=None),
    audio_file: Optional[UploadFile] = File(default=None),
    image_file: Optional[UploadFile] = File(default=None),
    location_source: Optional[str] = Form(default="gps"),  # 'gps' | 'manual' | 'remote'
    problem_lat: Optional[float] = Form(default=None),
    problem_lng: Optional[float] = Form(default=None),
    problem_landmark: Optional[str] = Form(default=None),
    device_lat: Optional[float] = Form(default=None),
    device_lng: Optional[float] = Form(default=None),
    idempotency_key: Optional[str] = Form(default=None),
    client_accuracy: Optional[float] = Form(default=None),
    is_mock_location: Optional[bool] = Form(default=False),
    authorization: Optional[str] = Header(default=None),
):
    """
    Accepts a citizen complaint via text, audio, and/or photo with GPS.
    Distinguishes the citizen's device logging location from the real exact problem location.

    Pipeline: idempotency check → transcribe → resolve location → embed → triage → dedup → store → notify
    """
    supabase = get_supabase_client()

    # ----------------------------------------------------------------
    # Step 0: Idempotency Early-Return Check
    # ----------------------------------------------------------------
    if idempotency_key:
        try:
            prior_report = (
                supabase.table("ticket_reports")
                .select("master_ticket_id")
                .eq("idempotency_key", idempotency_key)
                .limit(1)
                .execute()
            )
            if prior_report.data and len(prior_report.data) > 0:
                prior_m_id = prior_report.data[0]["master_ticket_id"]
                prior_master = supabase.table("master_tickets").select("*").eq("id", prior_m_id).single().execute()
                if prior_master.data:
                    pm = prior_master.data
                    logger.info(f"Idempotent submission detected for key {idempotency_key}. Returning master ticket {prior_m_id}.")
                    return IntakeResponse(
                        master_ticket_id=prior_m_id,
                        is_duplicate=True,
                        category=pm.get("category", "General"),
                        sub_category=pm.get("sub_category"),
                        department=pm.get("department"),
                        urgency=pm.get("urgency"),
                        message="Report already received and recorded (idempotent request).",
                        upvote_count=pm.get("upvote_count", 1),
                    )
        except Exception as idemp_err:
            logger.warning(f"Idempotency check query failed: {idemp_err}")

    complaint_text = text or ""
    transcript = None
    translated_text = None
    image_url = None
    image_sharpness_score = None
    image_bytes_for_sharpness = None  # Hold reference for sharpness computation

    # ----------------------------------------------------------------
    # Step 1: Transcribe audio if provided
    # ----------------------------------------------------------------
    if audio_file and hasattr(audio_file, "read"):
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
    # Step 2: Upload image to Supabase Storage concurrently if provided
    # ----------------------------------------------------------------
    image_upload_task = None
    if image_file and hasattr(image_file, "read"):
        image_bytes = await image_file.read()
        if image_bytes:
            # Compute sharpness BEFORE upload so we have the bytes in-memory
            image_sharpness_score = compute_sharpness_score(image_bytes)
            logger.debug(f"Image sharpness score: {image_sharpness_score:.2f}")
            image_bytes_for_sharpness = image_bytes  # kept for reference; not re-read
            file_ext = (image_file.filename or "photo.jpg").split(".")[-1]
            storage_path = f"complaints/{uuid.uuid4()}.{file_ext}"
            from backend.services.storage_service import upload_image_bytes
            image_upload_task = asyncio.to_thread(
                upload_image_bytes,
                supabase=supabase,
                image_bytes=image_bytes,
                storage_path=storage_path,
                content_type=image_file.content_type or "image/jpeg",
            )

    # Step 2b: If image provided but no text, we must await upload now to describe photo
    if image_upload_task and not complaint_text:
        try:
            image_url = await image_upload_task
            image_upload_task = None
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
    # Step 2c, 3, 4: Parallelize Location Resolution, Embedding, and Fast Triage
    # ----------------------------------------------------------------
    loc_task = resolve_incident_location(
        complaint_text=complaint_text,
        client_lat=lat,
        client_lng=lng,
        location_source=location_source or "gps",
        explicit_problem_lat=problem_lat,
        explicit_problem_lng=problem_lng,
        explicit_landmark=problem_landmark,
    )
    embed_task = asyncio.to_thread(get_embedding, complaint_text)
    fast_triage_task = asyncio.to_thread(fast_triage_classification, complaint_text)

    loc_resolution, text_embedding, triage_result = await asyncio.gather(
        loc_task,
        embed_task,
        fast_triage_task,
    )

    real_lat = loc_resolution["real_lat"]
    real_lng = loc_resolution["real_lng"]
    final_location_source = loc_resolution["location_source"]
    logging_lat = device_lat if device_lat is not None else lat
    logging_lng = device_lng if device_lng is not None else lng

    # [TODO-IN-03] Vernacular normalization — run in background, non-blocking
    # Normalizes Marathi/Hindi landmark names before embedding for better dedup accuracy
    try:
        from backend.services.dialect_service import normalize_complaint_text
        dialect_result = await normalize_complaint_text(complaint_text, use_llm_fallback=False)
        if dialect_result.get("normalized_text") and dialect_result["normalized_text"] != complaint_text:
            logger.info(
                f"🔤 Dialect normalization: {dialect_result['gazetteer_hits']} hits, "
                f"normalized '{complaint_text[:40]}' → '{dialect_result['normalized_text'][:40]}'"
            )
            complaint_text = dialect_result["normalized_text"]
    except Exception as dialect_err:
        logger.debug(f"Dialect normalization skipped: {dialect_err}")

    # [TODO-DD-01] Warranty breach check — runs after triage classification
    # Checks if new defect falls within 25m of a RESOLVED ticket still under 60-day warranty
    warranty_breach_info = None
    try:
        warranty_breach_info = await check_warranty_breach(
            lat=real_lat,
            lng=real_lng,
            department=triage_result.department,
            sub_category=triage_result.sub_category,
            citizen_id=None,  # Will be resolved below in citizen lookup
        )
        if warranty_breach_info and warranty_breach_info.get("is_warranty_breach"):
            logger.warning(
                f"⚠️ WARRANTY BREACH: contractor {warranty_breach_info.get('contractor_id')} "
                f"— original ticket {warranty_breach_info.get('original_ticket_id')}"
            )
    except Exception as warranty_err:
        logger.debug(f"Warranty check skipped: {warranty_err}")

    # Look up or create citizen record for tracking and citizen history (RLS compatibility)
    citizen_id = None
    auth_user_id = None

    if authorization:
        try:
            token_str = authorization.replace("Bearer ", "").strip()
            user_res = supabase.auth.get_user(token_str)
            if user_res and user_res.user:
                auth_user_id = str(user_res.user.id)
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
    # Step 5: Check for duplicates — using real problem location + cross-location dedup
    # ----------------------------------------------------------------
    duplicate = await find_duplicate(
        lat=real_lat,
        lng=real_lng,
        text_embedding=text_embedding,
        department=triage_result.department,
        sub_category=triage_result.sub_category,
        new_report_text=translated_text or text or transcript,
        device_lat=logging_lat,
        device_lng=logging_lng,
        location_source=final_location_source,
        client_accuracy=client_accuracy,
    )

    if duplicate:
        # ---- DUPLICATE PATH: link to existing master ticket ----
        master_ticket_id = duplicate["id"]

        # Await async image upload if pending
        if image_upload_task:
            try:
                image_url = await image_upload_task
                image_upload_task = None
            except Exception as e:
                logger.error(f"Image upload failed: {e}")
                image_url = None

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

        # Update provenance & last_seen_at on master ticket
        try:
            supabase.table("master_tickets").update({
                "dedup_similarity_score": duplicate.get("similarity_score"),
                "dedup_threshold_zone": duplicate.get("threshold_zone"),
                "dedup_laya_decision": duplicate.get("laya_decision"),
                "last_seen_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", master_ticket_id).execute()
        except Exception as prov_err:
            logger.debug(f"Could not update provenance on master ticket {master_ticket_id}: {prov_err}")

        # Insert the citizen's report linked to the existing master ticket.
        # With Migration 007, sync_ticket_upvote_count trigger automatically syncs master_tickets.upvote_count.
        report_data = {
            "master_ticket_id": master_ticket_id,
            "raw_text": text,
            "transcript": transcript,
            "translated_text": translated_text,
            "image_url": image_url,
            "text_embedding": text_embedding,
            "lat": logging_lat,
            "lng": logging_lng,
            **({"idempotency_key": idempotency_key} if idempotency_key else {}),
            **({"client_accuracy": client_accuracy} if client_accuracy is not None else {}),
            **({"is_mock_location": is_mock_location} if is_mock_location is not None else {}),
            **({"citizen_id": citizen_id} if citizen_id else {}),
            **({"image_sharpness_score": image_sharpness_score} if image_sharpness_score is not None else {}),
        }
        # Graceful: include location_source only if column exists
        inserted_report = None
        try:
            res = supabase.table("ticket_reports").insert(
                {**report_data, "location_source": final_location_source}
            ).execute()
            inserted_report = res.data[0] if res.data else None
        except Exception:
            res = supabase.table("ticket_reports").insert(report_data).execute()
            inserted_report = res.data[0] if res.data else None

        # Before-photo auto-assignment: decide if this report's image should become
        # (or upgrade) the master ticket's before-photo based on sharpness.
        if inserted_report and image_url:
            try:
                assign_or_update_before_photo(
                    master_ticket_id=master_ticket_id,
                    new_report=inserted_report,
                )
            except Exception as bpe:
                logger.warning(f"Before-photo assignment failed for ticket {master_ticket_id}: {bpe}")

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

        # Record immutable audit event for merge
        record_ticket_event(
            ticket_id=master_ticket_id,
            event_type="MERGED_AS_UPVOTE",
            actor_id=citizen_id,
            actor_role="citizen" if citizen_id else "anonymous",
            metadata={
                "similarity_score": duplicate.get("similarity_score"),
                "threshold_zone": duplicate.get("threshold_zone"),
                "laya_decision": duplicate.get("laya_decision"),
                "upvote_count": new_upvote_count,
                "already_reported": already_reported,
                "client_accuracy": client_accuracy,
                "is_mock_location": is_mock_location,
            },
        )

        logger.info(f"Duplicate complaint merged into master ticket {master_ticket_id} "
                    f"(dept={triage_result.department}, sub_cat={triage_result.sub_category})")

        dup_urg = (duplicate.get("urgency") or "MEDIUM").upper()
        dup_sla = 12.0 if dup_urg == "CRITICAL" else (24.0 if dup_urg == "HIGH" else (72.0 if dup_urg == "LOW" else 48.0))

        return IntakeResponse(
            master_ticket_id=master_ticket_id,
            is_duplicate=True,
            category=duplicate.get("category", "Unknown"),
            sub_category=duplicate.get("sub_category"),
            department=duplicate.get("department"),
            urgency=duplicate.get("urgency"),
            status=duplicate.get("status", "OPEN"),
            sla_target_hours=dup_sla,
            expected_resolution_hours=dup_sla,
            lat=duplicate.get("lat") or resolved_lat,
            lng=duplicate.get("lng") or resolved_lng,
            address_text=duplicate.get("address_text") or address_str,
            message=(
                f"Your report has been added to an existing ticket. "
                f"{new_upvote_count} citizens have reported this issue."
                if not already_reported else
                f"You have already reported this issue. Your update has been noted on ticket."
            ),
            upvote_count=new_upvote_count,
        )

    # Await async image upload if pending
    if image_upload_task:
        try:
            image_url = await image_upload_task
            image_upload_task = None
        except Exception as e:
            logger.error(f"Image upload failed: {e}")
            image_url = None

    # ---- NEW TICKET PATH ----
    # Calculate initial priority components
    init_priority = compute_priority_components(
        created_at=datetime.now(timezone.utc),
        urgency=triage_result.urgency,
        duplicate_count=1,
    )

    default_sop_steps = [
        "Deploy field response team to reported coordinates",
        "Conduct on-site safety hazard assessment and cordon off",
        "Execute structural repair and capture post-resolution verification proof",
    ]
    default_tools = ["Safety Barricades", "Inspection Camera", "Repair Materials"]
    default_sms = (
        f"Municipal update: Your {triage_result.category} complaint at this location has been "
        f"assigned to {triage_result.department}. Response team dispatched."
    )

    # Step 6: Create master ticket at the REAL EXACT problem location
    master_ticket_data = {
        "category": triage_result.category,
        "department": triage_result.department,
        "urgency": triage_result.urgency,
        "status": "OPEN",
        "lat": real_lat,
        "lng": real_lng,
        "sop_steps": default_sop_steps,
        "tools_required": default_tools,
        "citizen_sms_draft": default_sms,
        "description": complaint_text,
        "upvote_count": 1,
        "priority_score": init_priority["priority_score"],
        "priority_sla_component": init_priority["priority_sla_component"],
        "priority_urgency_component": init_priority["priority_urgency_component"],
        "priority_duplicate_component": init_priority["priority_duplicate_component"],
        "needs_admin_review": triage_result.needs_admin_review,
        "text_embedding": text_embedding,
    }

    # Automatically allot ticket to the least-burdened field officer in the department
    try:
        from backend.services.officer_service import allot_officer_for_ticket
        allotted_officer = allot_officer_for_ticket(triage_result.department)
        if allotted_officer and allotted_officer.get("id"):
            master_ticket_data["assigned_officer_id"] = allotted_officer["id"]
            master_ticket_data["status"] = "ASSIGNED"
            logger.info("Automatically allotted new complaint to officer %s (%s)", allotted_officer.get("name"), triage_result.department)
    except Exception as off_err:
        logger.debug("Officer auto-allotment skipped: %s", off_err)

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

    # Dispatch non-blocking background SOP generation
    background_tasks.add_task(
        async_enrich_master_ticket_sop,
        master_ticket_id=master_ticket_id,
        complaint_text=complaint_text,
        department=triage_result.department,
        urgency=triage_result.urgency,
        category=triage_result.category,
        lat=real_lat,
        lng=real_lng,
    )

    # Step 6b: Reverse geocode once for human-readable address on novel tickets
    address_str = loc_resolution.get("resolved_address") or f"{real_lat:.5f}, {real_lng:.5f}"
    if not loc_resolution.get("resolved_address"):
        try:
            address_str = await reverse_geocode(real_lat, real_lng)
        except Exception as e:
            logger.warning(f"Reverse geocode failed, fallback to coordinates: {e}")

    try:
        supabase.table("master_tickets").update({"address_text": address_str}).eq("id", master_ticket_id).execute()
    except Exception as e:
        logger.warning(f"Could not update address_text on master ticket {master_ticket_id}: {e}")

    # Step 7: Insert the citizen's report with logging device position
    report_data = {
        "master_ticket_id": master_ticket_id,
        "raw_text": text,
        "transcript": transcript,
        "translated_text": translated_text,
        "image_url": image_url,
        "text_embedding": text_embedding,
        "lat": logging_lat,
        "lng": logging_lng,
        **({"idempotency_key": idempotency_key} if idempotency_key else {}),
        **({"client_accuracy": client_accuracy} if client_accuracy is not None else {}),
        **({"is_mock_location": is_mock_location} if is_mock_location is not None else {}),
        **({"citizen_id": citizen_id} if citizen_id else {}),
        **({"image_sharpness_score": image_sharpness_score} if image_sharpness_score is not None else {}),
    }
    # Graceful: include location_source only if column exists
    inserted_report = None
    try:
        res = supabase.table("ticket_reports").insert(
            {**report_data, "location_source": final_location_source}
        ).execute()
        inserted_report = res.data[0] if res.data else None
    except Exception:
        res = supabase.table("ticket_reports").insert(report_data).execute()
        inserted_report = res.data[0] if res.data else None

    # Record immutable audit event for creation
    record_ticket_event(
        ticket_id=master_ticket_id,
        event_type="CREATED",
        actor_id=citizen_id,
        actor_role="citizen" if citizen_id else "anonymous",
        metadata={
            "category": triage_result.category,
            "sub_category": triage_result.sub_category,
            "department": triage_result.department,
            "urgency": triage_result.urgency,
            "priority_score": init_priority["priority_score"],
            "needs_admin_review": triage_result.needs_admin_review,
            "client_accuracy": client_accuracy,
            "is_mock_location": is_mock_location,
        },
    )

    # Step 7b: Before-photo auto-assignment — first citizen image on a new ticket
    # automatically becomes the 'before' photo so officers always have context.
    if inserted_report and image_url:
        try:
            assign_or_update_before_photo(
                master_ticket_id=master_ticket_id,
                new_report=inserted_report,
            )
        except Exception as bpe:
            logger.warning(f"Before-photo assignment failed for new ticket {master_ticket_id}: {bpe}")

    # Step 8: Send citizen notification asynchronously in background
    if citizen_phone:
        background_tasks.add_task(
            send_citizen_notification,
            citizen_phone,
            default_sms,
            master_ticket_id,
        )

    logger.info(
        f"New master ticket created: {master_ticket_id} | "
        f"Category: {triage_result.category} | Sub: {triage_result.sub_category} | "
        f"Urgency: {triage_result.urgency} | Dept: {triage_result.department} | "
        f"Address: {address_str}"
    )

    new_urg = (triage_result.urgency or "MEDIUM").upper()
    new_sla = 12.0 if new_urg == "CRITICAL" else (24.0 if new_urg == "HIGH" else (72.0 if new_urg == "LOW" else 48.0))

    return IntakeResponse(
        master_ticket_id=master_ticket_id,
        is_duplicate=False,
        category=triage_result.category,
        sub_category=triage_result.sub_category,
        department=triage_result.department,
        urgency=triage_result.urgency,
        status="OPEN",
        sla_target_hours=new_sla,
        expected_resolution_hours=new_sla,
        lat=resolved_lat,
        lng=resolved_lng,
        message=default_sms,
        upvote_count=1,
        address_text=address_str,
    )
