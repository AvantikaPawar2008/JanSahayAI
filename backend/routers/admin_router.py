"""Admin dashboard — metrics, hotspot detection, and root-cause alert management.
Split into two purpose-built endpoints:
  1. GET /api/admin/metrics — headline dashboard counts, SLA breach rate, status breakdowns
  2. GET /api/admin/hotspot-map — dedicated map endpoint with clusters and heatmap points
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query, Header, HTTPException

from backend.db.supabase_client import get_supabase_client, get_supabase_user_client
from backend.services.hotspot_service import detect_hotspots, analyze_hotspot_root_cause
from backend.models.schemas import (
    DashboardMetrics,
    HotspotAlert,
    HotspotDetectionResponse,
    DepartmentReassignRequest,
    DepartmentType,
)

logger = logging.getLogger("civicpulse.admin")
router = APIRouter(prefix="/api/admin", tags=["Admin"])


@router.get("/metrics", response_model=DashboardMetrics)
async def get_dashboard_metrics(authorization: Optional[str] = Header(default=None)):
    """
    Returns lean aggregated headline metrics for AdminDashboardPage.
    Includes SLA breach rate and counts without geo/map payload.
    """
    supabase = get_supabase_user_client(authorization)

    # 1. Total tickets
    total_result = supabase.table("master_tickets").select("id", count="exact").execute()
    total = total_result.count or 0

    # 2. Status counts
    open_result = supabase.table("master_tickets").select("id, created_at, urgency", count="exact").in_("status", ["OPEN", "REOPENED"]).execute()
    in_progress_result = supabase.table("master_tickets").select("id", count="exact").in_("status", ["ASSIGNED", "IN_PROGRESS"]).execute()
    resolved_result = supabase.table("master_tickets").select("id", count="exact").in_("status", ["RESOLVED", "RESOLVED_PENDING_CITIZEN", "CLOSED"]).execute()
    critical_result = supabase.table("master_tickets").select("id", count="exact").eq("urgency", "CRITICAL").in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"]).execute()

    # 3. SLA breach calculation (Critical > 12h, High > 24h, Medium/Low > 48h)
    now = datetime.now(timezone.utc)
    open_tickets = open_result.data or []
    breached_count = 0
    for t in open_tickets:
        if t.get("created_at"):
            try:
                created = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                elapsed_hours = (now - created).total_seconds() / 3600.0
                urgency = t.get("urgency", "MEDIUM")
                sla_threshold = 12 if urgency == "CRITICAL" else (24 if urgency == "HIGH" else 48)
                if elapsed_hours > sla_threshold:
                    breached_count += 1
            except Exception:
                pass

    open_count = open_result.count or 0
    sla_breach_rate = round((breached_count / open_count * 100), 1) if open_count > 0 else 0.0

    # 4. Department counts and per-department status breakdown
    standard_depts = [
        "Water Supply & Sewerage",
        "Roads & Infrastructure",
        "Solid Waste Management",
        "Electrical & Streetlighting",
        "Health & Sanitation",
    ]
    dept_status_map = {d: {"department": d, "open": 0, "in_progress": 0, "resolved": 0, "total": 0} for d in standard_depts}

    all_tickets_dept = supabase.table("master_tickets").select("department, status").execute().data or []
    dept_counts: Dict[str, int] = {}
    for t in all_tickets_dept:
        dept = t.get("department") or "Unassigned"
        dept_counts[dept] = dept_counts.get(dept, 0) + 1
        st = t.get("status", "OPEN")
        if dept in dept_status_map:
            dept_status_map[dept]["total"] += 1
            if st in ("OPEN", "REOPENED"):
                dept_status_map[dept]["open"] += 1
            elif st in ("ASSIGNED", "IN_PROGRESS"):
                dept_status_map[dept]["in_progress"] += 1
            elif st in ("RESOLVED", "RESOLVED_PENDING_CITIZEN", "CLOSED"):
                dept_status_map[dept]["resolved"] += 1

    department_breakdown = list(dept_status_map.values())

    # 5. Urgency counts
    urg_result = supabase.table("master_tickets").select("urgency").execute()
    urg_counts: Dict[str, int] = {}
    for t in (urg_result.data or []):
        urg = t.get("urgency") or "MEDIUM"
        urg_counts[urg] = urg_counts.get(urg, 0) + 1

    # 6. Today's count
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    today_result = supabase.table("master_tickets").select("id", count="exact").gte("created_at", today_start).execute()

    # 7. Active hotspots count
    hotspot_result = supabase.table("hotspot_alerts").select("id", count="exact").in_("status", ["NEW", "ACKNOWLEDGED", "INVESTIGATING"]).execute()

    return DashboardMetrics(
        total_tickets=total,
        open_tickets=open_count,
        in_progress_tickets=in_progress_result.count or 0,
        resolved_tickets=resolved_result.count or 0,
        critical_tickets=critical_result.count or 0,
        tickets_by_department=dept_counts,
        department_breakdown=department_breakdown,
        tickets_by_urgency=urg_counts,
        tickets_today=today_result.count or 0,
        active_hotspots=hotspot_result.count or 0,
        sla_breach_rate=sla_breach_rate,
        sla_breached_tickets=breached_count,
    )


@router.get("/hotspot-map")
@router.get("/map-data")  # alias used by HotspotMapPage
async def get_hotspot_map_data(authorization: Optional[str] = Header(default=None)):
    """
    Dedicated endpoint for the HotspotMapPage.
    Returns:
      - hotspots: active hotspot_alerts rows (cluster circles)
      - tickets: all open master_tickets with lat/lng/urgency/department/category/sub_category
                 (used for the pinpoint layer AND heatmap layer — single fetch, rendered client-side)
      - heatmap_points: pre-computed [lat, lng, intensity] triples for the heatmap layer
    """
    supabase = get_supabase_user_client(authorization)

    # 1. Fetch active hotspot alerts
    hotspot_res = (
        supabase.table("hotspot_alerts")
        .select("*")
        .in_("status", ["NEW", "ACKNOWLEDGED", "INVESTIGATING"])
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    )
    hotspots = hotspot_res.data or []

    # 2. Fetch all open master tickets — single query, used for both pin layer and heatmap
    tickets_res = (
        supabase.table("master_tickets")
        .select("id, lat, lng, category, sub_category, department, urgency, upvote_count, status")
        .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        .limit(500)
        .execute()
    )
    tickets = tickets_res.data or []

    # 3. Format heatmap points: [lat, lng, intensity (0.2 to 1.0)]
    urgency_intensity = {
        "LOW": 0.3,
        "MEDIUM": 0.5,
        "HIGH": 0.8,
        "CRITICAL": 1.0,
    }
    heatmap_points = []
    for t in tickets:
        if t.get("lat") and t.get("lng"):
            base_intensity = urgency_intensity.get(t.get("urgency", "MEDIUM"), 0.5)
            # Boost slightly with upvote_count (capped to avoid overwhelming single tickets)
            intensity = min(1.0, base_intensity + min(t.get("upvote_count", 1) * 0.05, 0.3))
            heatmap_points.append([t["lat"], t["lng"], round(intensity, 2)])

    return {
        "hotspots": hotspots,
        "tickets": tickets,          # NEW: full ticket objects for the pinpoint layer
        "heatmap_points": heatmap_points,
        "total_active_clusters": len([h for h in hotspots if h.get("status") != "RESOLVED"]),
        "total_incident_points": len(heatmap_points),
        "total_open_tickets": len(tickets),
    }


@router.get("/map-data")
async def get_map_data(authorization: Optional[str] = Header(default=None)):
    """
    Unified map data endpoint for HotspotMapPage.
    Returns open master_tickets (for pinpoint layer), hotspot_alerts, and heatmap_points.
    Fetched once and rendered client-side across all three layers.
    """
    supabase = get_supabase_user_client(authorization)

    # Fetch all open master tickets for pinpoint layer
    tickets_res = (
        supabase.table("master_tickets")
        .select("id, lat, lng, category, sub_category, department, urgency, status, upvote_count, description, created_at")
        .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        .limit(500)
        .execute()
    )
    tickets = tickets_res.data or []

    # Fetch active hotspot alerts
    hotspot_res = (
        supabase.table("hotspot_alerts")
        .select("*")
        .in_("status", ["NEW", "ACKNOWLEDGED", "INVESTIGATING"])
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    hotspots = hotspot_res.data or []

    # Build urgency-weighted heatmap points [lat, lng, intensity]
    urgency_intensity = {"LOW": 0.3, "MEDIUM": 0.5, "HIGH": 0.8, "CRITICAL": 1.0}
    heatmap_points = []
    for t in tickets:
        if t.get("lat") and t.get("lng"):
            base_intensity = urgency_intensity.get(t.get("urgency", "MEDIUM"), 0.5)
            intensity = min(1.0, base_intensity + min(t.get("upvote_count", 1) * 0.05, 0.3))
            heatmap_points.append([t["lat"], t["lng"], round(intensity, 2)])

    return {
        "tickets": tickets,
        "hotspots": hotspots,
        "heatmap_points": heatmap_points,
        "total_open_tickets": len(tickets),
        "total_active_clusters": len(hotspots),
    }


@router.get("/hotspots", response_model=list[HotspotAlert])
async def list_hotspots(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=50),
    authorization: Optional[str] = Header(default=None),
):
    """Lists hotspot alerts with optional status filter."""
    supabase = get_supabase_user_client(authorization)

    query = supabase.table("hotspot_alerts").select("*")
    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).limit(limit).execute()

    return [
        HotspotAlert(
            id=h["id"],
            category=h["category"],
            center_lat=h["center_lat"],
            center_lng=h["center_lng"],
            radius_m=h.get("radius_m", 100),
            ticket_count=h.get("ticket_count", 0),
            ticket_ids=h.get("ticket_ids", []),
            status=h.get("status", "NEW"),
            root_cause_analysis=h.get("root_cause_analysis"),
            created_at=h.get("created_at"),
        )
        for h in (result.data or [])
    ]


@router.post("/detect-hotspots", response_model=HotspotDetectionResponse)
async def trigger_hotspot_detection():
    """Manually triggers hotspot detection (DBSCAN clustering on recent tickets)."""
    alerts = await detect_hotspots()
    return HotspotDetectionResponse(
        alerts_created=len(alerts),
        alerts=alerts,
    )


@router.post("/hotspots/{alert_id}/analyze")
async def trigger_root_cause_analysis(alert_id: str):
    """Triggers LLM root-cause analysis for a specific hotspot alert."""
    analysis = await analyze_hotspot_root_cause(alert_id)
    return {"alert_id": alert_id, "root_cause_analysis": analysis}


@router.patch("/hotspots/{alert_id}")
async def update_hotspot_status(
    alert_id: str,
    status: str,
    authorization: Optional[str] = Header(default=None),
):
    """Updates the status of a hotspot alert."""
    supabase = get_supabase_user_client(authorization)

    valid_statuses = ["NEW", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {valid_statuses}")

    result = supabase.table("hotspot_alerts").update({"status": status}).eq("id", alert_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Hotspot alert not found")

    return result.data[0]


@router.patch("/tickets/{ticket_id}/reassign-department")
async def reassign_ticket_department(
    ticket_id: str,
    body: DepartmentReassignRequest,
    authorization: Optional[str] = Header(default=None),
):
    """
    Reassigns a misrouted ticket to the correct department,
    clearing the needs_admin_review flag and logging audit metadata.
    """
    supabase = get_supabase_user_client(authorization)
    admin_client = get_supabase_client()

    admin_user_id = None
    if authorization and "Bearer " in authorization:
        try:
            token = authorization.split("Bearer ")[1].strip()
            user_res = supabase.auth.get_user(token)
            if user_res and user_res.user:
                admin_user_id = user_res.user.id
        except Exception:
            pass

    update_payload = {
        "department": body.department.value,
        "needs_admin_review": False,
        "department_reassigned_at": datetime.now(timezone.utc).isoformat(),
    }
    if admin_user_id:
        update_payload["department_reassigned_by"] = admin_user_id

    try:
        result = admin_client.table("master_tickets").update(update_payload).eq("id", ticket_id).execute()
    except Exception as e:
        # If audit columns aren't in database yet, update department cleanly
        if "needs_admin_review" in str(e) or "department_reassigned" in str(e):
            result = admin_client.table("master_tickets").update({"department": body.department.value}).eq("id", ticket_id).execute()
        else:
            raise HTTPException(status_code=500, detail=str(e))

    if not result.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    logger.info(f"Ticket {ticket_id} reassigned to '{body.department.value}' by admin {admin_user_id}")
    return {
        "message": f"Ticket reassigned to {body.department.value}",
        "ticket": result.data[0],
    }


@router.get("/misclassified-tickets")
async def get_misclassified_tickets(authorization: Optional[str] = Header(default=None)):
    """
    Returns all master tickets flagged with needs_admin_review = true.
    """
    admin_client = get_supabase_client()
    try:
        res = (
            admin_client.table("master_tickets")
            .select("*")
            .eq("needs_admin_review", True)
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.warning(f"Notice fetching misclassified tickets: {e}")
        return []

