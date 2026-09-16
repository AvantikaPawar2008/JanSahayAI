"""CRUD endpoints for ticket listing, detail view, and status updates."""

from fastapi import APIRouter, HTTPException, Query, Header
from typing import Optional
from backend.db.supabase_client import get_supabase_client, get_supabase_user_client
from backend.models.schemas import TicketResponse, TicketListResponse, TicketUpdateRequest

router = APIRouter(prefix="/api/tickets", tags=["Tickets"])


@router.get("", response_model=TicketListResponse)
async def list_tickets(
    status: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    urgency: Optional[str] = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    authorization: Optional[str] = Header(default=None),
):
    """Lists master tickets with optional filters, using RLS."""
    supabase = get_supabase_user_client(authorization)

    query = supabase.table("master_tickets").select("*", count="exact")

    if status:
        query = query.eq("status", status)
    if department:
        query = query.eq("department", department)
    if urgency:
        query = query.eq("urgency", urgency)

    query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
    result = query.execute()

    tickets = [
        TicketResponse(
            id=t["id"],
            category=t.get("category", ""),
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
            needs_admin_review=bool(t.get("needs_admin_review", False)),
        )
        for t in (result.data or [])
    ]

    return TicketListResponse(tickets=tickets, total=result.count or len(tickets))


@router.get("/{ticket_id}", response_model=TicketResponse)
async def get_ticket(
    ticket_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """Returns a single master ticket by ID."""
    supabase = get_supabase_user_client(authorization)

    result = (
        supabase.table("master_tickets")
        .select("*")
        .eq("id", ticket_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    t = result.data
    return TicketResponse(
        id=t["id"],
        category=t.get("category", ""),
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

    result = (
        supabase.table("master_tickets")
        .update(update_data)
        .eq("id", ticket_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    t = result.data[0]
    return TicketResponse(
        id=t["id"],
        category=t.get("category", ""),
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
