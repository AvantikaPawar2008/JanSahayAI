"""Officer queue, SOP fetch, and proof-of-work photo submission endpoints."""

import uuid
import logging
from datetime import datetime, timezone
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query, Header
from typing import Optional

from backend.db.supabase_client import get_supabase_client, get_supabase_user_client
from backend.services.priority_service import compute_priority_components
from backend.models.schemas import OfficerQueueItem, ProofSubmissionResponse

logger = logging.getLogger("civicpulse.officer")
router = APIRouter(prefix="/api/officer", tags=["Officer"])


@router.get("/queue", response_model=list[OfficerQueueItem])
async def get_officer_queue(
    department: Optional[str] = Query(default=None),
    limit: int = Query(default=50, le=200),
    authorization: Optional[str] = Header(default=None),
):
    """
    Returns prioritized ticket queue for officers.
    Relies on PostgreSQL RLS via the user's JWT to filter by department.
    """
    supabase = get_supabase_user_client(authorization)

    # Resolve officer's department from profile for defense-in-depth
    officer_dept = department
    if authorization:
        token_str = authorization.replace("Bearer ", "").strip()
        try:
            admin_db = get_supabase_client()
            user_res = admin_db.auth.get_user(token_str)
            if user_res and user_res.user:
                p = admin_db.table("profiles").select("department, role").eq("id", str(user_res.user.id)).single().execute()
                if p.data and p.data.get("role") == "officer" and p.data.get("department"):
                    officer_dept = p.data["department"]
        except Exception as e:
            logger.debug(f"Could not resolve officer department from token: {e}")

    query = (
        supabase.table("master_tickets")
        .select("*")
        .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
    )

    if officer_dept:
        query = query.eq("department", officer_dept)

    result = query.order("created_at", desc=True).limit(limit).execute()

    queue_items = []

    for t in (result.data or []):
        # Use stored priority components if present, else compute on the fly
        sla_comp = t.get("priority_sla_component")
        urg_comp = t.get("priority_urgency_component")
        dup_comp = t.get("priority_duplicate_component")
        score = t.get("priority_score")

        if score is None or sla_comp is None:
            comps = compute_priority_components(
                created_at=t["created_at"],
                urgency=t.get("urgency", "MEDIUM"),
                duplicate_count=t.get("upvote_count", 1),
            )
            sla_comp = comps["priority_sla_component"]
            urg_comp = comps["priority_urgency_component"]
            dup_comp = comps["priority_duplicate_component"]
            score = comps["priority_score"]

        queue_items.append(
            OfficerQueueItem(
                id=t["id"],
                category=t.get("category", ""),
                department=t.get("department"),
                urgency=t.get("urgency"),
                status=t.get("status", "OPEN"),
                lat=t["lat"],
                lng=t["lng"],
                upvote_count=t.get("upvote_count", 1),
                description=t.get("description"),
                created_at=t.get("created_at"),
                priority_score=float(score or 0.0),
                priority_sla_component=float(sla_comp) if sla_comp is not None else None,
                priority_urgency_component=float(urg_comp) if urg_comp is not None else None,
                priority_duplicate_component=float(dup_comp) if dup_comp is not None else None,
                sop_steps=t.get("sop_steps"),
                tools_required=t.get("tools_required"),
                needs_admin_review=bool(t.get("needs_admin_review", False)),
            )
        )

    # Sort by priority score descending (highest priority first)
    queue_items.sort(key=lambda x: x.priority_score, reverse=True)

    return queue_items


@router.get("/ticket/{ticket_id}")
async def get_officer_ticket_detail(
    ticket_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """Returns full ticket details with SOP steps and verification photos for an officer."""
    supabase = get_supabase_user_client(authorization)

    # Get ticket
    ticket_result = (
        supabase.table("master_tickets")
        .select("*")
        .eq("id", ticket_id)
        .single()
        .execute()
    )

    if not ticket_result.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Get verification photos
    photos_result = (
        supabase.table("verification_photos")
        .select("*")
        .eq("master_ticket_id", ticket_id)
        .order("captured_at", desc=True)
        .execute()
    )

    # Get citizen reports
    reports_result = (
        supabase.table("ticket_reports")
        .select("*")
        .eq("master_ticket_id", ticket_id)
        .order("created_at", desc=True)
        .execute()
    )

    return {
        "ticket": ticket_result.data,
        "verification_photos": photos_result.data or [],
        "citizen_reports": reports_result.data or [],
    }


@router.post("/submit-proof", response_model=ProofSubmissionResponse)
async def submit_proof_of_work(
    master_ticket_id: str = Form(...),
    photo_type: str = Form(...),  # "before" or "after"
    lat: float = Form(...),
    lng: float = Form(...),
    officer_id: Optional[str] = Form(default=None),
    image_file: UploadFile = File(...),
):
    """
    Officer submits a GPS-verified before or after photo for a ticket.
    The photo is uploaded to Supabase Storage and a verification_photos record is created.
    """
    supabase = get_supabase_client()

    if photo_type not in ("before", "after"):
        raise HTTPException(status_code=400, detail="photo_type must be 'before' or 'after'")

    # Upload image to Supabase Storage
    image_bytes = await image_file.read()
    file_ext = (image_file.filename or "photo.jpg").split(".")[-1]
    storage_path = f"verification/{master_ticket_id}/{photo_type}_{uuid.uuid4()}.{file_ext}"

    try:
        supabase.storage.from_("complaint-media").upload(
            storage_path, image_bytes,
            file_options={"content-type": image_file.content_type or "image/jpeg"}
        )
        image_url = supabase.storage.from_("complaint-media").get_public_url(storage_path)
    except Exception as e:
        logger.error(f"Photo upload failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload photo")

    # Insert verification photo record
    photo_data = {
        "master_ticket_id": master_ticket_id,
        "officer_id": officer_id,
        "photo_type": photo_type,
        "image_url": image_url,
        "lat": lat,
        "lng": lng,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }

    result = supabase.table("verification_photos").insert(photo_data).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save photo record")

    # Update ticket status if this is the first 'before' photo
    if photo_type == "before":
        supabase.table("master_tickets").update(
            {"status": "IN_PROGRESS"}
        ).eq("id", master_ticket_id).execute()

    logger.info(f"Officer submitted {photo_type} photo for ticket {master_ticket_id}")

    return ProofSubmissionResponse(
        verification_photo_id=result.data[0]["id"],
        photo_type=photo_type,
        message=f"{photo_type.title()} photo uploaded successfully",
    )
