"""DBSCAN-based geospatial hotspot detection — finds clusters of related complaints."""

import json
from backend.db.supabase_client import get_supabase_client
from backend.utils.groq_client import get_groq_client
from backend.utils.prompts import HOTSPOT_ROOT_CAUSE_PROMPT
from backend.config import get_settings
from backend.models.schemas import HotspotAlert


async def detect_hotspots() -> list[HotspotAlert]:
    """
    Runs ST_ClusterDBSCAN over tickets from the last 72 hours, grouped by category.
    Creates hotspot_alerts for clusters with ≥ min_points tickets of the same category.
    
    Returns:
        List of newly created HotspotAlert objects
    """
    supabase = get_supabase_client()
    settings = get_settings()

    # Use SQL RPC to run PostGIS clustering
    result = supabase.rpc(
        "detect_hotspot_clusters",
        {
            "eps_meters": settings.hotspot_eps_meters,
            "min_pts": settings.hotspot_min_points,
            "hours_window": 72,
        },
    ).execute()

    if not result.data:
        return []

    alerts = []
    for cluster in result.data:
        # Check if a similar hotspot alert already exists nearby
        existing = supabase.rpc(
            "find_nearby_hotspots",
            {
                "search_lat": cluster["center_lat"],
                "search_lng": cluster["center_lng"],
                "radius_m": settings.hotspot_eps_meters * 2,
                "search_category": cluster["category"],
                # Pass sub_category if available so clusters with different sub_categories
                # (e.g. pothole vs. blocked_drain under Roads & Infrastructure) stay separate
                **({
                    "search_sub_category": cluster["sub_category"]
                } if cluster.get("sub_category") else {}),
            },
        ).execute()

        if existing.data and len(existing.data) > 0:
            # Update existing alert's ticket count
            supabase.table("hotspot_alerts").update(
                {
                    "ticket_count": cluster["ticket_count"],
                    "ticket_ids": cluster.get("ticket_ids", []),
                }
            ).eq("id", existing.data[0]["id"]).execute()
            continue

        # Insert new hotspot alert
        alert_data = {
            "category": cluster["category"],
            "center_lat": cluster["center_lat"],
            "center_lng": cluster["center_lng"],
            "radius_m": cluster.get("radius_m", settings.hotspot_eps_meters),
            "ticket_count": cluster["ticket_count"],
            "ticket_ids": cluster.get("ticket_ids", []),
            "status": "NEW",
        }

        # Gracefully include sub_category if the column exists
        if cluster.get("sub_category"):
            alert_data["sub_category"] = cluster["sub_category"]

        insert_result = (
            supabase.table("hotspot_alerts").insert(alert_data).execute()
        )

        if insert_result.data:
            alert = insert_result.data[0]
            alerts.append(
                HotspotAlert(
                    id=alert["id"],
                    category=alert["category"],
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

    # Fetch related ticket descriptions
    ticket_ids = alert.get("ticket_ids", [])
    descriptions = []
    if ticket_ids:
        tickets_result = (
            supabase.table("master_tickets")
            .select("description, category")
            .in_("id", ticket_ids)
            .execute()
        )
        descriptions = [
            t.get("description", "No description")
            for t in (tickets_result.data or [])
        ]

    # Call LLM for root cause analysis
    client = get_groq_client()
    prompt = HOTSPOT_ROOT_CAUSE_PROMPT.format(
        ticket_count=alert["ticket_count"],
        radius_m=alert["radius_m"],
        category=alert["category"],
        center_lat=alert["center_lat"],
        center_lng=alert["center_lng"],
        complaint_descriptions="\n".join(f"- {d}" for d in descriptions),
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
