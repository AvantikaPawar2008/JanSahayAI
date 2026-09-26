"""Spatial + semantic deduplication — finds if a new complaint matches an existing master ticket.

Multi-stage filter:
  Stage 1 — spatial: only candidates within DEDUP_RADIUS_METERS (PostGIS ST_DWithin)
  Stage 2 — hard filter: same department AND same sub_category (if available)
  Stage 3 — three-zone semantic confirmation:
            - Similarity >= 0.90: Auto-duplicate (skip Laya)
            - Similarity < 0.60: Auto-new-ticket (skip Laya)
            - 0.60 <= Similarity < 0.90: Ambiguous zone — final confirmation via Laya (noul)

Department/sub_category match is a hard filter evaluated BEFORE similarity — this prevents two
unrelated issues near each other (e.g. pothole vs. water leak on the same street) from ever
merging into one master ticket.
"""

import json
import logging
from typing import Optional
from backend.db.supabase_client import get_supabase_client
from backend.services.embedding_service import compute_cosine_similarity
from backend.services.laya_service import confirm_duplicate
from backend.services.geo_service import haversine_distance
from backend.config import get_settings

logger = logging.getLogger("civicpulse.dedup")

# ============================================================
# DEDUP TUNING CONSTANTS — adjust these live during testing
# ============================================================
DEDUP_RADIUS_METERS = 100               # spatial search radius (meters)
DEDUP_HIGH_CONFIDENCE_THRESHOLD = 0.90  # auto-duplicate, skip Laya
DEDUP_LOW_CONFIDENCE_THRESHOLD = 0.60   # auto-new-ticket, skip Laya
# Between these two: ambiguous zone, ask Laya for a final confirmation

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
    new_report_text: Optional[str] = None,
    device_lat: Optional[float] = None,
    device_lng: Optional[float] = None,
    location_source: Optional[str] = None,
) -> dict | None:
    """
    Checks for duplicate master tickets near the given location with the same
    department, sub_category, and similar text.

    Three-stage pipeline:
      Stage 1 — spatial: PostGIS ST_DWithin within radius_meters
      Stage 2 — hard filter: department must match; sub_category must match if both sides have it
      Stage 3 — three-zone semantic decision:
                 - >= 0.90: Confident duplicate, merge immediately (no Laya call)
                 - < 0.60: Confident non-match, skip (no Laya call)
                 - 0.60 - 0.90: Ambiguous zone, invoke Laya typed-decision (noul) confirmation

    Args:
        lat: Latitude of new complaint
        lng: Longitude of new complaint
        text_embedding: 384-dim embedding of the new complaint text
        department: Classified department (from triage) — used as hard filter
        sub_category: Specific defect sub-type (from triage) — used as hard filter when present
        image_embedding: Optional image embedding (for blended similarity scoring)
        radius_meters: Spatial search radius (default DEDUP_RADIUS_METERS)
        new_report_text: Raw or translated text of incoming report for Laya comparison

    Returns:
        dict with master_ticket data if duplicate found, None otherwise
    """
    settings = get_settings()
    supabase = get_supabase_client()

    high_thresh = getattr(settings, "dedup_high_confidence_threshold", DEDUP_HIGH_CONFIDENCE_THRESHOLD)
    low_thresh = getattr(settings, "dedup_low_confidence_threshold", DEDUP_LOW_CONFIDENCE_THRESHOLD)

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
    candidates = []
    try:
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
    except Exception as geo_err:
        logger.warning(f"Spatial query fallback engaged: {geo_err}")
        candidates = []

    # ------------------------------------------------------------------
    # Stage 1b — Remote & Cross-Location Candidate Retrieval
    # Citizens frequently report civic issues from home, office, or commute.
    # The device logging location may be kilometers away from the real defect.
    # We query open master tickets in the same department to evaluate semantic equivalence.
    # ------------------------------------------------------------------
    if department:
        try:
            open_query = (
                supabase.table("master_tickets")
                .select("id, category, sub_category, department, urgency, status, lat, lng, upvote_count, created_at, description, text_embedding")
                .eq("department", department)
                .neq("status", "RESOLVED")
                .neq("status", "CLOSED")
            )
            if sub_category:
                open_query = open_query.or_(f"sub_category.eq.{sub_category},sub_category.is.null")

            open_res = open_query.execute()
            existing_cids = {c["id"] for c in candidates}
            for row in (open_res.data or []):
                if row["id"] not in existing_cids:
                    candidates.append(row)
        except Exception as open_err:
            logger.warning(f"Department open tickets fetch error: {open_err}")

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
        candidates = [
            c for c in candidates
            if not c.get("sub_category") or c.get("sub_category") == sub_category
        ]

    if not candidates:
        return None

    # ------------------------------------------------------------------
    # Stage 3 — Three-Zone Semantic Evaluation with Laya Ambiguity Gate
    # ------------------------------------------------------------------
    candidate_ids = [ticket["id"] for ticket in candidates]

    # Batch fetch all candidate reports to compare against all descriptions
    reports_result = (
        supabase.table("ticket_reports")
        .select("master_ticket_id, text_embedding, raw_text, translated_text, created_at")
        .in_("master_ticket_id", candidate_ids)
        .order("created_at", desc=False)
        .execute()
    )

    candidate_embeddings_map: dict[str, list[list[float]]] = {cid: [] for cid in candidate_ids}
    candidate_descriptions: dict[str, list[str]] = {cid: [] for cid in candidate_ids}

    # Also check if master_tickets table already has canonical text_embedding or description
    try:
        mt_res = (
            supabase.table("master_tickets")
            .select("id, description, text_embedding")
            .in_("id", candidate_ids)
            .execute()
        )
        for row in (mt_res.data or []):
            m_id = row.get("id")
            if m_id:
                desc = row.get("description")
                if desc:
                    candidate_descriptions.setdefault(m_id, []).append(desc)
                emb = row.get("text_embedding")
                if emb:
                    if isinstance(emb, str):
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
        if not m_id:
            continue
        text_content = rep.get("translated_text") or rep.get("raw_text")
        if text_content:
            candidate_descriptions.setdefault(m_id, []).append(text_content)
        emb = rep.get("text_embedding")
        if emb:
            if isinstance(emb, str):
                try:
                    emb = json.loads(emb)
                except Exception:
                    continue
            candidate_embeddings_map.setdefault(m_id, []).append(emb)

    for ticket in candidates:
        ticket_id = ticket["id"]

        # If both the candidate and incoming report have verified real problem locations
        # (via map pin or geocoded landmark) and are over 1200m apart, they represent
        # physically separate sites in the city (e.g. Pune Station vs Akurdi Station).
        cand_lat = ticket.get("lat")
        cand_lng = ticket.get("lng")
        if cand_lat is not None and cand_lng is not None and lat is not None and lng is not None:
            problem_dist = haversine_distance(lat, lng, cand_lat, cand_lng)
            if location_source != "remote" and problem_dist > 1200.0:
                logger.info(
                    f"Skipping candidate {ticket_id}: problem distance {problem_dist:.1f}m > 1200m "
                    f"(separate physical incident locations in city)"
                )
                continue

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

        # --- Zone 1: Confident Duplicate (>= 0.90) ---
        if final_similarity >= high_thresh:
            logger.info(
                f"✅ Confident duplicate match found: Ticket {ticket_id} (sim={final_similarity:.4f} >= {high_thresh}). "
                "Skipping Laya confirmation."
            )
            ticket["similarity_score"] = final_similarity
            ticket["laya_evaluated"] = False
            return ticket

        # --- Zone 2: Confident Non-Match (< 0.60) ---
        if final_similarity < low_thresh:
            logger.info(
                f"❌ Confident non-match: Ticket {ticket_id} (sim={final_similarity:.4f} < {low_thresh}). "
                "Skipping Laya confirmation."
            )
            continue

        # --- Zone 3: Ambiguous Zone (0.60 <= similarity < 0.90) ---
        # Ask Laya for a typed decision confirmation
        logger.info(
            f"🔍 Ambiguous zone match: Ticket {ticket_id} (sim={final_similarity:.4f} in [{low_thresh}, {high_thresh}]). "
            "Calling Laya for final duplicate confirmation..."
        )
        descriptions = candidate_descriptions.get(ticket_id, [])
        candidate_text = descriptions[0] if descriptions else ticket.get("category", "Civic Complaint")

        if new_report_text:
            laya_result = confirm_duplicate(
                new_report_text=new_report_text,
                candidate_ticket_text=candidate_text,
            )
            if laya_result.get("is_duplicate"):
                logger.info(
                    f"🎯 Laya confirmed duplicate: Ticket {ticket_id} "
                    f"(p_true={laya_result.get('confidence', 0.0):.4f} >= threshold)"
                )
                ticket["similarity_score"] = final_similarity
                ticket["laya_evaluated"] = True
                ticket["laya_confirmed"] = True
                ticket["laya_confidence"] = laya_result.get("confidence")
                return ticket
            else:
                logger.info(
                    f"🚫 Laya rejected duplicate: Ticket {ticket_id} "
                    f"(p_true={laya_result.get('confidence', 0.0):.4f} < threshold)"
                )
                continue
        else:
            # Fallback if text not provided: default to threshold check
            threshold = getattr(settings, "dedup_similarity_threshold", 0.80)
            if final_similarity >= threshold:
                ticket["similarity_score"] = final_similarity
                return ticket

    return None


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


# ============================================================
# BEFORE-PHOTO AUTO-ASSIGNMENT — Section 3
# ============================================================

def assign_or_update_before_photo(master_ticket_id: str, new_report: dict) -> None:
    """
    Decides whether the image on a newly-linked citizen report should become (or replace)
    the master ticket's 'before' verification photo.

    Rules:
      1. If no image on the report → nothing to do.
      2. If no 'before' photo exists yet → auto-create one from this report.
      3. If a 'before' photo already exists → only replace it if this report's sharpness
         score is strictly higher than the existing photo's source report score
         (sharper image wins, ties go to the existing photo).

    Sets master_tickets.has_before_photo = True when a before photo is first created.

    Args:
        master_ticket_id: UUID string of the master ticket.
        new_report: dict that MUST contain at minimum:
            - id (str): UUID of the ticket_report row
            - image_url (str | None): storage URL of the image
            - image_sharpness_score (float | None): Laplacian variance computed at upload
            - lat (float | None)
            - lng (float | None)
    """
    supabase = get_supabase_client()

    image_url = new_report.get("image_url")
    if not image_url:
        return  # No image on this report — nothing to do

    new_score = float(new_report.get("image_sharpness_score") or 0.0)
    new_report_id = new_report.get("id")
    new_lat = new_report.get("lat")
    new_lng = new_report.get("lng")

    # Check for an existing 'before' photo for this ticket
    try:
        existing_res = (
            supabase.table("verification_photos")
            .select("id, source_report_id, image_url")
            .eq("master_ticket_id", master_ticket_id)
            .eq("photo_type", "before")
            .order("captured_at", desc=False)
            .limit(1)
            .execute()
        )
        existing_before = existing_res.data[0] if existing_res.data else None
    except Exception as exc:
        logger.warning(f"assign_or_update_before_photo: failed to fetch existing before photo: {exc}")
        return

    if existing_before is None:
        # ---- First image for this ticket — auto-create 'before' photo ----
        photo_data = {
            "master_ticket_id": master_ticket_id,
            "photo_type": "before",
            "image_url": image_url,
            "verification_method": "before_after_comparison",  # default; updated at verification time
        }
        if new_lat is not None:
            photo_data["lat"] = new_lat
        if new_lng is not None:
            photo_data["lng"] = new_lng
        if new_report_id:
            photo_data["source_report_id"] = new_report_id

        try:
            supabase.table("verification_photos").insert(photo_data).execute()
            supabase.table("master_tickets").update(
                {"has_before_photo": True}
            ).eq("id", master_ticket_id).execute()
            logger.info(
                f"Before photo auto-created for ticket {master_ticket_id} "
                f"(report={new_report_id}, sharpness={new_score:.2f})"
            )
        except Exception as exc:
            logger.error(
                f"assign_or_update_before_photo: failed to create before photo for ticket "
                f"{master_ticket_id}: {exc}"
            )
        return

    # ---- A before photo already exists — compare sharpness ----
    existing_source_report_id = existing_before.get("source_report_id")
    existing_score = 0.0

    if existing_source_report_id:
        try:
            source_res = (
                supabase.table("ticket_reports")
                .select("image_sharpness_score")
                .eq("id", existing_source_report_id)
                .single()
                .execute()
            )
            existing_score = float(
                (source_res.data or {}).get("image_sharpness_score") or 0.0
            )
        except Exception as exc:
            logger.warning(
                f"assign_or_update_before_photo: could not fetch sharpness for source report "
                f"{existing_source_report_id}: {exc}"
            )

    if new_score > existing_score:
        # New photo is sharper — replace the existing before photo
        update_data = {"image_url": image_url}
        if new_lat is not None:
            update_data["lat"] = new_lat
        if new_lng is not None:
            update_data["lng"] = new_lng
        if new_report_id:
            update_data["source_report_id"] = new_report_id

        try:
            supabase.table("verification_photos").update(update_data).eq(
                "id", existing_before["id"]
            ).execute()
            logger.info(
                f"Before photo replaced for ticket {master_ticket_id} "
                f"(new sharpness={new_score:.2f} > old={existing_score:.2f}, "
                f"report={new_report_id})"
            )
        except Exception as exc:
            logger.error(
                f"assign_or_update_before_photo: failed to update before photo "
                f"{existing_before['id']}: {exc}"
            )
    else:
        logger.debug(
            f"Before photo NOT replaced for ticket {master_ticket_id} "
            f"(new sharpness={new_score:.2f} <= existing={existing_score:.2f})"
        )
