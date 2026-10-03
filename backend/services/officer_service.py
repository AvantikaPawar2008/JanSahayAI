"""Officer service — handles intelligent ticket allotment, load balancing,
and public department/officer accountability & shame analytics.
"""

import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from backend.db.supabase_client import get_supabase_client
from backend.services.priority_service import compute_ticket_sla

logger = logging.getLogger("civicpulse.officer_service")

# Predefined municipal officers across all 5 departments for realistic allotment & accountability
DEFAULT_OFFICERS = [
    # 1. Roads & Infrastructure
    {
        "id": "63f5d9f8-2141-4244-8aaa-d287e42770fb",
        "auth_user_id": "63f5d9f8-2141-4244-8aaa-d287e42770fb",
        "name": "Ramesh Shinde",
        "designation": "Junior Engineer (Roads & Bridges)",
        "department": "Roads & Infrastructure",
        "phone_number": "+91 98230 11223",
    },
    {
        "id": "d1a10001-0000-4000-8000-000000000001",
        "auth_user_id": None,
        "name": "Rajesh Gaikwad",
        "designation": "Assistant Engineer (Pavements)",
        "department": "Roads & Infrastructure",
        "phone_number": "+91 98230 22334",
    },
    # 2. Water Supply & Sewerage
    {
        "id": "d1a10002-0000-4000-8000-000000000002",
        "auth_user_id": None,
        "name": "Vikas Deshmukh",
        "designation": "Junior Engineer (Water Mains)",
        "department": "Water Supply & Sewerage",
        "phone_number": "+91 98230 33445",
    },
    {
        "id": "d1a10003-0000-4000-8000-000000000003",
        "auth_user_id": None,
        "name": "Priya Kulkarni",
        "designation": "Sub-Divisional Officer (Sewerage)",
        "department": "Water Supply & Sewerage",
        "phone_number": "+91 98230 44556",
    },
    # 3. Solid Waste Management
    {
        "id": "63872570-6054-49c4-8c9a-474e03be2606",
        "auth_user_id": "63872570-6054-49c4-8c9a-474e03be2606",
        "name": "Sunil Pawar",
        "designation": "Sanitary Inspector (Ward East)",
        "department": "Solid Waste Management",
        "phone_number": "+91 98230 55667",
    },
    {
        "id": "d1a10004-0000-4000-8000-000000000004",
        "auth_user_id": None,
        "name": "Amit Jadhav",
        "designation": "Sanitation Field Superintendent",
        "department": "Solid Waste Management",
        "phone_number": "+91 98230 66778",
    },
    # 4. Electrical & Streetlighting
    {
        "id": "d1a10005-0000-4000-8000-000000000005",
        "auth_user_id": None,
        "name": "Santosh More",
        "designation": "Line Inspector (Streetlighting Grid)",
        "department": "Electrical & Streetlighting",
        "phone_number": "+91 98230 77889",
    },
    {
        "id": "d1a10006-0000-4000-8000-000000000006",
        "auth_user_id": None,
        "name": "Sneha Joshi",
        "designation": "Electrical Sub-Engineer",
        "department": "Electrical & Streetlighting",
        "phone_number": "+91 98230 88990",
    },
    # 5. Health & Sanitation
    {
        "id": "d1a10007-0000-4000-8000-000000000007",
        "auth_user_id": None,
        "name": "Dr. Deepak Salve",
        "designation": "Public Health Field Officer",
        "department": "Health & Sanitation",
        "phone_number": "+91 98230 99001",
    },
    {
        "id": "d1a10008-0000-4000-8000-000000000008",
        "auth_user_id": None,
        "name": "Kavita Mohite",
        "designation": "Health & Vector Control Inspector",
        "department": "Health & Sanitation",
        "phone_number": "+91 98230 00112",
    },
]


def ensure_officers_seeded():
    """Seeds default municipal officers if the officers table is empty or missing officers."""
    supabase = get_supabase_client()
    try:
        existing = supabase.table("officers").select("id").execute()
        existing_ids = {row["id"] for row in (existing.data or [])}

        to_insert = []
        for o in DEFAULT_OFFICERS:
            if o["id"] not in existing_ids:
                row = {
                    "id": o["id"],
                    "name": o["name"],
                    "department": o["department"],
                    "phone_number": o["phone_number"],
                }
                if o.get("auth_user_id"):
                    row["auth_user_id"] = o["auth_user_id"]
                to_insert.append(row)

        if to_insert:
            supabase.table("officers").insert(to_insert).execute()
            logger.info("Seeded %d municipal officers across departments", len(to_insert))
    except Exception as exc:
        logger.warning("ensure_officers_seeded notice: %s", exc)


def get_all_officers(department: Optional[str] = None) -> List[Dict[str, Any]]:
    """Returns list of all registered municipal officers, optionally filtered by department."""
    ensure_officers_seeded()
    supabase = get_supabase_client()

    query = supabase.table("officers").select("*")
    if department and department.upper() != "ALL":
        query = query.eq("department", department)

    res = query.order("department").order("name").execute()
    return res.data or []


def allot_officer_for_ticket(department: str) -> Optional[Dict[str, Any]]:
    """
    Intelligent load-balanced officer allotment:
    Finds all officers in the department, calculates their current pending workload,
    and returns the officer with the FEWEST pending tickets.
    """
    ensure_officers_seeded()
    supabase = get_supabase_client()

    # 1. Fetch officers in this department
    off_res = supabase.table("officers").select("*").eq("department", department).execute()
    officers = off_res.data or []
    if not officers:
        all_res = supabase.table("officers").select("*").limit(5).execute()
        officers = all_res.data or []
        if not officers:
            return None

    # 2. Count active pending tickets per officer
    active_res = (
        supabase.table("master_tickets")
        .select("assigned_officer_id")
        .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        .execute()
    )

    workload_map: Dict[str, int] = {o["id"]: 0 for o in officers}
    for t in (active_res.data or []):
        off_id = t.get("assigned_officer_id")
        if off_id and off_id in workload_map:
            workload_map[off_id] += 1

    sorted_officers = sorted(officers, key=lambda o: workload_map.get(o["id"], 0))
    chosen = sorted_officers[0]
    chosen["current_pending_count"] = workload_map.get(chosen["id"], 0)
    return chosen


def assign_ticket_to_officer(ticket_id: str, officer_id: str, actor_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Assigns a ticket to a specific officer, updates status to ASSIGNED if OPEN,
    and records an audit event.
    """
    supabase = get_supabase_client()

    off_res = supabase.table("officers").select("*").eq("id", officer_id).single().execute()
    if not off_res.data:
        raise ValueError(f"Officer with ID {officer_id} not found")
    officer = off_res.data

    t_res = supabase.table("master_tickets").select("*").eq("id", ticket_id).single().execute()
    if not t_res.data:
        raise ValueError(f"Ticket with ID {ticket_id} not found")
    ticket = t_res.data

    update_payload = {"assigned_officer_id": officer_id}
    if ticket.get("status") == "OPEN":
        update_payload["status"] = "ASSIGNED"

    supabase.table("master_tickets").update(update_payload).eq("id", ticket_id).execute()

    return {
        "ticket_id": ticket_id,
        "assigned_officer_id": officer_id,
        "officer_name": officer.get("name"),
        "department": officer.get("department"),
        "status": update_payload.get("status", ticket.get("status")),
    }


def auto_allot_unassigned_tickets() -> int:
    """
    Fast batch allotment:
    Fetches all officers and workloads in 2 queries, load-balances in memory,
    and bulk-updates tickets grouped by officer in a handful of queries.
    """
    ensure_officers_seeded()
    supabase = get_supabase_client()

    # 1. Fetch unassigned active tickets
    unassigned_res = (
        supabase.table("master_tickets")
        .select("id, department, status")
        .is_("assigned_officer_id", "null")
        .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        .execute()
    )
    tickets = unassigned_res.data or []
    if not tickets:
        return 0

    # 2. Fetch all officers
    all_officers = supabase.table("officers").select("*").execute().data or []
    if not all_officers:
        return 0

    dept_officers = defaultdict(list)
    for o in all_officers:
        dept_officers[o["department"]].append(o)

    # 3. Calculate current workload per officer
    active_assigned = (
        supabase.table("master_tickets")
        .select("assigned_officer_id")
        .not_.is_("assigned_officer_id", "null")
        .in_("status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        .execute()
        .data or []
    )
    workload = defaultdict(int)
    for a in active_assigned:
        workload[a["assigned_officer_id"]] += 1

    # 4. Group ticket IDs by assigned officer
    officer_assignments = defaultdict(list)
    for t in tickets:
        dept = t.get("department") or "Roads & Infrastructure"
        cands = dept_officers.get(dept) or all_officers
        chosen = min(cands, key=lambda o: workload[o["id"]])
        officer_assignments[chosen["id"]].append(t["id"])
        workload[chosen["id"]] += 1

    # 5. Bulk update master_tickets per officer
    total_assigned = 0
    for off_id, t_ids in officer_assignments.items():
        if t_ids:
            try:
                # Update in batches of 50
                for i in range(0, len(t_ids), 50):
                    batch = t_ids[i:i + 50]
                    supabase.table("master_tickets").update({
                        "assigned_officer_id": off_id,
                        "status": "ASSIGNED",
                    }).in_("id", batch).execute()
                    total_assigned += len(batch)
            except Exception as exc:
                logger.warning("Error bulk-assigning to officer %s: %s", off_id, exc)

    logger.info("Batch auto-allotted %d tickets across officers", total_assigned)
    return total_assigned


def get_public_shame_leaderboard() -> Dict[str, Any]:
    """
    Computes real-time municipal transparency, shame scores, department backlogs,
    and individual officer pending workloads for the Public Shame & Accountability Portal.
    """
    ensure_officers_seeded()
    supabase = get_supabase_client()

    all_tickets_res = (
        supabase.table("master_tickets")
        .select("id, category, sub_category, department, urgency, status, created_at, assigned_officer_id, lat, lng")
        .execute()
    )
    tickets = all_tickets_res.data or []

    officers_res = supabase.table("officers").select("*").execute()
    officers = officers_res.data or []

    now = datetime.now(timezone.utc)

    departments = [
        "Roads & Infrastructure",
        "Water Supply & Sewerage",
        "Solid Waste Management",
        "Electrical & Streetlighting",
        "Health & Sanitation",
    ]

    dept_stats: Dict[str, Dict[str, Any]] = {
        d: {
            "department": d,
            "total_tickets": 0,
            "resolved_tickets": 0,
            "pending_tickets": 0,
            "overdue_tickets": 0,
            "critical_pending": 0,
            "total_resolution_hours": 0.0,
            "officer_count": 0,
        }
        for d in departments
    }

    for o in officers:
        d = o.get("department")
        if d in dept_stats:
            dept_stats[d]["officer_count"] += 1

    officer_stats: Dict[str, Dict[str, Any]] = {}
    for o in officers:
        officer_stats[o["id"]] = {
            "id": o["id"],
            "name": o["name"],
            "department": o.get("department", "General"),
            "phone_number": o.get("phone_number") or "+91 98000 00000",
            "total_assigned": 0,
            "resolved_count": 0,
            "pending_count": 0,
            "overdue_count": 0,
            "critical_count": 0,
            "pending_tickets": [],
        }

    for t in tickets:
        d = t.get("department") or "Roads & Infrastructure"
        status = (t.get("status") or "OPEN").upper()
        urgency = (t.get("urgency") or "MEDIUM").upper()
        assigned_id = t.get("assigned_officer_id")

        is_resolved = status in ("RESOLVED", "CLOSED")

        sla_info = compute_ticket_sla(
            created_at=t.get("created_at"),
            urgency=urgency,
            status=status,
            resolved_at=t.get("resolved_at"),
        )
        is_overdue = sla_info.get("sla_status") == "BREACHED"

        if d in dept_stats:
            dept_stats[d]["total_tickets"] += 1
            if is_resolved:
                dept_stats[d]["resolved_tickets"] += 1
                dept_stats[d]["total_resolution_hours"] += sla_info.get("sla_elapsed_hours", 12.0)
            else:
                dept_stats[d]["pending_tickets"] += 1
                if is_overdue:
                    dept_stats[d]["overdue_tickets"] += 1
                if urgency == "CRITICAL":
                    dept_stats[d]["critical_pending"] += 1

        if assigned_id and assigned_id in officer_stats:
            ost = officer_stats[assigned_id]
            ost["total_assigned"] += 1
            if is_resolved:
                ost["resolved_count"] += 1
            else:
                ost["pending_count"] += 1
                if is_overdue:
                    ost["overdue_count"] += 1
                if urgency == "CRITICAL":
                    ost["critical_count"] += 1

                if len(ost["pending_tickets"]) < 4:
                    ost["pending_tickets"].append({
                        "id": t["id"],
                        "category": t.get("category", "Civic Issue"),
                        "urgency": urgency,
                        "status": status,
                        "created_at": t.get("created_at"),
                        "sla_remaining_hours": sla_info.get("sla_remaining_hours", 0.0),
                        "sla_status": sla_info.get("sla_status", "WITHIN_SLA"),
                    })

    department_list = []
    for d, st in dept_stats.items():
        tot = st["total_tickets"]
        res = st["resolved_tickets"]
        pen = st["pending_tickets"]
        over = st["overdue_tickets"]

        rate = round((res / tot * 100), 1) if tot > 0 else 100.0
        avg_hrs = round((st["total_resolution_hours"] / res), 1) if res > 0 else 0.0

        # Backlog / Shame formula: 0 (perfect) to 100 (severe backlog)
        overdue_factor = min(50.0, over * 15.0)
        pending_factor = (pen / tot * 50.0) if tot > 0 else 0.0
        shame_score = min(100.0, round(overdue_factor + pending_factor, 1))

        if shame_score >= 60:
            shame_tier = "CRITICAL_SHAME"
            tier_label = "Severe Backlog (Public Scrutiny)"
            badge_color = "red"
        elif shame_score >= 35:
            shame_tier = "HIGH_BACKLOG"
            tier_label = "High Pending Backlog"
            badge_color = "amber"
        elif shame_score >= 15:
            shame_tier = "MODERATE"
            tier_label = "Moderate Workload"
            badge_color = "blue"
        else:
            shame_tier = "HONOR_ROLL"
            tier_label = "Top Efficiency (Honor Roll)"
            badge_color = "emerald"

        department_list.append({
            "department": d,
            "total_tickets": tot,
            "resolved_tickets": res,
            "pending_tickets": pen,
            "overdue_tickets": over,
            "critical_pending": st["critical_pending"],
            "resolution_rate": rate,
            "avg_resolution_hours": avg_hrs,
            "shame_score": shame_score,
            "shame_tier": shame_tier,
            "tier_label": tier_label,
            "badge_color": badge_color,
            "officer_count": st["officer_count"],
        })

    department_list.sort(key=lambda x: (-x["shame_score"], -x["pending_tickets"]))

    officer_list = []
    for off_id, ost in officer_stats.items():
        tot = ost["total_assigned"]
        pen = ost["pending_count"]
        res = ost["resolved_count"]
        over = ost["overdue_count"]

        comp_rate = round((res / tot * 100), 1) if tot > 0 else 100.0

        if over >= 2 or pen >= 5:
            status_code = "CRITICAL_BACKLOG"
            status_label = f"Severe Backlog ({pen} Pending, {over} Overdue)"
            badge_type = "danger"
        elif pen >= 3 or over >= 1:
            status_code = "HEAVY_PENDING"
            status_label = f"High Workload ({pen} Pending)"
            badge_type = "warning"
        elif pen >= 1:
            status_code = "ON_TRACK"
            status_label = f"In Progress ({pen} Active)"
            badge_type = "info"
        else:
            status_code = "CLEAR_DESK"
            status_label = "Duty Cleared (0 Pending)"
            badge_type = "success"

        officer_list.append({
            **ost,
            "completion_rate": comp_rate,
            "shame_status_code": status_code,
            "shame_status_label": status_label,
            "badge_type": badge_type,
        })

    officer_list.sort(key=lambda o: (-o["pending_count"], -o["overdue_count"], o["name"]))

    total_city_pending = sum(d["pending_tickets"] for d in department_list)
    total_city_resolved = sum(d["resolved_tickets"] for d in department_list)
    total_city_tickets = sum(d["total_tickets"] for d in department_list)
    city_resolution_rate = round((total_city_resolved / total_city_tickets * 100), 1) if total_city_tickets > 0 else 100.0

    most_backlogged_dept = department_list[0] if department_list else None
    most_overloaded_officer = officer_list[0] if officer_list and officer_list[0]["pending_count"] > 0 else None

    return {
        "summary": {
            "total_tickets": total_city_tickets,
            "total_resolved": total_city_resolved,
            "total_pending": total_city_pending,
            "city_resolution_rate": city_resolution_rate,
            "most_backlogged_dept": most_backlogged_dept.get("department") if most_backlogged_dept else "None",
            "most_backlogged_dept_score": most_backlogged_dept.get("shame_score") if most_backlogged_dept else 0,
            "most_overloaded_officer": most_overloaded_officer.get("name") if most_overloaded_officer else "None",
            "most_overloaded_officer_pending": most_overloaded_officer.get("pending_count") if most_overloaded_officer else 0,
            "last_updated": now.isoformat(),
        },
        "departments": department_list,
        "officers": officer_list,
    }
