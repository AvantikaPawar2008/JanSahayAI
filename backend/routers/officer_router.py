"""Officer queue, SOP fetch, and proof-of-work photo submission endpoints."""

import uuid
import logging
from datetime import datetime, timezone
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query, Header, BackgroundTasks
from typing import Optional

from backend.db.supabase_client import get_supabase_client, get_supabase_user_client
from backend.utils.auth_cache import resolve_user_from_token
from backend.services.priority_service import compute_priority_components, recalculate_department_priorities
from backend.models.schemas import OfficerQueueItem, ProofSubmissionResponse

logger = logging.getLogger("civicpulse.officer")
router = APIRouter(prefix="/api/officer", tags=["Officer"])


@router.get("/queue", response_model=list[OfficerQueueItem])
@router.get("/tickets", response_model=list[OfficerQueueItem])
def get_officer_queue(
    background_tasks: BackgroundTasks,
    department: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    urgency: Optional[str] = Query(default=None),
    sort: str = Query(default="priority_score_desc"),
    limit: int = Query(default=50, le=200),
    authorization: Optional[str] = Header(default=None),
):
    """
    Returns prioritized ticket queue for officers.
    Applies filters (WHERE department = ... AND status = ... AND urgency = ...) in PostgreSQL
    first, and then applies deterministic ordering (ORDER BY priority_score DESC, created_at ASC).
    Recalculates active ticket priority in background to prevent stale SLA elapsed times without slowing responses.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required for officer queue")

    # Connect with user's JWT to enforce PostgreSQL RLS officers_view_own_department_only policy
    supabase = get_supabase_user_client(authorization)

    # Resolve officer department from token using warm in-memory cache (0.0ms)
    officer_dept = department
    user_dept = None
    if authorization:
        _, role, user_dept = resolve_user_from_token(authorization)
        if role == "officer" and user_dept:
            officer_dept = department if department else user_dept
        elif role == "admin":
            officer_dept = department

    # Recalculate priority scores in background so queue load is instant
    background_tasks.add_task(recalculate_department_priorities, department=officer_dept, limit=limit)

    # Build query: Filters (WHERE ...) are applied in PostgreSQL first
    query = supabase.table("master_tickets").select("*")

    # Filter by department (PostgreSQL RLS also enforces this)
    if officer_dept:
        query = query.eq("department", officer_dept)

    # Filter by status (AND logic)
    if status and status.upper() != "ALL":
        query = query.eq("status", status.upper())
    else:
        # Default active tickets if not explicitly specified or ALL
        query = query.in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])

    # Filter by urgency (AND logic)
    if urgency and urgency.upper() != "ALL":
        query = query.eq("urgency", urgency.upper())

    # 2a & 2b: Sort in PostgreSQL AFTER filters, with deterministic tiebreaker (created_at ASC)
    if sort == "priority_score_asc":
        query = query.order("priority_score", desc=False).order("created_at", desc=False)
    elif sort == "created_at_desc":
        query = query.order("created_at", desc=True)
    elif sort == "created_at_asc":
        query = query.order("created_at", desc=False)
    elif sort in ("department_asc", "department_priority"):
        query = query.order("department", desc=False).order("priority_score", desc=True).order("created_at", desc=False)
    elif sort == "department_desc":
        query = query.order("department", desc=True).order("priority_score", desc=True).order("created_at", desc=False)
    else:  # default: priority_score_desc with oldest-first tiebreaker
        query = query.order("priority_score", desc=True).order("created_at", desc=False)

    result = query.limit(limit).execute()

    queue_items = []

    for t in (result.data or []):
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
                sub_category=t.get("sub_category"),
                department=t.get("department"),
                urgency=t.get("urgency"),
                status=t.get("status", "OPEN"),
                lat=t["lat"],
                lng=t["lng"],
                address_text=t.get("address_text"),
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

    # Department-accurate deterministic final ordering (incorporating any live recalculated scores)
    if sort == "priority_score_asc":
        queue_items.sort(key=lambda x: (x.priority_score, x.created_at or ""))
    elif sort == "created_at_desc":
        queue_items.sort(key=lambda x: x.created_at or "", reverse=True)
    elif sort == "created_at_asc":
        queue_items.sort(key=lambda x: x.created_at or "")
    elif sort in ("department_asc", "department_priority"):
        # Stable sort: first by priority score desc, then grouped by department A->Z
        queue_items.sort(key=lambda x: (-x.priority_score, x.created_at or ""))
        queue_items.sort(key=lambda x: x.department or "")
    elif sort == "department_desc":
        # Stable sort: first by priority score desc, then grouped by department Z->A
        queue_items.sort(key=lambda x: (-x.priority_score, x.created_at or ""))
        queue_items.sort(key=lambda x: x.department or "", reverse=True)
    elif sort == "my_department_first" and user_dept:
        # Officer's department tickets first, then other departments (each sorted by priority score)
        queue_items.sort(key=lambda x: (-x.priority_score, x.created_at or ""))
        queue_items.sort(key=lambda x: (0 if x.department == user_dept else 1))
    else:
        # Default: priority_score_desc with oldest-first tiebreaker
        queue_items.sort(key=lambda x: (-x.priority_score, x.created_at or ""))

    return queue_items


@router.get("/ticket/{ticket_id}")
def get_officer_ticket_detail(
    ticket_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """Returns full ticket details with SOP steps and verification photos for an officer."""
    admin_db = get_supabase_client()

    # Direct admin_db query eliminates double-attempt latency
    admin_ticket_res = (
        admin_db.table("master_tickets")
        .select("*")
        .eq("id", ticket_id)
        .execute()
    )
    ticket_data = admin_ticket_res.data[0] if admin_ticket_res.data else None

    if not ticket_data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Get verification photos
    photos_result = (
        admin_db.table("verification_photos")
        .select("*")
        .eq("master_ticket_id", ticket_id)
        .order("captured_at", desc=True)
        .execute()
    )

    # Get citizen reports
    reports_result = (
        admin_db.table("ticket_reports")
        .select("*")
        .eq("master_ticket_id", ticket_id)
        .order("created_at", desc=True)
        .execute()
    )

    return {
        "ticket": ticket_data,
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
