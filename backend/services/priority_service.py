"""Priority scoring service for CivicPulse master tickets.

Formula:
  priority_score = (sla_elapsed_hours * 0.4) + (urgency_weight * 0.4) + (duplicate_count * 0.2)

Stores 4 columns in master_tickets:
  - priority_sla_component
  - priority_urgency_component
  - priority_duplicate_component
  - priority_score
"""

import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from backend.db.supabase_client import get_supabase_client

logger = logging.getLogger("civicpulse.priority")

URGENCY_WEIGHTS = {
    "LOW": 1.0,
    "MEDIUM": 3.0,
    "HIGH": 7.0,
    "CRITICAL": 10.0,
}

# Municipal SLA Targets by Urgency Level (in hours)
SLA_TARGET_HOURS: Dict[str, float] = {
    "CRITICAL": 12.0,  # Safety hazards, gas leaks, road collapse, severe flooding
    "HIGH": 24.0,      # Major potholes, sewage overflow, active water main burst
    "MEDIUM": 48.0,    # Streetlight outage, missed waste collection, blocked drains
    "LOW": 72.0,       # Cosmetic issues, damaged non-critical street signs
}


def compute_ticket_sla(
    created_at: datetime | str,
    urgency: str = "MEDIUM",
    status: str = "OPEN",
    resolved_at: Optional[datetime | str] = None,
) -> Dict[str, Any]:
    """
    Computes real-time SLA metrics:
      - sla_target_hours: float (12, 24, 48, 72)
      - sla_elapsed_hours: float
      - sla_remaining_hours: float (>= 0.0)
      - sla_status: 'WITHIN_SLA' | 'NEAR_DEADLINE' | 'BREACHED'
      - sla_progress_percent: float (0 to 100+)
      - is_escalated: bool (breached while unresolved)
      - escalation_level: Optional[str] ('LEVEL_1_SUPERVISOR' | 'LEVEL_2_HOD' | None)
    """
    now = datetime.now(timezone.utc)
    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except Exception:
            created_at = now
    elif created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    elif not created_at:
        created_at = now

    target_hours = SLA_TARGET_HOURS.get(str(urgency).upper(), 48.0)

    # Resolution timing
    is_terminal = str(status).upper() in ("RESOLVED", "CLOSED")
    if is_terminal and resolved_at:
        if isinstance(resolved_at, str):
            try:
                resolved_dt = datetime.fromisoformat(resolved_at.replace("Z", "+00:00"))
            except Exception:
                resolved_dt = now
        else:
            resolved_dt = resolved_at
        elapsed_hours = max(0.0, (resolved_dt - created_at).total_seconds() / 3600.0)
    else:
        elapsed_hours = max(0.0, (now - created_at).total_seconds() / 3600.0)

    remaining_hours = max(0.0, target_hours - elapsed_hours)
    progress_percent = round(min(200.0, (elapsed_hours / target_hours) * 100.0), 1)

    if elapsed_hours > target_hours:
        sla_status = "BREACHED"
        is_escalated = not is_terminal
        escalation_level = "LEVEL_2_HOD" if elapsed_hours >= (target_hours * 1.5) else "LEVEL_1_SUPERVISOR"
    elif remaining_hours <= 4.0 or progress_percent >= 75.0:
        sla_status = "NEAR_DEADLINE"
        is_escalated = False
        escalation_level = None
    else:
        sla_status = "WITHIN_SLA"
        is_escalated = False
        escalation_level = None

    return {
        "sla_target_hours": target_hours,
        "sla_elapsed_hours": round(elapsed_hours, 1),
        "sla_remaining_hours": round(remaining_hours, 1),
        "sla_status": sla_status,
        "sla_progress_percent": progress_percent,
        "is_escalated": is_escalated,
        "escalation_level": escalation_level,
    }


def compute_priority_components(
    created_at: datetime | str,
    urgency: str = "MEDIUM",
    duplicate_count: int = 1,
) -> Dict[str, float]:
    """
    Computes priority components and total score.
    Returns:
      {
        "priority_sla_component": float,
        "priority_urgency_component": float,
        "priority_duplicate_component": float,
        "priority_score": float,
      }
    """
    now = datetime.now(timezone.utc)
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    elif created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    sla_elapsed_hours = max(0.0, (now - created_at).total_seconds() / 3600.0)
    urgency_weight = URGENCY_WEIGHTS.get(str(urgency).upper(), 3.0)

    import math

    sla_comp = round(sla_elapsed_hours * 0.4, 2)
    urgency_comp = round(urgency_weight * 0.4, 2)

    # Sub-component for duplicates with Sybil / Priority Hijacking resistance:
    # Linear (0.2 per report) for initial reports (1-5), smoothly tapering with
    # diminishing returns thereafter, capped at a maximum of 5.0.
    if duplicate_count <= 5:
        duplicate_comp = round(max(0.0, duplicate_count * 0.2), 2)
    else:
        duplicate_comp = round(min(5.0, 1.0 + math.log2(max(1, duplicate_count - 3)) * 0.8), 2)

    total_score = round(sla_comp + urgency_comp + duplicate_comp, 2)

    return {
        "priority_sla_component": sla_comp,
        "priority_urgency_component": urgency_comp,
        "priority_duplicate_component": duplicate_comp,
        "priority_score": total_score,
    }


def update_ticket_priority(ticket_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetches ticket by ID, recalculates priority sub-scores, and writes all 4 columns
    to master_tickets in Supabase.
    """
    supabase = get_supabase_client()
    res = supabase.table("master_tickets").select("id, created_at, urgency, upvote_count").eq("id", ticket_id).execute()
    if not res.data:
        logger.warning(f"Ticket {ticket_id} not found for priority recalculation")
        return None

    ticket = res.data[0]
    components = compute_priority_components(
        created_at=ticket["created_at"],
        urgency=ticket.get("urgency", "MEDIUM"),
        duplicate_count=ticket.get("upvote_count", 1),
    )

    update_res = (
        supabase.table("master_tickets")
        .update(components)
        .eq("id", ticket_id)
        .execute()
    )

    if update_res.data:
        logger.info(f"Updated ticket {ticket_id} priority: {components['priority_score']} {components}")
        return update_res.data[0]
    return None


def batch_recalculate_priorities(limit: int = 200) -> int:
    """
    Recalculates priorities for active open tickets.
    """
    supabase = get_supabase_client()
    res = (
        supabase.table("master_tickets")
        .select("id, created_at, urgency, upvote_count")
        .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        .limit(limit)
        .execute()
    )

    updated_count = 0
    for t in (res.data or []):
        try:
            comps = compute_priority_components(
                created_at=t["created_at"],
                urgency=t.get("urgency", "MEDIUM"),
                duplicate_count=t.get("upvote_count", 1),
            )
            supabase.table("master_tickets").update(comps).eq("id", t["id"]).execute()
            updated_count += 1
        except Exception:
            continue

    return updated_count


def recalculate_department_priorities(department: Optional[str] = None, limit: int = 50) -> int:
    """
    Recalculates SLA-elapsed priority scores on demand for active tickets in an officer's department.
    Ensures that queue ranking never displays stale SLA elapsed times.
    """
    try:
        supabase = get_supabase_client()
        query = (
            supabase.table("master_tickets")
            .select("id, created_at, urgency, upvote_count")
            .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        )
        if department:
            query = query.eq("department", department)
            
        res = query.limit(limit).execute()
        updated_count = 0
        for t in (res.data or []):
            try:
                comps = compute_priority_components(
                    created_at=t["created_at"],
                    urgency=t.get("urgency", "MEDIUM"),
                    duplicate_count=t.get("upvote_count", 1),
                )
                supabase.table("master_tickets").update(comps).eq("id", t["id"]).execute()
                updated_count += 1
            except Exception:
                continue

        return updated_count
    except Exception as e:
        logger.warning(f"On-demand priority recalculation skipped: {e}")
        return 0
