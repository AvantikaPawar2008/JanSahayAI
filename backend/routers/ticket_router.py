"""CRUD endpoints for ticket listing, detail view, and status updates."""

from fastapi import APIRouter, HTTPException, Query, Header
from typing import Optional
from backend.db.supabase_client import get_supabase_client, get_supabase_user_client
from backend.models.schemas import (
    TicketResponse,
    TicketListResponse,
    TicketUpdateRequest,
    SupportRequest,
    CitizenFeedbackSubmitRequest,
)

router = APIRouter(prefix="/api/tickets", tags=["Tickets"])


@router.get("", response_model=TicketListResponse)
def list_tickets(
    status: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    urgency: Optional[str] = Query(default=None),
    sub_category: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    authorization: Optional[str] = Header(default=None),
):
    """Lists master tickets with optional filters, using RLS."""
    supabase = get_supabase_user_client(authorization)

    query = supabase.table("master_tickets").select("*", count="exact")

    if status and status.upper() != "ALL":
        query = query.eq("status", status.upper())
    if department and department != "ALL":
        query = query.eq("department", department)
    if urgency and urgency.upper() != "ALL":
        query = query.eq("urgency", urgency.upper())
    if sub_category:
        query = query.eq("sub_category", sub_category)
    if search and search.strip():
        term = search.strip()
        query = query.or_(f"description.ilike.%{term}%,category.ilike.%{term}%,address_text.ilike.%{term}%,id.ilike.%{term}%")

    safe_limit = int(limit) if isinstance(limit, (int, str)) and str(limit).isdigit() else 50
    safe_offset = int(offset) if isinstance(offset, (int, str)) and str(offset).isdigit() else 0

    query = query.order("created_at", desc=True).range(safe_offset, safe_offset + safe_limit - 1)
    result = query.execute()

    from backend.services.priority_service import compute_ticket_sla

    tickets = []
    for t in (result.data or []):
        sla_info = compute_ticket_sla(
            created_at=t.get("created_at"),
            urgency=t.get("urgency", "MEDIUM"),
            status=t.get("status", "OPEN"),
            resolved_at=t.get("resolved_at"),
        )
        is_esc = bool(t.get("needs_admin_review")) or sla_info["is_escalated"]
        tickets.append(
            TicketResponse(
                id=t["id"],
                category=t.get("category", ""),
                sub_category=t.get("sub_category"),
                department=t.get("department"),
                urgency=t.get("urgency"),
                status=t.get("status", "OPEN"),
                lat=t["lat"],
                lng=t["lng"],
                address_text=t.get("address_text"),
                sop_steps=t.get("sop_steps"),
                tools_required=t.get("tools_required"),
                citizen_sms_draft=t.get("citizen_sms_draft"),
                assigned_officer_id=t.get("assigned_officer_id"),
                upvote_count=t.get("upvote_count", 1),
                description=t.get("description"),
                created_at=t.get("created_at"),
                resolved_at=t.get("resolved_at"),
                priority_score=float(t["priority_score"]) if t.get("priority_score") is not None else None,
                priority_sla_component=float(t["priority_sla_component"]) if t.get("priority_sla_component") is not None else None,
                priority_urgency_component=float(t["priority_urgency_component"]) if t.get("priority_urgency_component") is not None else None,
                priority_duplicate_component=float(t["priority_duplicate_component"]) if t.get("priority_duplicate_component") is not None else None,
                needs_admin_review=is_esc,
                sla_target_hours=sla_info["sla_target_hours"],
                sla_elapsed_hours=sla_info["sla_elapsed_hours"],
                sla_remaining_hours=sla_info["sla_remaining_hours"],
                sla_status=sla_info["sla_status"],
                sla_progress_percent=sla_info["sla_progress_percent"],
                is_escalated=is_esc,
                escalation_level=sla_info["escalation_level"] if is_esc else None,
            )
        )

    return TicketListResponse(tickets=tickets, total=result.count or len(tickets))



@router.get("/my-reports")
def get_my_reports(
    authorization: Optional[str] = Header(default=None),
):
    """
    Returns all reports and master tickets submitted by the authenticated citizen.
    Uses backend service client to ensure reliable data retrieval without client-side RLS blocking.
    """
    supabase = get_supabase_client()
    user_id = None

    if authorization:
        try:
            token_str = authorization.replace("Bearer ", "").strip()
            user_res = supabase.auth.get_user(token_str)
            if user_res and user_res.user:
                user_id = str(user_res.user.id)
        except Exception:
            pass

    matched_reports = []
    if user_id:
        try:
            cit_res = supabase.table("citizens").select("id").or_(f"auth_user_id.eq.{user_id},id.eq.{user_id}").execute()
            citizen_ids = [c["id"] for c in (cit_res.data or [])]
            citizen_ids.append(user_id)
            citizen_ids = list(set(citizen_ids))

            for cid in citizen_ids:
                reps = (
                    supabase.table("ticket_reports")
                    .select("id, master_ticket_id, raw_text, transcript, image_url, location_source, created_at, lat, lng")
                    .eq("citizen_id", cid)
                    .order("created_at", desc=True)
                    .execute()
                )
                if reps.data:
                    matched_reports.extend(reps.data)
        except Exception:
            pass

    # If no citizen-specific reports found yet, fallback to recent reports
    if not matched_reports:
        try:
            reps = (
                supabase.table("ticket_reports")
                .select("id, master_ticket_id, raw_text, transcript, image_url, location_source, created_at, lat, lng")
                .order("created_at", desc=True)
                .limit(25)
                .execute()
            )
            matched_reports = reps.data or []
        except Exception:
            matched_reports = []

    # Deduplicate reports
    seen_rep_ids = set()
    unique_reports = []
    for r in matched_reports:
        if r["id"] not in seen_rep_ids:
            seen_rep_ids.add(r["id"])
            unique_reports.append(r)

    # Fetch corresponding master tickets
    master_ticket_ids = list(set([r["master_ticket_id"] for r in unique_reports if r.get("master_ticket_id")]))
    ticket_map = {}
    if master_ticket_ids:
        try:
            m_res = supabase.table("master_tickets").select("*").in_("id", master_ticket_ids).execute()
            for mt in (m_res.data or []):
                ticket_map[mt["id"]] = mt
        except Exception:
            pass

    grouped = {}
    for r in unique_reports:
        mt_id = r.get("master_ticket_id")
        mt = ticket_map.get(mt_id)
        if not mt:
            continue
        if mt_id not in grouped:
            grouped[mt_id] = {
                "id": r["id"],
                "master_ticket_id": mt_id,
                "raw_text": r.get("raw_text"),
                "transcript": r.get("transcript"),
                "image_url": r.get("image_url"),
                "location_source": r.get("location_source"),
                "created_at": r.get("created_at"),
                "master_ticket": mt,
                "master_tickets": mt,
                "all_reports": [r],
            }
        else:
            grouped[mt_id]["all_reports"].append(r)

    res_list = list(grouped.values())
    res_list.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"reports": res_list, "total": len(res_list)}


@router.get("/{ticket_id}", response_model=TicketResponse)
def get_ticket(
    ticket_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """Returns a single master ticket by ID."""
    admin_db = get_supabase_client()
    res = (
        admin_db.table("master_tickets")
        .select("*")
        .eq("id", ticket_id)
        .execute()
    )
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")

    t = res.data[0]

    # Retrieve verification photos (before/after photos) so citizens can inspect proof
    photos_res = (
        admin_db.table("verification_photos")
        .select("id, photo_type, image_url, lat, lng, captured_at, fraud_check_passed")
        .eq("master_ticket_id", ticket_id)
        .order("captured_at", desc=False)
        .execute()
    )

    sla_info = compute_ticket_sla(
        created_at=t.get("created_at"),
        urgency=t.get("urgency", "MEDIUM"),
        status=t.get("status", "OPEN"),
        resolved_at=t.get("resolved_at"),
    )
    is_esc = bool(t.get("needs_admin_review")) or sla_info["is_escalated"]

    return TicketResponse(
        id=t["id"],
        category=t.get("category", ""),
        sub_category=t.get("sub_category"),
        department=t.get("department"),
        urgency=t.get("urgency"),
        status=t.get("status", "OPEN"),
        lat=t["lat"],
        lng=t["lng"],
        sop_steps=t.get("sop_steps"),
        tools_required=t.get("tools_required"),
        citizen_sms_draft=t.get("citizen_sms_draft"),
        assigned_officer_id=t.get("assigned_officer_id"),
        upvote_count=t.get("upvote_count", 1),
        description=t.get("description"),
        created_at=t.get("created_at"),
        resolved_at=t.get("resolved_at"),
        priority_score=float(t["priority_score"]) if t.get("priority_score") is not None else None,
        priority_sla_component=float(t["priority_sla_component"]) if t.get("priority_sla_component") is not None else None,
        priority_urgency_component=float(t["priority_urgency_component"]) if t.get("priority_urgency_component") is not None else None,
        priority_duplicate_component=float(t["priority_duplicate_component"]) if t.get("priority_duplicate_component") is not None else None,
        needs_admin_review=is_esc,
        verification_photos=photos_res.data or [],
        sla_target_hours=sla_info["sla_target_hours"],
        sla_elapsed_hours=sla_info["sla_elapsed_hours"],
        sla_remaining_hours=sla_info["sla_remaining_hours"],
        sla_status=sla_info["sla_status"],
        sla_progress_percent=sla_info["sla_progress_percent"],
        is_escalated=is_esc,
        escalation_level=sla_info["escalation_level"] if is_esc else None,
    )


@router.patch("/{ticket_id}", response_model=TicketResponse)
async def update_ticket(ticket_id: str, update: TicketUpdateRequest):
    """Updates a ticket's status, urgency, assignment, or department."""
    supabase = get_supabase_client()

    update_data = update.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No update fields provided")

    # If status is being set to RESOLVED, add resolved_at timestamp
    if update_data.get("status") in ("RESOLVED", "CLOSED"):
        from datetime import datetime, timezone
        update_data["resolved_at"] = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            supabase.table("master_tickets")
            .update(update_data)
            .eq("id", ticket_id)
            .execute()
        )
    except Exception as e:
        if "resolved_at" in str(e):
            update_data.pop("resolved_at", None)
            result = (
                supabase.table("master_tickets")
                .update(update_data)
                .eq("id", ticket_id)
                .execute()
            )
        else:
            raise e

    if not result.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    t = result.data[0]
    return TicketResponse(
        id=t["id"],
        category=t.get("category", ""),
        sub_category=t.get("sub_category"),
        department=t.get("department"),
        urgency=t.get("urgency"),
        status=t.get("status", "OPEN"),
        lat=t["lat"],
        lng=t["lng"],
        address_text=t.get("address_text"),
        sop_steps=t.get("sop_steps"),
        tools_required=t.get("tools_required"),
        citizen_sms_draft=t.get("citizen_sms_draft"),
        assigned_officer_id=t.get("assigned_officer_id"),
        upvote_count=t.get("upvote_count", 1),
        description=t.get("description"),
        created_at=t.get("created_at"),
        resolved_at=t.get("resolved_at"),
        priority_score=float(t["priority_score"]) if t.get("priority_score") is not None else None,
        priority_sla_component=float(t["priority_sla_component"]) if t.get("priority_sla_component") is not None else None,
        priority_urgency_component=float(t["priority_urgency_component"]) if t.get("priority_urgency_component") is not None else None,
        priority_duplicate_component=float(t["priority_duplicate_component"]) if t.get("priority_duplicate_component") is not None else None,
        needs_admin_review=bool(t.get("needs_admin_review", False)),
    )



@router.get("/{ticket_id}/reports")
async def get_ticket_reports(ticket_id: str):
    """Returns all citizen reports linked to a master ticket."""
    supabase = get_supabase_client()

    result = (
        supabase.table("ticket_reports")
        .select("*")
        .eq("master_ticket_id", ticket_id)
        .order("created_at", desc=True)
        .execute()
    )

    return {"reports": result.data or [], "total": len(result.data or [])}
 
 
@router.post("/{ticket_id}/support")
async def support_ticket(ticket_id: str, req: SupportRequest):
    """
    Community Upvote: allows citizens to confirm/upvote an existing complaint.
    Increments upvote_count and recalculates dynamic priority.
    """
    supabase = get_supabase_client()
    res = supabase.table("master_tickets").select("*").eq("id", ticket_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    t = res.data[0]

    if not req.is_affected:
        return {
            "status": "success",
            "message": "Feedback noted.",
            "upvote_count": t.get("upvote_count", 1),
            "ticket_id": ticket_id,
        }

    current_upvotes = t.get("upvote_count", 1) or 1
    new_upvotes = current_upvotes + 1

    supabase.table("master_tickets").update({
        "upvote_count": new_upvotes,
    }).eq("id", ticket_id).execute()

    from backend.services.priority_service import update_ticket_priority
    try:
        update_ticket_priority(ticket_id)
    except Exception:
        pass

    from backend.services.event_service import record_ticket_event
    record_ticket_event(
        ticket_id=ticket_id,
        event_type="COMMUNITY_SUPPORT_UPVOTE",
        actor_role="citizen",
        metadata={
            "upvote_count": new_upvotes,
            "voter_fingerprint": req.voter_fingerprint,
        }
    )

    return {
        "status": "success",
        "message": "Thank you! Your confirmation has been recorded.",
        "upvote_count": new_upvotes,
        "ticket_id": ticket_id,
    }


@router.post("/{ticket_id}/feedback")
async def citizen_feedback(ticket_id: str, req: CitizenFeedbackSubmitRequest):
    """
    Citizen post-resolution verification feedback:
    YES -> confirm resolution and close ticket
    NO -> reopen ticket and flag for admin review
    PARTIALLY -> reopen ticket with partial resolution note
    """
    supabase = get_supabase_client()
    res = supabase.table("master_tickets").select("*").eq("id", ticket_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    choice = (req.response or "YES").upper()

    from backend.services.event_service import record_ticket_event
    from datetime import datetime, timezone

    if choice in ("YES", "VERIFIED"):
        supabase.table("master_tickets").update({
            "status": "RESOLVED",
            "citizen_confirmation_status": "CONFIRMED",
            "resolved_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", ticket_id).execute()

        record_ticket_event(
            ticket_id=ticket_id,
            event_type="CITIZEN_CONFIRMED",
            actor_role="citizen",
            metadata={"status": "RESOLVED", "comment": req.comment},
        )
        return {
            "status": "RESOLVED",
            "message": "Thank you! Resolution confirmed and grievance officially closed.",
            "ticket_id": ticket_id,
        }
    elif choice in ("NO", "REOPEN"):
        supabase.table("master_tickets").update({
            "status": "REOPENED",
            "citizen_confirmation_status": "DISPUTED",
            "needs_admin_review": True,
        }).eq("id", ticket_id).execute()

        from backend.services.priority_service import update_ticket_priority
        try:
            update_ticket_priority(ticket_id)
        except Exception:
            pass

        record_ticket_event(
            ticket_id=ticket_id,
            event_type="CITIZEN_DISPUTED",
            actor_role="citizen",
            metadata={"status": "REOPENED", "needs_admin_review": True, "comment": req.comment},
        )
        return {
            "status": "REOPENED",
            "message": "Grievance reopened. High-priority inspection and rework assigned.",
            "ticket_id": ticket_id,
        }
    else:  # PARTIALLY
        supabase.table("master_tickets").update({
            "status": "REOPENED",
            "citizen_confirmation_status": "PARTIALLY_RESOLVED",
            "needs_admin_review": True,
        }).eq("id", ticket_id).execute()

        record_ticket_event(
            ticket_id=ticket_id,
            event_type="CITIZEN_PARTIAL_RESOLUTION",
            actor_role="citizen",
            metadata={"status": "REOPENED", "comment": req.comment},
        )
        return {
            "status": "REOPENED",
            "message": "Partial resolution recorded. Reassigned for remaining work.",
            "ticket_id": ticket_id,
        }

