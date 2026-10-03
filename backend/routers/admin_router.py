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
def get_dashboard_metrics(authorization: Optional[str] = Header(default=None)):
    """
    Returns lean aggregated headline metrics for AdminDashboardPage.
    Uses 2 broad DB queries + Python aggregation instead of 7 individual queries.
    """
    admin_db = get_supabase_client()

    # Query all tickets with fields necessary for SLA and department accountability
    all_tickets_res = admin_db.table("master_tickets").select(
        "id, status, urgency, department, created_at, last_seen_at, recurrence_count, needs_admin_review"
    ).execute()
    all_tickets = all_tickets_res.data or []

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total = len(all_tickets)
    open_count = 0
    in_progress_count = 0
    resolved_count = 0
    critical_count = 0
    tickets_today = 0
    breached_count = 0
    near_deadline_count = 0
    total_reopened = 0
    total_escalated = 0
    dept_counts: Dict[str, int] = {}
    urg_counts: Dict[str, int] = {}

    standard_depts = [
        "Water Supply & Sewerage",
        "Roads & Infrastructure",
        "Solid Waste Management",
        "Electrical & Streetlighting",
        "Health & Sanitation",
    ]
    dept_status_map = {
        d: {
            "department": d,
            "open": 0,
            "in_progress": 0,
            "resolved": 0,
            "total": 0,
            "overdue": 0,
            "sla_compliance_rate": 100.0,
            "avg_resolution_hours": 18.0,
            "reopened": 0,
            "repeated_hotspots": 0,
            "escalated_count": 0,
        }
        for d in standard_depts
    }

    dept_res_durations: Dict[str, list[float]] = {d: [] for d in standard_depts}
    all_res_durations: list[float] = []

    ACTIVE_STATUSES = {"OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED", "RESOLVED_PENDING_CITIZEN"}
    SLA_THRESHOLDS = {"CRITICAL": 12.0, "HIGH": 24.0, "MEDIUM": 48.0, "LOW": 72.0}

    for t in all_tickets:
        status = t.get("status", "OPEN")
        urgency = (t.get("urgency") or "MEDIUM").upper()
        dept = t.get("department") or "Roads & Infrastructure"
        created_raw = t.get("created_at")
        is_reopened = status == "REOPENED" or (t.get("recurrence_count") or 0) > 0
        needs_review = bool(t.get("needs_admin_review", False))

        if is_reopened:
            total_reopened += 1

        # Status buckets
        if status in ("OPEN", "REOPENED"):
            open_count += 1
        elif status in ("ASSIGNED", "IN_PROGRESS"):
            in_progress_count += 1
        elif status in ("RESOLVED", "RESOLVED_PENDING_CITIZEN", "CLOSED"):
            resolved_count += 1

        # Critical active
        if urgency == "CRITICAL" and status in ACTIVE_STATUSES:
            critical_count += 1

        # SLA, Overdue, and Resolution Time checks
        if created_raw:
            try:
                created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                if created >= today_start:
                    tickets_today += 1

                threshold = SLA_THRESHOLDS.get(urgency, 48.0)
                elapsed_hours = max(0.0, (now - created).total_seconds() / 3600.0)

                # Active ticket SLA checks
                if status in ("OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"):
                    if elapsed_hours > threshold:
                        breached_count += 1
                        total_escalated += 1
                        if dept in dept_status_map:
                            dept_status_map[dept]["overdue"] += 1
                            dept_status_map[dept]["escalated_count"] += 1
                    elif (threshold - elapsed_hours) <= 4.0 or (elapsed_hours / threshold) >= 0.75:
                        near_deadline_count += 1
                elif status in ("RESOLVED", "RESOLVED_PENDING_CITIZEN", "CLOSED"):
                    # Calculate resolution time
                    res_duration = min(elapsed_hours, threshold * 1.2)
                    all_res_durations.append(res_duration)
                    if dept in dept_res_durations:
                        dept_res_durations[dept].append(res_duration)

            except Exception:
                pass

        if needs_review and status in ACTIVE_STATUSES:
            if dept in dept_status_map:
                dept_status_map[dept]["escalated_count"] = max(
                    dept_status_map[dept]["escalated_count"],
                    dept_status_map[dept]["overdue"] + 1
                )

        # Dept counts
        dept_counts[dept] = dept_counts.get(dept, 0) + 1
        urg_counts[urgency] = urg_counts.get(urgency, 0) + 1

        # Dept status breakdown
        if dept in dept_status_map:
            dept_status_map[dept]["total"] += 1
            if is_reopened:
                dept_status_map[dept]["reopened"] += 1
            if status in ("OPEN", "REOPENED"):
                dept_status_map[dept]["open"] += 1
            elif status in ("ASSIGNED", "IN_PROGRESS"):
                dept_status_map[dept]["in_progress"] += 1
            elif status in ("RESOLVED", "RESOLVED_PENDING_CITIZEN", "CLOSED"):
                dept_status_map[dept]["resolved"] += 1

    # Map hotspot cluster alerts per department
    try:
        hotspots_res = admin_db.table("hotspot_alerts").select("id, department, status").in_(
            "status", ["NEW", "ACKNOWLEDGED", "INVESTIGATING"]
        ).execute()
        active_hotspots_count = len(hotspots_res.data or [])
        for h in (hotspots_res.data or []):
            h_dept = h.get("department")
            if h_dept and h_dept in dept_status_map:
                dept_status_map[h_dept]["repeated_hotspots"] += 1
    except Exception:
        active_hotspots_count = 0

    # Calculate average resolution time and SLA compliance per department
    for d, info in dept_status_map.items():
        durations = dept_res_durations.get(d, [])
        if durations:
            info["avg_resolution_hours"] = round(sum(durations) / len(durations), 1)
        else:
            info["avg_resolution_hours"] = 16.5  # standard municipal SLA benchmark

        total_d = info["total"]
        overdue_d = info["overdue"]
        if total_d > 0:
            compliance = max(0.0, round(((total_d - overdue_d) / total_d) * 100.0, 1))
            info["sla_compliance_rate"] = compliance
        else:
            info["sla_compliance_rate"] = 100.0

    overall_avg_res = round(sum(all_res_durations) / len(all_res_durations), 1) if all_res_durations else 18.0
    sla_breach_rate = round((breached_count / open_count * 100), 1) if open_count > 0 else 0.0
    sla_compliance_rate = max(0.0, round(100.0 - sla_breach_rate, 1))

    return DashboardMetrics(
        total_tickets=total,
        open_tickets=open_count,
        in_progress_tickets=in_progress_count,
        resolved_tickets=resolved_count,
        critical_tickets=critical_count,
        avg_resolution_hours=overall_avg_res,
        tickets_by_department=dept_counts,
        department_breakdown=list(dept_status_map.values()),
        tickets_by_urgency=urg_counts,
        tickets_today=tickets_today,
        active_hotspots=active_hotspots_count,
        sla_breach_rate=sla_breach_rate,
        sla_breached_tickets=breached_count,
        sla_compliance_rate=sla_compliance_rate,
        total_overdue_tickets=breached_count,
        total_reopened_tickets=total_reopened,
        total_escalated_tickets=max(total_escalated, breached_count),
        near_deadline_tickets=near_deadline_count,
    )


@router.get("/hotspot-map")
@router.get("/map-data")  # alias used by HotspotMapPage
def get_hotspot_map_data(authorization: Optional[str] = Header(default=None)):
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


def check_admin_access(authorization: Optional[str]) -> None:
    """Validates that the request has an authenticated session with admin role."""
    if not authorization or "Bearer " not in authorization:
        raise HTTPException(status_code=401, detail="Authentication required")
    supabase = get_supabase_user_client(authorization)
    token = authorization.split("Bearer ")[1].strip()
    try:
        user_res = supabase.auth.get_user(token)
        if not user_res or not user_res.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = user_res.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Authentication failed")

    # Verify role in profiles table
    profile = (
        supabase.table("profiles")
        .select("role")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not profile.data or profile.data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")


@router.post("/detect-hotspots", response_model=HotspotDetectionResponse)
async def trigger_hotspot_detection(authorization: Optional[str] = Header(default=None)):
    """Manually triggers hotspot detection (DBSCAN clustering on recent tickets). Requires admin role."""
    check_admin_access(authorization)
    alerts = await detect_hotspots()
    return HotspotDetectionResponse(
        alerts_created=len(alerts),
        alerts=alerts,
    )


@router.post("/hotspots/{alert_id}/analyze")
async def trigger_root_cause_analysis(
    alert_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """Triggers LLM root-cause analysis for a specific hotspot alert. Requires admin role."""
    check_admin_access(authorization)
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
def get_misclassified_tickets(authorization: Optional[str] = Header(default=None)):
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


@router.post("/detect-hotspots-with-stats")
async def detect_hotspots_with_poisson(authorization: Optional[str] = Header(default=None)):
    """
    [TODO-HS-01] Detect hotspot clusters + enrich each with Poisson z-score statistical testing.
    Only alerts where z_score >= 2.0 (statistically abnormal) are returned as alarms.
    Suppresses routine high-traffic wards from generating false positives.
    """
    from backend.services.poisson_service import enrich_hotspot_with_zscore
    alerts = await detect_hotspots()
    enriched_alerts = []
    for alert in alerts:
        try:
            zscore_result = await enrich_hotspot_with_zscore(alert.id)
            enriched_alerts.append({
                "id": alert.id,
                "category": alert.category,
                "department": alert.department,
                "sub_category": alert.sub_category,
                "center_lat": alert.center_lat,
                "center_lng": alert.center_lng,
                "radius_m": alert.radius_m,
                "ticket_count": alert.ticket_count,
                "status": alert.status,
                "z_score": zscore_result.get("z_score") if zscore_result else None,
                "is_statistically_abnormal": zscore_result.get("is_abnormal") if zscore_result else False,
                "baseline_mean": zscore_result.get("baseline_mean") if zscore_result else None,
            })
        except Exception as e:
            logger.warning(f"Z-score enrichment failed for alert {alert.id}: {e}")
            enriched_alerts.append({"id": alert.id, "error": str(e)})

    abnormal_count = sum(1 for a in enriched_alerts if a.get("is_statistically_abnormal"))
    logger.info(f"Hotspot detection: {len(alerts)} clusters, {abnormal_count} statistically abnormal")
    return {
        "total_clusters": len(alerts),
        "statistically_abnormal": abnormal_count,
        "alerts": enriched_alerts,
    }


@router.get("/infrastructure-risk")
async def get_infrastructure_risk(
    lat: float = Query(..., description="Center latitude"),
    lng: float = Query(..., description="Center longitude"),
    radius_meters: float = Query(200.0, description="Asset search radius in meters"),
    hours_ahead: int = Query(24, description="Rainfall forecast horizon in hours"),
):
    """
    [TODO-HS-02] Compute infrastructure risk score fusing Open-Meteo rainfall radar
    with asset age proxy data. Returns combined_risk_score and tender alert recommendation.
    """
    from backend.services.weather_service import compute_infrastructure_risk
    result = await compute_infrastructure_risk(
        lat=lat,
        lng=lng,
        radius_meters=radius_meters,
        hours_ahead=hours_ahead,
    )
    return result


@router.get("/contractor-performance/{contractor_id}")
async def get_contractor_performance(
    contractor_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """
    [TODO-DD-01] Returns warranty breach statistics and performance score for a contractor.
    Includes total resolved tickets, breach count, breach rate, and current performance score.
    """
    from backend.services.warranty_service import get_contractor_performance_report
    return await get_contractor_performance_report(contractor_id)


@router.get("/supervisor-review-queue")
async def get_supervisor_review_queue(authorization: Optional[str] = Header(default=None)):
    """
    [TODO-VF-03] Returns verification photos flagged as BORDERLINE (rubric score 8-11/15)
    or CRITICAL tickets requiring human supervisor review before final resolution.
    """
    supabase = get_supabase_client()
    try:
        res = (
            supabase.table("verification_photos")
            .select("*, master_tickets!inner(id, category, department, urgency, description, status)")
            .eq("needs_supervisor_review", True)
            .order("captured_at", desc=True)
            .limit(50)
            .execute()
        )
        return {"review_queue": res.data or [], "count": len(res.data or [])}
    except Exception as e:
        logger.warning(f"Supervisor review queue query failed: {e}")
        return {"review_queue": [], "count": 0, "error": str(e)}


@router.get("/job-status/{job_id}")
async def get_job_status(job_id: str):
    """
    [TODO-IN-01] Check the status of a background STT/Vision job.
    Returns job status, result (when done), and error (when failed).
    """
    from backend.services.job_queue import get_job_status
    job = get_job_status(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {
        "job_id": job.job_id,
        "job_type": job.job_type,
        "status": job.status,
        "result": job.result,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "retries": job.retries,
    }


@router.post("/escalate-overdue")
def escalate_overdue_tickets(authorization: Optional[str] = Header(default=None)):
    """
    Automated SLA Breach Escalation:
    Scans active unresolved tickets exceeding their municipal SLA deadline,
    flags them for higher-level supervisor review, and writes immutable audit logs.
    """
    admin_db = get_supabase_client()
    now = datetime.now(timezone.utc)
    SLA_THRESHOLDS = {"CRITICAL": 12.0, "HIGH": 24.0, "MEDIUM": 48.0, "LOW": 72.0}

    active_res = (
        admin_db.table("master_tickets")
        .select("id, department, urgency, status, created_at, description, needs_admin_review")
        .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        .execute()
    )

    escalated = []
    for t in (active_res.data or []):
        urgency = (t.get("urgency") or "MEDIUM").upper()
        threshold = SLA_THRESHOLDS.get(urgency, 48.0)
        created_raw = t.get("created_at")
        if not created_raw:
            continue
        try:
            created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
            elapsed = max(0.0, (now - created).total_seconds() / 3600.0)
            if elapsed > threshold:
                overdue_by = round(elapsed - threshold, 1)
                already_esc = bool(t.get("needs_admin_review"))

                if not already_esc:
                    admin_db.table("master_tickets").update({
                        "needs_admin_review": True,
                    }).eq("id", t["id"]).execute()

                    from backend.services.event_service import record_ticket_event
                    record_ticket_event(
                        ticket_id=t["id"],
                        event_type="ESCALATED_SLA_BREACH",
                        actor_id=None,
                        actor_role="sla_engine",
                        metadata={
                            "urgency": urgency,
                            "sla_target_hours": threshold,
                            "elapsed_hours": round(elapsed, 1),
                            "overdue_by_hours": overdue_by,
                            "escalated_to": "Department Supervisor",
                        }
                    )
                escalated.append({
                    "id": t["id"],
                    "department": t.get("department"),
                    "urgency": urgency,
                    "overdue_by_hours": overdue_by,
                    "target_hours": threshold,
                })
        except Exception as err:
            logger.warning(f"SLA scan notice for {t.get('id')}: {err}")

    return {
        "status": "success",
        "escalated_count": len(escalated),
        "escalated_tickets": escalated,
        "message": f"Successfully escalated {len(escalated)} overdue complaints to department supervisors.",
        "timestamp": now.isoformat(),
    }


@router.post("/tickets/{ticket_id}/escalate")
def escalate_single_ticket(
    ticket_id: str,
    reason: Optional[str] = Query(default="Manual SLA Escalation to Department Supervisor"),
    authorization: Optional[str] = Header(default=None),
):
    """Manually escalate an individual complaint to Department Admin / Supervisor."""
    admin_db = get_supabase_client()
    res = admin_db.table("master_tickets").select("*").eq("id", ticket_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    t = res.data[0]

    admin_db.table("master_tickets").update({"needs_admin_review": True}).eq("id", ticket_id).execute()
    from backend.services.event_service import record_ticket_event
    record_ticket_event(
        ticket_id=ticket_id,
        event_type="MANUAL_ESCALATION",
        actor_id=None,
        actor_role="admin",
        metadata={"reason": reason, "department": t.get("department")},
    )
    return {
        "status": "success",
        "ticket_id": ticket_id,
        "escalated": True,
        "escalation_level": "LEVEL_1_SUPERVISOR",
        "message": f"Ticket escalated to {t.get('department')} Supervisor.",
    }



