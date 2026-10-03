"""[TODO-HS-01] Baseline Poisson Statistical Testing for Hotspot Abnormality.

Computes z-score Z = (N - mu) / sigma against a ward's 30-day rolling baseline
before firing administrative alarms. This prevents routine high-traffic
wards from generating false hotspot alarms.

Statistical Model:
 - Assumes complaint arrival in a ward follows a Poisson distribution
 - mu = 30-day mean complaint rate for (ward, department, sub_category)
 - sigma = sqrt(mu) for Poisson (variance = mean)
 - Z >= 2.0 -> "statistically abnormal" -> fire hotspot alarm
 - Z < 2.0 -> "within normal baseline" -> suppress alarm

Ward identification:
 - Uses a 500m geo-hash cell as a proxy for a ward (no ward boundary GIS needed)
 - Can be upgraded to true ward polygon join when GIS data is available
"""

import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Optional

from backend.db.supabase_client import get_supabase_client

logger = logging.getLogger("civicpulse.poisson")

# Tunable constants
BASELINE_DAYS = 30
ZSCORE_ALARM_THRESHOLD = 2.0
GRID_CELL_METERS = 500
EARTH_RADIUS_M = 6_371_000.0


def _lat_lng_to_grid_cell(lat: float, lng: float, cell_meters: float = GRID_CELL_METERS) -> str:
    """
    Converts lat/lng to a coarse grid-cell string (proxy for ward ID).
    Each cell is approximately cell_meters x cell_meters.
    """
    lat_step = cell_meters / EARTH_RADIUS_M * (180.0 / math.pi)
    lng_step = cell_meters / (EARTH_RADIUS_M * math.cos(math.radians(lat))) * (180.0 / math.pi)

    cell_lat = int(lat / lat_step)
    cell_lng = int(lng / lng_step)
    return f"cell_{cell_lat}_{cell_lng}"


async def compute_hotspot_zscore(
    center_lat: float,
    center_lng: float,
    department: str,
    current_count: int,
    sub_category: Optional[str] = None,
) -> dict:
    """
    Compute the Poisson z-score for a hotspot cluster against its 30-day ward baseline.

    Z = (N - mu) / sigma where sigma = sqrt(mu) [Poisson]
    """
    supabase = get_supabase_client()
    ward_cell = _lat_lng_to_grid_cell(center_lat, center_lng)

    now = datetime.now(timezone.utc)
    baseline_start = (now - timedelta(days=BASELINE_DAYS)).isoformat()

    cell_deg_lat = GRID_CELL_METERS / EARTH_RADIUS_M * (180.0 / math.pi)
    cell_deg_lng = GRID_CELL_METERS / (EARTH_RADIUS_M * math.cos(math.radians(center_lat))) * (180.0 / math.pi)

    lat_min = center_lat - cell_deg_lat
    lat_max = center_lat + cell_deg_lat
    lng_min = center_lng - cell_deg_lng
    lng_max = center_lng + cell_deg_lng

    try:
        query = (
            supabase.table("master_tickets")
            .select("id, created_at")
            .gte("lat", lat_min)
            .lte("lat", lat_max)
            .gte("lng", lng_min)
            .lte("lng", lng_max)
            .eq("department", department)
            .gte("created_at", baseline_start)
            .execute()
        )
        tickets = query.data or []

        if sub_category:
            tickets = [t for t in tickets if t.get("sub_category") == sub_category]

        daily_counts: dict[str, int] = {}
        for ticket in tickets:
            created = ticket.get("created_at", "")[:10]
            daily_counts[created] = daily_counts.get(created, 0) + 1

        for i in range(BASELINE_DAYS):
            day = (now - timedelta(days=i + 1)).strftime("%Y-%m-%d")
            if day not in daily_counts:
                daily_counts[day] = 0

        counts = list(daily_counts.values())
        baseline_mean = (sum(counts) / len(counts)) if counts else 0.0
        baseline_std = math.sqrt(baseline_mean) if baseline_mean > 0 else 1.0

        z_score = (current_count - baseline_mean) / baseline_std if baseline_std > 0 else 0.0
        is_abnormal = z_score >= ZSCORE_ALARM_THRESHOLD

        result = {
            "z_score": round(z_score, 3),
            "is_abnormal": is_abnormal,
            "alarm_triggered": is_abnormal,
            "baseline_mean": round(baseline_mean, 3),
            "baseline_std": round(baseline_std, 3),
            "current_count": current_count,
            "ward_cell": ward_cell,
            "department": department,
            "sub_category": sub_category,
            "baseline_days": BASELINE_DAYS,
            "zscore_threshold": ZSCORE_ALARM_THRESHOLD,
        }

        if is_abnormal:
            logger.warning(
                "HOTSPOT ABNORMALITY: ward_cell=%s dept=%s sub_cat=%s | "
                "Z=%.2f (count=%d vs mu=%.1f sigma=%.1f) - ALARM TRIGGERED",
                ward_cell, department, sub_category, z_score, current_count,
                baseline_mean, baseline_std,
            )
        else:
            logger.info(
                "Hotspot within normal baseline: ward_cell=%s dept=%s | "
                "Z=%.2f (count=%d vs mu=%.1f sigma=%.1f) - alarm suppressed",
                ward_cell, department, sub_category, z_score, current_count,
                baseline_mean, baseline_std,
            )

        return result

    except Exception as exc:
        logger.error("Poisson z-score computation failed: %s", exc)
        return {
            "z_score": -1.0,
            "is_abnormal": False,
            "alarm_triggered": False,
            "baseline_mean": 0.0,
            "baseline_std": 1.0,
            "current_count": current_count,
            "ward_cell": ward_cell,
            "department": department,
            "sub_category": sub_category,
            "error": str(exc),
        }


async def enrich_hotspot_with_zscore(alert_id: str) -> Optional[dict]:
    """
    Fetches a hotspot_alert, computes its Poisson z-score, and writes it back.
    Called from admin_router after detect_hotspots() creates new alerts.
    """
    supabase = get_supabase_client()
    try:
        alert_res = (
            supabase.table("hotspot_alerts")
            .select("*")
            .eq("id", alert_id)
            .single()
            .execute()
        )
        alert = alert_res.data
        if not alert:
            return None

        zscore_result = await compute_hotspot_zscore(
            center_lat=alert["center_lat"],
            center_lng=alert["center_lng"],
            department=alert.get("department") or "Roads & Infrastructure",
            current_count=alert["ticket_count"],
            sub_category=alert.get("sub_category"),
        )

        supabase.table("hotspot_alerts").update({
            "z_score": zscore_result["z_score"],
            "is_statistically_abnormal": zscore_result["is_abnormal"],
            "baseline_mean": zscore_result["baseline_mean"],
        }).eq("id", alert_id).execute()

        return zscore_result

    except Exception as exc:
        logger.error("Failed to enrich hotspot %s with z-score: %s", alert_id, exc)
        return None
