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
        # Sub-category filter: only apply if the stored ticket also has a sub_category
        # (avoids rejecting legacy tickets that predate this field)
        sub_filtered = [
            c for c in candidates
            if not c.get("sub_category") or c.get("sub_category") == sub_category
        ]
        # Fall back to department-only filter if sub_category wipes out all candidates
        # (e.g. first ever ticket of this sub_category in the area)
        if sub_filtered:
            candidates = sub_filtered

    if not candidates:
        return None

    # ------------------------------------------------------------------
    # Stage 3 — Semantic similarity: must exceed threshold
    # ------------------------------------------------------------------
    best_match = None
    best_similarity = 0.0

    for ticket in candidates:
        ticket_id = ticket["id"]

        # Get the most recent report embedding for this master ticket
        report_result = (
            supabase.table("ticket_reports")
            .select("text_embedding, image_url")
            .eq("master_ticket_id", ticket_id)
            .not_.is_("text_embedding", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if not report_result.data or not report_result.data[0].get("text_embedding"):
            continue

        stored_embedding = report_result.data[0]["text_embedding"]
        # Handle case where embedding is stored as string (Supabase JSON round-trip)
        if isinstance(stored_embedding, str):
            import json
            stored_embedding = json.loads(stored_embedding)

        text_similarity = compute_cosine_similarity(text_embedding, stored_embedding)

        # Blend image similarity if both tickets have image embeddings
        final_similarity = text_similarity
        if image_embedding:
            stored_img_emb = report_result.data[0].get("image_embedding")
            if stored_img_emb:
                if isinstance(stored_img_emb, str):
                    import json
                    stored_img_emb = json.loads(stored_img_emb)
                img_similarity = compute_cosine_similarity(image_embedding, stored_img_emb)
                # Composite score: w_text * text_sim + w_image * img_sim
                final_similarity = DEDUP_W_TEXT * text_similarity + DEDUP_W_IMAGE * img_similarity

        threshold = settings.dedup_similarity_threshold
        if final_similarity >= threshold and final_similarity > best_similarity:
            best_similarity = final_similarity
            best_match = ticket
            best_match["similarity_score"] = final_similarity

    return best_match


async def increment_upvote(master_ticket_id: str) -> None:
    """Increments the upvote count on a master ticket (another citizen reported the same issue)."""
    supabase = get_supabase_client()

    # Fetch current count
    result = (
        supabase.table("master_tickets")
        .select("upvote_count")
        .eq("id", master_ticket_id)
        .single()
        .execute()
    )
    current = result.data.get("upvote_count", 1) if result.data else 1

    supabase.table("master_tickets").update(
        {"upvote_count": current + 1}
    ).eq("id", master_ticket_id).execute()
