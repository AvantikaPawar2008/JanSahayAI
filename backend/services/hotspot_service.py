"""DBSCAN-based geospatial hotspot detection — finds clusters of related complaints."""

import json
import logging
from backend.db.supabase_client import get_supabase_client
from backend.utils.groq_client import get_groq_client
from backend.utils.prompts import HOTSPOT_ROOT_CAUSE_PROMPT
from backend.config import get_settings
from backend.models.schemas import HotspotAlert

logger = logging.getLogger("civicpulse.hotspot")


def run_python_dbscan(tickets: list[dict], eps_meters: float = 100, min_pts: int = 5) -> list[dict]:
    """Pure Python / scikit-learn Haversine DBSCAN fallback for clustering."""
    import math
    from collections import Counter
    try:
        import numpy as np
        from sklearn.cluster import DBSCAN
    except ImportError:
        return []

    EARTH_RADIUS = 6371000.0
    eps_radians = eps_meters / EARTH_RADIUS

    by_dept: dict[str, list[dict]] = {}
    for t in tickets:
        dept = t.get("department") or t.get("category") or "General"
        by_dept.setdefault(dept, []).append(t)

    clusters_out = []
    for dept, dept_tickets in by_dept.items():
        if len(dept_tickets) < min_pts:
            continue

        coords = np.array([[math.radians(t["lat"]), math.radians(t["lng"])] for t in dept_tickets])
        db = DBSCAN(eps=eps_radians, min_samples=min_pts, metric="haversine").fit(coords)

        labels = db.labels_
        unique_labels = set(labels) - {-1}

        for label in unique_labels:
            cluster_members = [dept_tickets[i] for i in range(len(dept_tickets)) if labels[i] == label]
            if len(cluster_members) < min_pts:
                continue

            center_lat = float(np.mean([t["lat"] for t in cluster_members]))
            center_lng = float(np.mean([t["lng"] for t in cluster_members]))

            max_dist = eps_meters
            for m in cluster_members:
                dlat = math.radians(m["lat"] - center_lat)
                dlng = math.radians(m["lng"] - center_lng)
                a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(center_lat)) * math.cos(math.radians(m["lat"])) * math.sin(dlng / 2) ** 2
                dist_m = 2 * EARTH_RADIUS * math.asin(math.sqrt(min(1.0, a)))
                if dist_m > max_dist:
                    max_dist = dist_m

            cat_counter = Counter(t.get("category") for t in cluster_members if t.get("category"))
            sub_cat_counter = Counter(t.get("sub_category") for t in cluster_members if t.get("sub_category"))

            clusters_out.append({
                "category": cat_counter.most_common(1)[0][0] if cat_counter else "General",
                "sub_category": sub_cat_counter.most_common(1)[0][0] if sub_cat_counter else None,
                "department": dept,
                "center_lat": center_lat,
                "center_lng": center_lng,
                "radius_m": max_dist,
                "ticket_count": len(cluster_members),
                "ticket_ids": [t["id"] for t in cluster_members],
            })

    return clusters_out


async def detect_hotspots() -> list[HotspotAlert]:
    """
    Runs ST_ClusterDBSCAN (or local Haversine DBSCAN fallback) over active tickets.
    Creates hotspot_alerts for clusters with ≥ min_points tickets of the same department.
    
    Returns:
        List of newly created HotspotAlert objects
    """
    supabase = get_supabase_client()
    settings = get_settings()

    raw_clusters = []
    # Try SQL RPC to run PostGIS clustering first
    try:
        result = supabase.rpc(
            "detect_hotspot_clusters",
            {
                "eps_meters": settings.hotspot_eps_meters,
                "min_pts": settings.hotspot_min_points,
                "hours_window": 72,
            },
        ).execute()
        raw_clusters = result.data or []
    except Exception as rpc_err:
        logger.warning(f"PostGIS detect_hotspot_clusters RPC failed ({rpc_err}); engaging local Haversine DBSCAN fallback.")
        # Fallback to local Haversine DBSCAN over active master tickets
        try:
            open_tickets = (
                supabase.table("master_tickets")
                .select("id, category, sub_category, department, lat, lng, created_at, status")
                .not_.in_("status", ["RESOLVED", "CLOSED"])
                .execute()
            )
            if open_tickets.data:
                raw_clusters = run_python_dbscan(
                    open_tickets.data,
                    eps_meters=settings.hotspot_eps_meters,
                    min_pts=settings.hotspot_min_points,
                )
        except Exception as fb_err:
            logger.error(f"Local DBSCAN fallback also failed: {fb_err}")
            return []

    if not raw_clusters:
        return []

    alerts = []
    for cluster in raw_clusters:
        # Check if a similar hotspot alert already exists nearby
        existing_alert_id = None
        dept = cluster.get("department")
        sub_cat = cluster.get("sub_category")

        # Exact match check with department and sub_category
        if dept and sub_cat:
            try:
                existing = supabase.rpc(
                    "find_nearby_hotspots",
                    {
                        "search_lat": cluster["center_lat"],
                        "search_lng": cluster["center_lng"],
                        "radius_m": settings.hotspot_eps_meters * 2,
                        "search_department": dept,
                        "search_sub_category": sub_cat,
                    },
                ).execute()
                if existing.data and len(existing.data) > 0:
                    existing_alert_id = existing.data[0]["id"]
            except Exception as rpc_err:
                logger.warning(f"find_nearby_hotspots RPC check failed: {rpc_err}")

        if existing_alert_id:
            # Merge ticket IDs rather than overwriting
            existing_alert = (
                supabase.table("hotspot_alerts")
                .select("ticket_ids")
                .eq("id", existing_alert_id)
                .single()
                .execute()
            )
            curr_ids = (existing_alert.data or {}).get("ticket_ids") or []
            merged_ids = list(dict.fromkeys(curr_ids + cluster.get("ticket_ids", [])))

            supabase.table("hotspot_alerts").update(
                {
                    "ticket_count": max(len(merged_ids), int(cluster["ticket_count"])),
                    "ticket_ids": merged_ids,
                }
            ).eq("id", existing_alert_id).execute()
            continue

        # Insert new hotspot alert with department and sub_category
        alert_data = {
            "category": cluster["category"],
            "center_lat": cluster["center_lat"],
            "center_lng": cluster["center_lng"],
            "radius_m": cluster.get("radius_m", settings.hotspot_eps_meters),
            "ticket_count": cluster["ticket_count"],
            "ticket_ids": cluster.get("ticket_ids", []),
            "status": "NEW",
            "department": dept,
            "sub_category": sub_cat,
        }

        try:
            insert_result = (
                supabase.table("hotspot_alerts").insert(alert_data).execute()
            )
        except Exception as ins_err:
            # Graceful fallback if migration 007 columns not yet applied
            if "department" in str(ins_err) or "sub_category" in str(ins_err):
                fallback_data = {k: v for k, v in alert_data.items() if k not in ("department", "sub_category")}
                if sub_cat:
                    fallback_data["sub_category"] = sub_cat
                insert_result = supabase.table("hotspot_alerts").insert(fallback_data).execute()
            else:
                raise ins_err

        if insert_result.data:
            alert = insert_result.data[0]
            alerts.append(
                HotspotAlert(
                    id=alert["id"],
                    category=alert["category"],
                    sub_category=alert.get("sub_category"),
                    department=alert.get("department"),
                    center_lat=alert["center_lat"],
                    center_lng=alert["center_lng"],
                    radius_m=alert["radius_m"],
                    ticket_count=alert["ticket_count"],
                    ticket_ids=alert.get("ticket_ids", []),
                    status=alert["status"],
                    created_at=alert.get("created_at"),
                )
            )

    return alerts


async def analyze_hotspot_root_cause(alert_id: str) -> str:
    """
    Uses LLM to analyze the root cause of a hotspot cluster.
    Guarded against PostgREST URL length limits and LLM context overflows.
    
    Args:
        alert_id: ID of the hotspot alert to analyze
    
    Returns:
        Root cause analysis text
    """
    supabase = get_supabase_client()
    settings = get_settings()

    # Fetch the alert
    alert_result = (
        supabase.table("hotspot_alerts")
        .select("*")
        .eq("id", alert_id)
        .single()
        .execute()
    )
    alert = alert_result.data
    if not alert:
        return json.dumps({"error": "Hotspot alert not found"})

    # Fetch related ticket descriptions — cap at 20 tickets to avoid HTTP 414 URL overflow
    all_ticket_ids = alert.get("ticket_ids", [])
    sample_ids = all_ticket_ids[:20] if all_ticket_ids else []

    descriptions = []
    if sample_ids:
        tickets_result = (
            supabase.table("master_tickets")
            .select("description, category")
            .in_("id", sample_ids)
            .execute()
        )
        # Sanitize descriptions to prevent prompt injection and token overflow
        for t in (tickets_result.data or []):
            raw_desc = t.get("description") or "No description"
            sanitized = (
                raw_desc.replace("</citizen_complaints>", "")
                .replace("<citizen_complaints>", "")
                .strip()
            )
            descriptions.append(sanitized[:250])

    # Call LLM for root cause analysis
    client = get_groq_client()
    formatted_descriptions = (
        "\n".join(f"- {d}" for d in descriptions) if descriptions else "- None provided"
    )
    prompt = HOTSPOT_ROOT_CAUSE_PROMPT.format(
        ticket_count=alert.get("ticket_count", len(all_ticket_ids)),
        radius_m=round(alert.get("radius_m", settings.hotspot_eps_meters), 1),
        category=alert.get("category", "General"),
        center_lat=round(alert.get("center_lat", 0.0), 5),
        center_lng=round(alert.get("center_lng", 0.0), 5),
        complaint_descriptions=formatted_descriptions,
    )

    response = client.chat.completions.create(
        model=settings.groq_text_model,
        messages=[
            {
                "role": "system",
                "content": "You are an urban infrastructure analyst. Respond ONLY with valid JSON.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        max_tokens=1024,
        response_format={"type": "json_object"},
    )

    raw = response.choices[0].message.content
    try:
        analysis = json.loads(raw)
        analysis_text = json.dumps(analysis, indent=2)
    except json.JSONDecodeError:
        analysis_text = raw

    # Update alert with root cause analysis
    supabase.table("hotspot_alerts").update(
        {"root_cause_analysis": analysis_text, "status": "INVESTIGATING"}
    ).eq("id", alert_id).execute()

    return analysis_text
