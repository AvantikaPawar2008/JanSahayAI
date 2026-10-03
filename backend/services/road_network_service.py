"""[TODO-DD-03] Topological Road-Network-Aware Deduplication.

Snaps GPS coordinates to OpenStreetMap road centerlines (via OSRM)
to prevent false merges across physical barriers like railway tracks,
flyover walls, and rivers.

Problem solved:
 Two potholes at coordinates separated by only 15m but on opposite sides
 of a railway track should NOT be merged. Standard radius-based dedup would
 merge them, but road-network-aware dedup uses road distance instead of
 straight-line (Euclidean) distance.

Architecture:
 1. Primary: OSRM (Open Source Routing Machine) Snap API for coordinate snapping
 - Uses public OSRM demo server (no key required)
 - Or self-hosted OSRM for production reliability
 2. Fallback: Raw Haversine distance (existing behavior) if OSRM is unavailable

Usage:
 from backend.services.road_network_service import snap_to_road, road_network_distance

Integration:
 Called from dedup_service.find_duplicate() BEFORE Haversine comparison.
 If road-snapped distance > ROAD_NETWORK_DEDUP_THRESHOLD, skip the candidate
 even if straight-line Haversine distance is within radius.
"""

import logging
import math
from typing import Optional

import httpx

logger = logging.getLogger("civicpulse.road_network")

# OSRM public demo server (replace with self-hosted for production)
OSRM_BASE_URL = "http://router.project-osrm.org"

# Distance threshold: if road distance > this, treat as different location
ROAD_NETWORK_DEDUP_THRESHOLD_METERS = 200

# Timeout for OSRM API calls
OSRM_TIMEOUT_SECONDS = 3.0


async def snap_to_road(lat: float, lng: float) -> dict:
    """
    Snap a GPS coordinate to the nearest OSM road centerline using OSRM.

    Args:
        lat: Latitude to snap
        lng: Longitude to snap

    Returns:
        dict with snapped_lat, snapped_lng, snap_distance_m, road_name, osrm_available
    """
    try:
        url = f"{OSRM_BASE_URL}/nearest/v1/driving/{lng},{lat}"
        params = {"number": 1}

        async with httpx.AsyncClient(timeout=OSRM_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

        if data.get("code") != "Ok" or not data.get("waypoints"):
            logger.warning("OSRM snap returned no waypoints for (%.5f, %.5f)", lat, lng)
            return {
                "snapped_lat": lat,
                "snapped_lng": lng,
                "snap_distance_m": 0.0,
                "road_name": None,
                "osrm_available": False,
            }

        waypoint = data["waypoints"][0]
        location = waypoint.get("location", [lng, lat])
        snapped_lng, snapped_lat = location[0], location[1]
        snap_dist = waypoint.get("distance", 0.0)
        road_name = waypoint.get("name") or None

        return {
            "snapped_lat": snapped_lat,
            "snapped_lng": snapped_lng,
            "snap_distance_m": round(snap_dist, 2),
            "road_name": road_name,
            "osrm_available": True,
        }

    except Exception as exc:
        logger.debug("OSRM snap failed for (%.5f, %.5f): %s - using original coords", lat, lng, exc)
        return {
            "snapped_lat": lat,
            "snapped_lng": lng,
            "snap_distance_m": 0.0,
            "road_name": None,
            "osrm_available": False,
        }


async def road_network_distance(
    lat1: float, lng1: float,
    lat2: float, lng2: float,
) -> dict:
    """
    Computes the road network distance between two coordinates using OSRM routing.

    Falls back to Haversine distance if OSRM is unavailable.
    """
    haversine_m = _haversine(lat1, lng1, lat2, lng2)

    try:
        url = f"{OSRM_BASE_URL}/route/v1/driving/{lng1},{lat1};{lng2},{lat2}"
        params = {"overview": "false", "annotations": "false"}

        async with httpx.AsyncClient(timeout=OSRM_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

        if data.get("code") != "Ok" or not data.get("routes"):
            raise ValueError(f"OSRM routing returned code: {data.get('code')}")

        route = data["routes"][0]
        road_distance_m = route.get("distance", haversine_m)
        ratio = road_distance_m / haversine_m if haversine_m > 0 else 1.0

        import asyncio
        snap1, snap2 = await asyncio.gather(
            snap_to_road(lat1, lng1),
            snap_to_road(lat2, lng2),
        )
        is_same_road = bool(
            snap1["road_name"]
            and snap2["road_name"]
            and snap1["road_name"].lower() == snap2["road_name"].lower()
        )

        exceeds = road_distance_m > ROAD_NETWORK_DEDUP_THRESHOLD_METERS

        if exceeds:
            logger.info(
                "Road-network dedup BARRIER detected: road_dist=%.0fm vs haversine=%.0fm "
                "(ratio=%.2f) between (%.5f,%.5f) and (%.5f,%.5f) - BLOCKING merge",
                road_distance_m, haversine_m, ratio, lat1, lng1, lat2, lng2,
            )

        return {
            "road_distance_m": round(road_distance_m, 1),
            "haversine_distance_m": round(haversine_m, 1),
            "road_to_haversine_ratio": round(ratio, 3),
            "is_same_road_segment": is_same_road,
            "osrm_available": True,
            "exceeds_threshold": exceeds,
            "threshold_m": ROAD_NETWORK_DEDUP_THRESHOLD_METERS,
        }

    except Exception as exc:
        logger.debug("OSRM routing failed - falling back to Haversine: %s", exc)
        exceeds = haversine_m > ROAD_NETWORK_DEDUP_THRESHOLD_METERS
        return {
            "road_distance_m": haversine_m,
            "haversine_distance_m": round(haversine_m, 1),
            "road_to_haversine_ratio": 1.0,
            "is_same_road_segment": False,
            "osrm_available": False,
            "exceeds_threshold": exceeds,
            "threshold_m": ROAD_NETWORK_DEDUP_THRESHOLD_METERS,
        }


async def check_road_barrier(
    new_lat: float, new_lng: float,
    candidate_lat: float, candidate_lng: float,
    haversine_distance_m: float,
) -> bool:
    """
    Quick check: does a physical road barrier separate two nearby complaints?

    Returns True (barrier detected) if:
    - Road distance significantly exceeds Haversine distance (ratio > 1.8)
    - OR road distance > ROAD_NETWORK_DEDUP_THRESHOLD_METERS
    """
    if haversine_distance_m < 30:
        return False

    try:
        result = await road_network_distance(
            new_lat, new_lng,
            candidate_lat, candidate_lng,
        )

        high_ratio = result["road_to_haversine_ratio"] > 1.8
        exceeds_threshold = result["exceeds_threshold"]
        barrier = high_ratio or exceeds_threshold

        if barrier:
            logger.info(
                "Barrier check: road=%.0fm haversine=%.0fm ratio=%.2f high_ratio=%s exceeds=%s -> BARRIER=%s",
                result["road_distance_m"], haversine_distance_m,
                result["road_to_haversine_ratio"], high_ratio, exceeds_threshold, barrier,
            )

        return barrier

    except Exception as exc:
        logger.debug("Road barrier check failed: %s - assuming no barrier (safe default)", exc)
        return False


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Compute Haversine distance in meters between two coordinates."""
    R = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))
