"""[TODO-HS-02] Weather & Asset Layer Fusion for Predictive Infrastructure.

Ingests Open-Meteo rainfall radar data and joins with GIS pipe age records
to drive predictive infrastructure replacement tenders.

Data Sources:
 - Open-Meteo API: Free, no API key required, 1km grid rainfall forecast
 - Asset layer: Stored in master_tickets metadata or a separate infrastructure_assets table
 - Fusion: High rainfall + old pipes -> high-risk zone -> proactive tender alert

Usage:
 from backend.services.weather_service import get_rainfall_forecast, compute_infrastructure_risk
"""

import logging
import math
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger("civicpulse.weather")

# Open-Meteo API - free, no key required
OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast"

# Risk thresholds
RAINFALL_ALERT_MM_PER_HOUR = 5.0
PIPE_AGE_HIGH_RISK_YEARS = 30
COMBINED_RISK_THRESHOLD = 0.70


async def get_rainfall_forecast(
    lat: float,
    lng: float,
    hours_ahead: int = 24,
) -> dict:
    """
    Fetches hourly rainfall forecast from Open-Meteo for the given coordinates.

    Args:
        lat: Latitude
        lng: Longitude
        hours_ahead: How many hours of forecast to fetch (max 168 = 7 days)

    Returns:
        dict with current_rainfall_mm, max_rainfall_mm, total_rainfall_mm, hourly_data, has_flood_risk
    """
    params = {
        "latitude": lat,
        "longitude": lng,
        "hourly": "precipitation",
        "forecast_days": min(7, math.ceil(hours_ahead / 24) + 1),
        "timezone": "Asia/Kolkata",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(OPEN_METEO_BASE, params=params)
            response.raise_for_status()
            data = response.json()

        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        precip = hourly.get("precipitation", [])

        hourly_data = [
            {"time": t, "precipitation_mm": float(p or 0)}
            for t, p in zip(times[:hours_ahead], precip[:hours_ahead])
        ]

        precipitation_values = [h["precipitation_mm"] for h in hourly_data]
        current = precipitation_values[0] if precipitation_values else 0.0
        max_mm = max(precipitation_values) if precipitation_values else 0.0
        total_mm = sum(precipitation_values)
        has_flood_risk = max_mm >= RAINFALL_ALERT_MM_PER_HOUR

        logger.info(
            "Rainfall forecast for (%.4f, %.4f): current=%.1fmm, max=%.1fmm/hr, "
            "total=%.1fmm over %dh - flood_risk=%s",
            lat, lng, current, max_mm, total_mm, hours_ahead, has_flood_risk,
        )

        return {
            "lat": lat,
            "lng": lng,
            "current_rainfall_mm": current,
            "max_rainfall_mm": max_mm,
            "total_rainfall_mm": total_mm,
            "hourly_data": hourly_data,
            "has_flood_risk": has_flood_risk,
            "alert_threshold_mm": RAINFALL_ALERT_MM_PER_HOUR,
        }

    except Exception as exc:
        logger.error("Open-Meteo API call failed for (%.4f, %.4f): %s", lat, lng, exc)
        return {
            "lat": lat,
            "lng": lng,
            "current_rainfall_mm": 0.0,
            "max_rainfall_mm": 0.0,
            "total_rainfall_mm": 0.0,
            "hourly_data": [],
            "has_flood_risk": False,
            "error": str(exc),
        }


async def get_nearby_asset_risk(
    lat: float,
    lng: float,
    radius_meters: float = 200.0,
) -> dict:
    """
    Looks up infrastructure assets (pipes, roads) near a location and
    computes an age-based risk score from master_tickets metadata.
    """
    from backend.db.supabase_client import get_supabase_client
    supabase = get_supabase_client()

    try:
        lat_deg = radius_meters / 111_320
        lng_deg = radius_meters / (111_320 * math.cos(math.radians(lat)))

        two_years_ago = (datetime.now(timezone.utc).replace(
            year=datetime.now(timezone.utc).year - 2
        )).isoformat()

        result = (
            supabase.table("master_tickets")
            .select("id, department, created_at, status")
            .gte("lat", lat - lat_deg)
            .lte("lat", lat + lat_deg)
            .gte("lng", lng - lng_deg)
            .lte("lng", lng + lng_deg)
            .in_("department", ["Water Supply & Sewerage", "Roads & Infrastructure"])
            .gte("created_at", two_years_ago)
            .execute()
        )
        tickets = result.data or []
        count = len(tickets)

        raw_score = min(1.0, count / 20.0)
        pipe_age_estimate = int(min(60, count * 3))

        if raw_score >= 0.75:
            risk_label = "CRITICAL"
        elif raw_score >= 0.50:
            risk_label = "HIGH"
        elif raw_score >= 0.25:
            risk_label = "MEDIUM"
        else:
            risk_label = "LOW"

        return {
            "lat": lat,
            "lng": lng,
            "asset_risk_score": round(raw_score, 3),
            "historical_complaint_count": count,
            "pipe_age_estimate_years": pipe_age_estimate,
            "risk_label": risk_label,
        }

    except Exception as exc:
        logger.error("Asset risk lookup failed for (%.4f, %.4f): %s", lat, lng, exc)
        return {
            "lat": lat,
            "lng": lng,
            "asset_risk_score": 0.0,
            "historical_complaint_count": 0,
            "pipe_age_estimate_years": 0,
            "risk_label": "LOW",
            "error": str(exc),
        }


async def compute_infrastructure_risk(
    lat: float,
    lng: float,
    radius_meters: float = 200.0,
    hours_ahead: int = 24,
) -> dict:
    """
    Fuses Open-Meteo rainfall forecast with infrastructure asset risk to
    compute a combined predictive infrastructure risk score.

    Score = 0.6 * asset_risk + 0.4 * rainfall_risk
    If score >= COMBINED_RISK_THRESHOLD -> trigger predictive tender alert.
    """
    import asyncio
    rainfall_task = get_rainfall_forecast(lat, lng, hours_ahead)
    asset_task = get_nearby_asset_risk(lat, lng, radius_meters)
    rainfall, asset = await asyncio.gather(rainfall_task, asset_task)

    rainfall_risk = min(1.0, rainfall["max_rainfall_mm"] / 20.0)
    asset_risk = asset["asset_risk_score"]

    combined_score = 0.6 * asset_risk + 0.4 * rainfall_risk
    should_alert = combined_score >= COMBINED_RISK_THRESHOLD

    if should_alert:
        logger.warning(
            "HIGH INFRASTRUCTURE RISK at (%.4f, %.4f): combined=%.2f "
            "(asset=%.2f, rainfall=%.2f) - TENDER ALERT recommended",
            lat, lng, combined_score, asset_risk, rainfall_risk,
        )

    return {
        "lat": lat,
        "lng": lng,
        "combined_risk_score": round(combined_score, 3),
        "asset_risk_score": asset_risk,
        "rainfall_risk_score": round(rainfall_risk, 3),
        "rainfall_max_mm_per_hr": rainfall["max_rainfall_mm"],
        "rainfall_has_flood_risk": rainfall["has_flood_risk"],
        "asset_complaint_count": asset["historical_complaint_count"],
        "pipe_age_estimate_years": asset["pipe_age_estimate_years"],
        "should_raise_tender_alert": should_alert,
        "risk_threshold": COMBINED_RISK_THRESHOLD,
    }
