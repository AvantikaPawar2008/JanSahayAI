"""Spatial + semantic deduplication — finds if a new complaint matches an existing master ticket.

Two-stage filter:
  Stage 1 — spatial: only candidates within DEDUP_RADIUS_METERS (PostGIS ST_DWithin)
  Stage 2 — hard filter: same department AND same sub_category (if available)
  Stage 3 — semantic: cosine similarity >= DEDUP_SIMILARITY_THRESHOLD

Department/sub_category match is a hard filter evaluated BEFORE similarity — this prevents two
unrelated issues near each other (e.g. pothole vs. water leak on the same street) from ever
merging into one master ticket.
"""

from backend.db.supabase_client import get_supabase_client
from backend.services.embedding_service import compute_cosine_similarity
from backend.config import get_settings
from typing import Optional

# ============================================================
# DEDUP TUNING CONSTANTS — adjust these live during testing
# ============================================================
DEDUP_RADIUS_METERS = 100          # spatial search radius (meters)
DEDUP_SIMILARITY_THRESHOLD = 0.80  # minimum cosine similarity for a text match

# Image similarity blending weights (used when both tickets have image embeddings)
DEDUP_W_TEXT = 0.4
DEDUP_W_IMAGE = 0.6


async def find_duplicate(
    lat: float,
    lng: float,
    text_embedding: list[float],
    department: Optional[str] = None,
    sub_category: Optional[str] = None,
    image_embedding: Optional[list[float]] = None,
    radius_meters: float = DEDUP_RADIUS_METERS,
) -> dict | None:
    """
    Checks for duplicate master tickets near the given location with the same
    department, sub_category, and similar text.

    Two-stage pipeline:
      Stage 1 — spatial: PostGIS ST_DWithin within radius_meters
      Stage 2 — hard filter: department must match; sub_category must match if both sides have it
      Stage 3 — semantic similarity >= DEDUP_SIMILARITY_THRESHOLD
                 (blends image similarity if image_embedding is provided)

    Args:
        lat: Latitude of new complaint
        lng: Longitude of new complaint
        text_embedding: 384-dim embedding of the new complaint text
        department: Classified department (from triage) — used as hard filter
        sub_category: Specific defect sub-type (from triage) — used as hard filter when present
        image_embedding: Optional image embedding (for blended similarity scoring)
        radius_meters: Spatial search radius (default DEDUP_RADIUS_METERS)

    Returns:
        dict with master_ticket data if duplicate found, None otherwise
    """
    settings = get_settings()
    supabase = get_supabase_client()

    # Linear infrastructure sub-categories that can span longer distances
    LINEAR_SUBCATEGORIES = {
        "water_leak",
        "no_water_supply",
        "sewage_overflow",
        "blocked_drain",
        "road_damage",
        "road_collapse",
        "pothole",
        "power_line_down",
    }

    # ------------------------------------------------------------------
    # Stage 1 — Spatial: find nearby master tickets via PostGIS
    # ------------------------------------------------------------------
    rpc_params = {
        "search_lat": lat,
        "search_lng": lng,
        "radius_m": radius_meters,
        "search_department": department,
        "search_sub_category": sub_category,
    }
    nearby_query = supabase.rpc("find_nearby_tickets", rpc_params).execute()

    candidates = nearby_query.data or []

    # Dynamic spatial expansion: if no candidates in 100m, allow linear defects to search up to 200m
    if not candidates and sub_category in LINEAR_SUBCATEGORIES and radius_meters <= DEDUP_RADIUS_METERS:
        expanded_params = {
            "search_lat": lat,
            "search_lng": lng,
            "radius_m": radius_meters * 2.0,  # 200m
            "search_department": department,
            "search_sub_category": sub_category,
        }
        expanded_query = supabase.rpc("find_nearby_tickets", expanded_params).execute()
        candidates = expanded_query.data or []

    if not candidates:
        return None

    # ------------------------------------------------------------------
    # Stage 2 — Hard filter: department AND sub_category must match
    # ------------------------------------------------------------------
    if department:
        candidates = [c for c in candidates if c.get("department") == department]

    if not candidates:
        # Spatially close but different department — genuinely different problem
        return None

    if sub_category:
        # Sub-category hard filter: Only candidates with the identical sub_category
        # or legacy candidates lacking a sub_category are eligible.
        # Candidates with an explicitly different sub_category are strictly rejected.
        candidates = [
            c for c in candidates
            if not c.get("sub_category") or c.get("sub_category") == sub_category
        ]

    if not candidates:
        return None

    # ------------------------------------------------------------------
    # Stage 3 — Semantic similarity: compare against canonical or all linked reports
    # ------------------------------------------------------------------
    candidate_ids = [ticket["id"] for ticket in candidates]

    # Batch fetch all candidate reports to compare against all descriptions (eliminates recency bias)
    reports_result = (
        supabase.table("ticket_reports")
        .select("master_ticket_id, text_embedding, created_at")
        .in_("master_ticket_id", candidate_ids)
        .not_.is_("text_embedding", "null")
        .order("created_at", desc=False)
        .execute()
    )

    candidate_embeddings_map: dict[str, list[list[float]]] = {cid: [] for cid in candidate_ids}

    # Also check if master_tickets table already has canonical text_embedding
    try:
        mt_res = (
            supabase.table("master_tickets")
            .select("id, text_embedding")
            .in_("id", candidate_ids)
            .not_.is_("text_embedding", "null")
            .execute()
        )
        for row in (mt_res.data or []):
            m_id = row.get("id")
            emb = row.get("text_embedding")
            if m_id and emb:
                if isinstance(emb, str):
                    import json
                    try:
                        emb = json.loads(emb)
                    except Exception:
                        emb = None
                if emb:
                    candidate_embeddings_map[m_id].append(emb)
    except Exception:
        pass

    for rep in (reports_result.data or []):
        m_id = rep.get("master_ticket_id")
        if m_id and rep.get("text_embedding"):
            emb = rep["text_embedding"]
            if isinstance(emb, str):
                import json
                try:
                    emb = json.loads(emb)
                except Exception:
                    continue
            candidate_embeddings_map.setdefault(m_id, []).append(emb)

    best_match = None
    best_similarity = 0.0

    for ticket in candidates:
        ticket_id = ticket["id"]
        stored_embeddings_list = candidate_embeddings_map.get(ticket_id, [])
        if not stored_embeddings_list:
            continue

        # Evaluate similarity against all available embeddings for this ticket (take highest similarity)
        max_ticket_similarity = 0.0
        for stored_emb in stored_embeddings_list:
            sim = compute_cosine_similarity(text_embedding, stored_emb)
            if sim > max_ticket_similarity:
                max_ticket_similarity = sim

        final_similarity = max_ticket_similarity

        threshold = settings.dedup_similarity_threshold
        if final_similarity >= threshold and final_similarity > best_similarity:
            best_similarity = final_similarity
            best_match = ticket
            best_match["similarity_score"] = final_similarity

    return best_match


async def get_ticket_upvote_count(master_ticket_id: str) -> int:
    """
    Returns the upvote count on a master ticket.
    With Migration 007, upvote_count is maintained automatically by the
    sync_ticket_upvote_count database trigger on ticket_reports.
    """
    supabase = get_supabase_client()
    try:
        result = (
            supabase.table("master_tickets")
            .select("upvote_count")
            .eq("id", master_ticket_id)
            .single()
            .execute()
        )
        if result.data and result.data.get("upvote_count") is not None:
            return int(result.data["upvote_count"])
    except Exception as e:
        logger.warning(f"Could not fetch upvote_count for ticket {master_ticket_id}: {e}")

    return 1


# Backward-compatible alias
async def increment_upvote(master_ticket_id: str) -> int:
    """Deprecated: Upvote count is now automatically maintained by database trigger on ticket_reports."""
    return await get_ticket_upvote_count(master_ticket_id)

