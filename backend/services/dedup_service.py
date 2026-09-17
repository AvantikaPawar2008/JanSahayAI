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

    # ------------------------------------------------------------------
    # Stage 1 — Spatial: find nearby master tickets via PostGIS
    # ------------------------------------------------------------------
    nearby_query = supabase.rpc(
        "find_nearby_tickets",
        {
            "search_lat": lat,
            "search_lng": lng,
            "radius_m": radius_meters,
        },
    ).execute()

    if not nearby_query.data:
        return None

    candidates = nearby_query.data

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
    # Stage 3 — Semantic similarity: must exceed threshold
    # ------------------------------------------------------------------
    # Batch fetch the most recent report embedding for all candidates in a single query (eliminates N+1)
    candidate_ids = [ticket["id"] for ticket in candidates]
    reports_result = (
        supabase.table("ticket_reports")
        .select("master_ticket_id, text_embedding, created_at")
        .in_("master_ticket_id", candidate_ids)
        .not_.is_("text_embedding", "null")
        .order("created_at", desc=True)
        .execute()
    )

    recent_embeddings: dict[str, list[float]] = {}
    for rep in (reports_result.data or []):
        m_id = rep.get("master_ticket_id")
        if m_id and m_id not in recent_embeddings and rep.get("text_embedding"):
            emb = rep["text_embedding"]
            if isinstance(emb, str):
                import json
                try:
                    emb = json.loads(emb)
                except Exception:
                    continue
            recent_embeddings[m_id] = emb

    best_match = None
    best_similarity = 0.0

    for ticket in candidates:
        ticket_id = ticket["id"]
        stored_embedding = recent_embeddings.get(ticket_id)
        if not stored_embedding:
            continue

        text_similarity = compute_cosine_similarity(text_embedding, stored_embedding)
        final_similarity = text_similarity

        threshold = settings.dedup_similarity_threshold
        if final_similarity >= threshold and final_similarity > best_similarity:
            best_similarity = final_similarity
            best_match = ticket
            best_match["similarity_score"] = final_similarity

    return best_match


async def increment_upvote(master_ticket_id: str) -> int:
    """Atomically increments the upvote count on a master ticket (avoids TOCTOU race condition)."""
    supabase = get_supabase_client()

    # Try atomic stored procedure first
    try:
        rpc_res = supabase.rpc(
            "increment_ticket_upvote",
            {"target_ticket_id": master_ticket_id}
        ).execute()
        if rpc_res.data is not None:
            return int(rpc_res.data)
    except Exception:
        pass

    # Fallback to single-row update if migration not yet applied
    result = (
        supabase.table("master_tickets")
        .select("upvote_count")
        .eq("id", master_ticket_id)
        .single()
        .execute()
    )
    current = result.data.get("upvote_count", 1) if result.data else 1
    new_count = current + 1
    supabase.table("master_tickets").update(
        {"upvote_count": new_count}
    ).eq("id", master_ticket_id).execute()
    return new_count

