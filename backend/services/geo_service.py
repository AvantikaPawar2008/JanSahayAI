"""Haversine distance calculations and GPS geofence validation for field verification."""

import math
from backend.config import get_settings


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Calculates the great-circle distance between two GPS points in meters.
    
    Args:
        lat1, lng1: First point coordinates (degrees)
        lat2, lng2: Second point coordinates (degrees)
    
    Returns:
        Distance in meters
    """
    R = 6371000  # Earth's radius in meters

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


def is_within_geofence(
    photo_lat: float,
    photo_lng: float,
    ticket_lat: float,
    ticket_lng: float,
    radius_meters: float | None = None,
) -> tuple[bool, float]:
    """
    Checks if a photo's GPS is within the allowed radius of the ticket location.
    
    Args:
        photo_lat, photo_lng: GPS of the submitted photo
        ticket_lat, ticket_lng: GPS of the ticket location
        radius_meters: Override geofence radius (default from config)
    
    Returns:
        Tuple of (is_within, distance_meters)
    """
    if radius_meters is None:
        settings = get_settings()
        radius_meters = settings.geofence_radius_meters

    distance = haversine_distance(photo_lat, photo_lng, ticket_lat, ticket_lng)
    return (distance <= radius_meters, round(distance, 2))


def calculate_priority_score(
    sla_elapsed_hours: float,
    urgency: str,
    duplicate_count: int,
) -> float:
    """
    Computes an officer queue priority score.
    Formula: (sla_elapsed_hours * 0.4) + (urgency_weight * 0.4) + (duplicate_count * 0.2)
    
    Higher score = higher priority (should be worked on first).
    
    Args:
        sla_elapsed_hours: Hours since ticket was created
        urgency: One of LOW, MEDIUM, HIGH, CRITICAL
        duplicate_count: Number of duplicate reports (upvote_count)
    
    Returns:
        Priority score (float, higher = more urgent)
    """
    urgency_weights = {
        "LOW": 1.0,
        "MEDIUM": 3.0,
        "HIGH": 7.0,
        "CRITICAL": 10.0,
    }
    urgency_weight = urgency_weights.get(urgency, 3.0)

    # Normalize sla_elapsed_hours (cap at 168 hours = 1 week for scoring)
    normalized_sla = min(sla_elapsed_hours, 168) / 168 * 10

    # Normalize duplicate count (cap at 50 for scoring)
    normalized_dupes = min(duplicate_count, 50) / 50 * 10

    score = (normalized_sla * 0.4) + (urgency_weight * 0.4) + (normalized_dupes * 0.2)
    return round(score, 3)


import httpx
import time

_last_call_time = 0.0


async def reverse_geocode(lat: float, lng: float) -> str:
    """
    Converts lat/lng into a human-readable address string using OpenStreetMap Nominatim.
    Respects Nominatim's 1 req/sec usage policy.
    Returns a fallback 'lat, lng' string if lookup fails or times out.
    """
    global _last_call_time
    # Respect Nominatim's 1 req/sec usage policy
    elapsed = time.time() - _last_call_time
    if elapsed < 1:
        time.sleep(1 - elapsed)

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lng, "format": "json"},
                headers={"User-Agent": "JanSahayAI-Hackathon/1.0"}  # required by Nominatim's usage policy
            )
            _last_call_time = time.time()
            data = response.json()
            return data.get("display_name", f"{lat:.5f}, {lng:.5f}")
    except Exception:
        return f"{lat:.5f}, {lng:.5f}"  # graceful fallback, never block ticket creation on this

