"""[TODO-DD-01] 60-Day Contractor Defect Liability Warranty Engine.

Records contractor repair polygons and auto-flags repeat defects within
60 days as zero-cost rework with performance score deductions.

Business Logic:
 1. When a ticket is RESOLVED and a contractor_id is set:
 - warranty_until = resolved_at + 60 days
 - store contractor repair location
 2. On every new ticket submission (called from intake_router):
 - check if new defect falls within warranty zone of a recently resolved ticket
 - if yes: flag as WARRANTY_BREACH, auto-assign to same contractor, deduct performance score
 3. Admin dashboard can query contractor performance table.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from backend.db.supabase_client import get_supabase_client
from backend.services.event_service import record_ticket_event

logger = logging.getLogger("civicpulse.warranty")

WARRANTY_DAYS = 60
WARRANTY_RADIUS_METERS = 25


async def check_warranty_breach(
    lat: float,
    lng: float,
    department: str,
    sub_category: Optional[str] = None,
    citizen_id: Optional[str] = None,
) -> Optional[dict]:
    """
    Check if a new defect falls within the warranty zone of a recently-resolved ticket.

    Args:
        lat: New complaint latitude
        lng: New complaint longitude
        department: Classified department (hard-filter)
        sub_category: Specific defect type (hard-filter when available)
        citizen_id: Optional citizen ID for audit trail

    Returns:
        dict with warranty breach details, or None if no breach found
    """
    supabase = get_supabase_client()
    now = datetime.now(timezone.utc)

    try:
        try:
            result = supabase.rpc(
                "find_warranty_breach",
                {
                    "search_lat": lat,
                    "search_lng": lng,
                    "radius_m": WARRANTY_RADIUS_METERS,
                    "search_department": department,
                },
            ).execute()
            candidates = result.data or []
        except Exception:
            resolved = (
                supabase.table("master_tickets")
                .select("id, lat, lng, department, sub_category, contractor_id, warranty_until, status")
                .eq("status", "RESOLVED")
                .eq("department", department)
                .not_.is_("warranty_until", "null")
                .gt("warranty_until", now.isoformat())
                .execute()
            )
            candidates = []
            from backend.services.geo_service import haversine_distance
            for ticket in (resolved.data or []):
                if ticket.get("lat") and ticket.get("lng"):
                    dist = haversine_distance(lat, lng, ticket["lat"], ticket["lng"])
                    if dist <= WARRANTY_RADIUS_METERS:
                        candidates.append({**ticket, "distance_m": dist})

        if not candidates:
            return None

        best = None
        best_score = -1
        for candidate in candidates:
            score = 0
            if sub_category and candidate.get("sub_category") == sub_category:
                score += 10
            dist = candidate.get("distance_m", WARRANTY_RADIUS_METERS)
            score += (WARRANTY_RADIUS_METERS - dist)
            if score > best_score:
                best_score = score
                best = candidate

        if not best:
            return None

        original_ticket_id = best["id"]
        contractor_id = best.get("contractor_id")
        warranty_until = best.get("warranty_until")

        logger.warning(
            "WARRANTY BREACH detected: new defect at (%.5f, %.5f) is within %dm of "
            "RESOLVED ticket %s (contractor: %s, warranty until: %s)",
            lat, lng, WARRANTY_RADIUS_METERS, original_ticket_id, contractor_id, warranty_until,
        )

        if contractor_id:
            await _deduct_contractor_performance(contractor_id, original_ticket_id, citizen_id)

        return {
            "is_warranty_breach": True,
            "original_ticket_id": original_ticket_id,
            "contractor_id": contractor_id,
            "warranty_until": warranty_until,
            "distance_m": best.get("distance_m", 0),
        }

    except Exception as exc:
        logger.error("Warranty breach check failed: %s", exc)
        return None


async def set_ticket_warranty(
    master_ticket_id: str,
    contractor_id: Optional[str],
    resolved_at: Optional[datetime] = None,
):
    """
    Set warranty_until = resolved_at + 60 days on a resolved ticket.
    Called by verification_router when a ticket moves to RESOLVED.
    """
    supabase = get_supabase_client()
    resolved_at = resolved_at or datetime.now(timezone.utc)
    warranty_until = resolved_at + timedelta(days=WARRANTY_DAYS)

    update_data: dict = {"warranty_until": warranty_until.isoformat()}
    if contractor_id:
        update_data["contractor_id"] = contractor_id

    try:
        supabase.table("master_tickets").update(update_data).eq("id", master_ticket_id).execute()
        logger.info(
            "Warranty set for ticket %s until %s (contractor: %s)",
            master_ticket_id, warranty_until.isoformat(), contractor_id,
        )
    except Exception as exc:
        logger.error("Failed to set warranty for ticket %s: %s", master_ticket_id, exc)


async def _deduct_contractor_performance(
    contractor_id: str,
    original_ticket_id: str,
    citizen_id: Optional[str] = None,
):
    """
    Deduct contractor performance score and log warranty breach event.
    """
    supabase = get_supabase_client()
    try:
        record_ticket_event(
            ticket_id=original_ticket_id,
            event_type="WARRANTY_BREACH",
            actor_id=contractor_id,
            actor_role="contractor",
            metadata={
                "penalty_applied": True,
                "penalty_points": -5,
                "reason": f"Defect recurred within {WARRANTY_DAYS}-day warranty window",
                "reported_by": citizen_id,
            },
        )

        try:
            supabase.rpc(
                "deduct_contractor_performance",
                {"p_officer_id": contractor_id, "p_penalty": 5},
            ).execute()
        except Exception:
            existing = (
                supabase.table("officers")
                .select("performance_score")
                .eq("id", contractor_id)
                .single()
                .execute()
            )
            current_score = (existing.data or {}).get("performance_score", 100)
            new_score = max(0, current_score - 5)
            supabase.table("officers").update(
                {"performance_score": new_score}
            ).eq("id", contractor_id).execute()

        supabase.table("master_tickets").update({
            "needs_admin_review": True,
            "status": "REOPENED",
        }).eq("id", original_ticket_id).execute()

        logger.info(
            "Contractor %s performance score deducted (-5 points) for warranty breach on ticket %s",
            contractor_id, original_ticket_id,
        )
    except Exception as exc:
        logger.error("Failed to deduct contractor performance for %s: %s", contractor_id, exc)


async def get_contractor_performance_report(contractor_id: str) -> dict:
    """
    Returns warranty breach statistics and performance score for a contractor.
    """
    supabase = get_supabase_client()
    try:
        officer = (
            supabase.table("officers")
            .select("id, name, department, performance_score")
            .eq("id", contractor_id)
            .single()
            .execute()
        )
        officer_data = officer.data or {}

        breach_events = (
            supabase.table("ticket_events")
            .select("id")
            .eq("actor_id", contractor_id)
            .eq("event_type", "WARRANTY_BREACH")
            .execute()
        )
        breach_count = len(breach_events.data or [])

        resolved_tickets = (
            supabase.table("master_tickets")
            .select("id")
            .eq("contractor_id", contractor_id)
            .eq("status", "RESOLVED")
            .execute()
        )
        total_resolved = len(resolved_tickets.data or [])
        breach_rate = round(breach_count / max(1, total_resolved) * 100, 1)

        return {
            "contractor_id": contractor_id,
            "name": officer_data.get("name", "Unknown"),
            "department": officer_data.get("department", "Unknown"),
            "performance_score": officer_data.get("performance_score", 100),
            "total_resolved": total_resolved,
            "warranty_breaches": breach_count,
            "breach_rate_pct": breach_rate,
        }
    except Exception as exc:
        logger.error("Failed to generate performance report for %s: %s", contractor_id, exc)
        return {"contractor_id": contractor_id, "error": str(exc)}
