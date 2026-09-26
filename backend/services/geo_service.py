"""Haversine distance calculations and GPS geofence validation for field verification."""

import math
from typing import Optional, Tuple, Dict
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
import asyncio
import re
import json
import logging
from typing import Optional, Tuple

logger = logging.getLogger("civicpulse.geo")

_last_call_time = 0.0
_geocode_cache: dict = {}  # Simple in-memory cache: (lat, lng) -> address string
_forward_geocode_cache: dict = {}  # query string -> (lat, lng, display_name)


async def reverse_geocode(lat: float, lng: float) -> str:
    """
    Converts lat/lng into a human-readable address string using OpenStreetMap Nominatim.
    Respects Nominatim's 1 req/sec usage policy using asyncio.sleep (non-blocking).
    Caches results to skip redundant Nominatim calls for same coordinates.
    Returns a fallback 'lat, lng' string if lookup fails or times out.
    """
    global _last_call_time

    # Round to 4 decimal places (~11m precision) for cache key
    cache_key = (round(lat, 4), round(lng, 4))
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]

    # Respect Nominatim's 1 req/sec usage policy — use asyncio.sleep (non-blocking)
    elapsed = time.time() - _last_call_time
    if elapsed < 1:
        await asyncio.sleep(1 - elapsed)

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lng, "format": "json"},
                headers={"User-Agent": "CivicPulse-Pune/1.0"}
            )
            _last_call_time = time.time()
            data = response.json()
            address = data.get("display_name", f"{lat:.5f}, {lng:.5f}")
            _geocode_cache[cache_key] = address
            return address
    except Exception:
        return f"{lat:.5f}, {lng:.5f}"  # graceful fallback, never block ticket creation on this


async def geocode_landmark(query: str, default_city: str = "Pune") -> Optional[Tuple[float, float, str]]:
    """
    Geocodes a landmark, street, or area name to (lat, lng, display_name) using OpenStreetMap Nominatim.
    Automatically qualifies with city context if not already present.
    """
    global _last_call_time
    clean_query = (query or "").strip()
    if not clean_query:
        return None

    # Append city hint if not already present in query
    search_term = clean_query
    if default_city and default_city.lower() not in clean_query.lower():
        search_term = f"{clean_query}, {default_city}"

    cache_key = search_term.lower()
    if cache_key in _forward_geocode_cache:
        return _forward_geocode_cache[cache_key]

    elapsed = time.time() - _last_call_time
    if elapsed < 1:
        await asyncio.sleep(1 - elapsed)

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": search_term, "format": "json", "limit": 1},
                headers={"User-Agent": "CivicPulse-Pune/1.0"}
            )
            _last_call_time = time.time()
            results = response.json()
            if results and len(results) > 0:
                res_lat = float(results[0]["lat"])
                res_lng = float(results[0]["lon"])
                disp_name = results[0].get("display_name", clean_query)
                _forward_geocode_cache[cache_key] = (res_lat, res_lng, disp_name)
                logger.info(f"Geocoded landmark '{clean_query}' -> ({res_lat:.5f}, {res_lng:.5f}): {disp_name}")
                return (res_lat, res_lng, disp_name)
    except Exception as e:
        logger.warning(f"Nominatim geocoding failed for '{search_term}': {e}")

    return None


_landmark_extraction_cache: Dict[str, Optional[str]] = {}


async def extract_problem_landmark_from_text(text: str) -> Optional[str]:
    """
    Extracts the physical landmark, station, road, intersection, or area mentioned in the complaint text.
    Uses fast regex matching first, then Groq LLM extraction for natural phrasing.
    Cached in-memory to prevent repeated LLM calls on similar reports.
    """
    if not text or len(text.strip()) < 5:
        return None

    clean_text = text.strip()
    if clean_text in _landmark_extraction_cache:
        return _landmark_extraction_cache[clean_text]

    # 1. Fast regex pattern for common Indian landmark phrasing
    regex_pattern = re.compile(
        r"\b(?:near|at|in front of|opposite|behind|beside|across|along|on)\s+([A-Za-z0-9\s\.\'-]+?(?:railway station|bus station|bus stop|metro station|station|stop|road|street|chowk|nagar|colony|bridge|flyover|hospital|school|college|gate|market|garden|park|depot|office|stand|temple|circle|bapat road|fc road|jm road|mg road))\b",
        re.IGNORECASE,
    )
    match = regex_pattern.search(clean_text)
    if match:
        extracted = match.group(1).strip()
        # Clean leading prepositions/articles if captured
        extracted = re.sub(r"^(?:the|a|an|front of|near|at|of)\s+", "", extracted, flags=re.IGNORECASE).strip()
        if len(extracted) >= 4:
            _landmark_extraction_cache[clean_text] = extracted
            return extracted

    # 2. LLM-based landmark extraction via Groq
    try:
        from backend.utils.groq_client import get_groq_client
        client = get_groq_client()
        resp = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract the physical landmark, street, area, station, or intersection "
                        "mentioned in a civic complaint where the issue physically is located. "
                        "Return JSON with key 'location_name' (string or null). "
                        "Do not include problem words like pothole, garbage, or leak."
                    ),
                },
                {"role": "user", "content": clean_text},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=100,
        )
        data = json.loads(resp.choices[0].message.content)
        loc = data.get("location_name")
        if loc and isinstance(loc, str) and len(loc.strip()) >= 3:
            extracted_loc = loc.strip()
            _landmark_extraction_cache[clean_text] = extracted_loc
            return extracted_loc
    except Exception as e:
        logger.debug(f"LLM landmark extraction fallback skipped: {e}")

    _landmark_extraction_cache[clean_text] = None
    return None


async def resolve_incident_location(
    complaint_text: str,
    client_lat: float,
    client_lng: float,
    location_source: str = "gps",
    explicit_problem_lat: Optional[float] = None,
    explicit_problem_lng: Optional[float] = None,
    explicit_landmark: Optional[str] = None,
) -> dict:
    """
    Determines the REAL EXACT location of the problem, distinguishing the citizen's
    device logging location from the actual scene of the civic issue.

    Returns dict:
      {
        "real_lat": float,
        "real_lng": float,
        "location_source": str,
        "landmark_name": Optional[str],
        "resolved_address": Optional[str],
        "is_remote_report": bool
      }
    """
    # Case 1: Citizen explicitly pinned the problem on the map or entered an address manually
    if explicit_problem_lat and explicit_problem_lng and (explicit_problem_lat != 0 or explicit_problem_lng != 0):
        # Check if citizen's pin differs significantly (> 150m) from their current phone GPS
        dist = haversine_distance(client_lat, client_lng, explicit_problem_lat, explicit_problem_lng)
        is_remote = dist > 150.0
        return {
            "real_lat": explicit_problem_lat,
            "real_lng": explicit_problem_lng,
            "location_source": "manual",
            "landmark_name": explicit_landmark,
            "resolved_address": None,
            "is_remote_report": is_remote,
        }

    # Case 2: Citizen explicitly entered a landmark name
    if explicit_landmark:
        geocoded = await geocode_landmark(explicit_landmark)
        if geocoded:
            g_lat, g_lng, disp = geocoded
            dist = haversine_distance(client_lat, client_lng, g_lat, g_lng)
            return {
                "real_lat": g_lat,
                "real_lng": g_lng,
                "location_source": "text_geocoded",
                "landmark_name": explicit_landmark,
                "resolved_address": disp,
                "is_remote_report": dist > 150.0,
            }

    # Case 3: Extract landmark mentioned inside complaint text (e.g. "near akurdi railway station")
    extracted_landmark = await extract_problem_landmark_from_text(complaint_text)
    if extracted_landmark:
        geocoded = await geocode_landmark(extracted_landmark)
        if geocoded:
            g_lat, g_lng, disp = geocoded
            dist = haversine_distance(client_lat, client_lng, g_lat, g_lng)
            is_remote = dist > 150.0
            logger.info(
                f"Resolved real problem location from text landmark '{extracted_landmark}': "
                f"({g_lat:.5f}, {g_lng:.5f}) - Distance from device logging position: {dist:.1f}m"
            )
            return {
                "real_lat": g_lat,
                "real_lng": g_lng,
                "location_source": "text_geocoded",
                "landmark_name": extracted_landmark,
                "resolved_address": disp,
                "is_remote_report": is_remote,
            }

    # Case 4: Default to provided client coordinates (at the scene)
    return {
        "real_lat": client_lat,
        "real_lng": client_lng,
        "location_source": location_source or "gps",
        "landmark_name": None,
        "resolved_address": None,
        "is_remote_report": False,
    }



