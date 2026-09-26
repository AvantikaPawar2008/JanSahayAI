"""Groq vision model calls — photo triage, sharpness scoring, and repair verification.

Key additions over the original:
- compute_sharpness_score(): Laplacian variance blur check, computed once at upload, stored on
  ticket_reports.image_sharpness_score.  Higher = sharper.
- verify_repair_photo(): Unified verification entry-point that branches on master_ticket.has_before_photo:
    * True  → before/after comparison (high-confidence path)
    * False → single-image completion check (lower-confidence fallback)
  GPS geofence check remains mandatory in both paths.
"""

import json
import logging
import numpy as np
import cv2

from backend.utils.groq_client import get_groq_client
from backend.utils.prompts import VISION_TRIAGE_PROMPT, BEFORE_AFTER_PROMPT
from backend.config import get_settings

logger = logging.getLogger("civicpulse.vision")


# ============================================================
# SHARPNESS SCORING — Section 2
# ============================================================

def compute_sharpness_score(image_bytes: bytes) -> float:
    """
    Computes a Laplacian-variance sharpness score for an image.
    Higher score = sharper image.  Computed once at upload, stored on
    ticket_reports.image_sharpness_score, never recomputed on read.

    Returns 0.0 for unreadable/corrupt images (treated as lowest quality).
    """
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
        if img is None:
            logger.warning("compute_sharpness_score: cv2.imdecode returned None — treating as unreadable")
            return 0.0
        laplacian_var = cv2.Laplacian(img, cv2.CV_64F).var()
        return float(laplacian_var)
    except Exception as exc:
        logger.warning(f"compute_sharpness_score error: {exc}")
        return 0.0


# ============================================================
# COMPLAINT PHOTO TRIAGE
# ============================================================

async def analyze_complaint_photo(image_url: str) -> dict:
    """
    Analyzes a complaint photo using Groq vision model to identify the civic issue.

    Args:
        image_url: Public URL of the complaint image

    Returns:
        dict with description, category, urgency, department
    """
    client = get_groq_client()
    settings = get_settings()

    response = client.chat.completions.create(
        model=settings.groq_vision_model,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": VISION_TRIAGE_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url},
                    },
                ],
            }
        ],
        temperature=0.1,
        max_tokens=512,
    )

    raw = response.choices[0].message.content
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            "description": raw,
            "category": "Unknown",
            "urgency": "MEDIUM",
            "department": "Roads & Infrastructure",
        }


# ============================================================
# BEFORE/AFTER COMPARISON (legacy helper — still used internally)
# ============================================================

async def compare_before_after(before_url: str, after_url: str) -> dict:
    """
    Compares before/after photos to verify if a civic issue has been resolved.

    Args:
        before_url: Public URL of the 'before' photo
        after_url: Public URL of the 'after' photo

    Returns:
        dict with same_location, defect_resolved, repair_quality, confidence, notes
    """
    client = get_groq_client()
    settings = get_settings()

    response = client.chat.completions.create(
        model=settings.groq_vision_model,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": BEFORE_AFTER_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": before_url},
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": after_url},
                    },
                ],
            }
        ],
        temperature=0.1,
        max_tokens=512,
    )

    raw = response.choices[0].message.content
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {
            "same_location": False,
            "defect_resolved": False,
            "repair_quality": "POOR",
            "confidence": 0.0,
            "notes": f"Failed to parse vision model response: {raw[:200]}",
        }

    return result


# ============================================================
# UNIFIED REPAIR VERIFICATION — Section 4
# ============================================================

async def verify_repair_photo(master_ticket: dict, after_photo_url: str) -> dict:
    """
    Runs the appropriate verification check depending on whether a before-photo exists.

    * has_before_photo=True  → before/after comparison (high confidence).
    * has_before_photo=False → single-image completion check (lower confidence fallback).

    GPS geofence check is MANDATORY in both cases and is handled by the caller
    (verification_router.py) before this function is invoked — do NOT call this
    function if the geofence already failed.

    Args:
        master_ticket: Full master_ticket dict from Supabase (must include
                       id, has_before_photo, sub_category, description, urgency).
        after_photo_url: Public storage URL of the after/repair photo.

    Returns:
        dict:
            passed (bool): True if VLM determined repair is complete.
            notes (str): VLM explanation.
            verification_method (str): 'before_after_comparison' | 'single_photo_completion'.
            same_location (bool): Only meaningful for before_after_comparison path.
            defect_resolved (bool): VLM verdict on defect resolution.
            repair_quality (str): GOOD | ACCEPTABLE | POOR | NOT_DONE | UNKNOWN.
            confidence (float): 0.0–1.0 (only well-defined for before_after path).
            needs_supervisor_review (bool): True when CRITICAL + no before-photo
                                           (weakest automated confidence, highest stakes).
    """
    client = get_groq_client()
    settings = get_settings()

    has_before = bool(master_ticket.get("has_before_photo", False))
    sub_category = master_ticket.get("sub_category") or "civic issue"
    description = master_ticket.get("description") or "No description provided"
    urgency = master_ticket.get("urgency", "MEDIUM")

    if has_before:
        # ---- Path A: Before/after comparison (high-confidence) ----
        from backend.db.supabase_client import get_supabase_client
        supabase = get_supabase_client()

        before_photo_res = (
            supabase.table("verification_photos")
            .select("image_url")
            .eq("master_ticket_id", master_ticket["id"])
            .eq("photo_type", "before")
            .order("captured_at", desc=False)
            .limit(1)
            .execute()
        )
        before_photo_url = (
            before_photo_res.data[0]["image_url"]
            if before_photo_res.data
            else None
        )

        if not before_photo_url:
            # Edge case: flag is set but photo record is missing — fall back gracefully
            logger.warning(
                f"Ticket {master_ticket['id']} has has_before_photo=True but no before photo record found. "
                "Falling back to single-photo path."
            )
            has_before = False

    if has_before and before_photo_url:
        prompt = (
            f"Compare these two photos of the same location. "
            f"Photo 1 (before) shows a reported issue: '{sub_category}' — {description}. "
            f"Photo 2 (after) is submitted as proof of repair. "
            f"Does Photo 2 show the same location with the defect now resolved? "
            f"Explain what you see and answer with PASS or FAIL at the end.\n\n"
            f"Respond ONLY with valid JSON:\n"
            f'{{"same_location": true/false, "defect_resolved": true/false, '
            f'"repair_quality": "GOOD|ACCEPTABLE|POOR|NOT_DONE", "confidence": 0.0-1.0, '
            f'"verdict": "PASS|FAIL", "notes": "brief explanation"}}'
        )
        method = "before_after_comparison"
        content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": before_photo_url}},
            {"type": "image_url", "image_url": {"url": after_photo_url}},
        ]
    else:
        # ---- Path B: Single-photo completion check (lower-confidence fallback) ----
        prompt = (
            f"This photo is submitted as proof of repair for a reported issue.\n"
            f"Issue type: '{sub_category}'.\n"
            f"Original citizen description: '{description}'.\n"
            f"No before-photo is available for comparison, so judge based on this photo alone: "
            f"does it show a completed, safe repair consistent with this type of issue "
            f"(e.g., a filled pothole, a working streetlight, a cleared garbage pile)? "
            f"Explain what you see and answer with PASS or FAIL at the end.\n\n"
            f"Respond ONLY with valid JSON:\n"
            f'{{"defect_resolved": true/false, '
            f'"repair_quality": "GOOD|ACCEPTABLE|POOR|NOT_DONE", "confidence": 0.0-1.0, '
            f'"verdict": "PASS|FAIL", "notes": "brief explanation"}}'
        )
        method = "single_photo_completion"
        content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": after_photo_url}},
        ]

    try:
        response = client.chat.completions.create(
            model=settings.groq_vision_model,
            messages=[{"role": "user", "content": content}],
            temperature=0.1,
            max_tokens=512,
        )
        raw = response.choices[0].message.content
        try:
            vlm_result = json.loads(raw)
        except json.JSONDecodeError:
            # Parse PASS/FAIL from raw text if JSON fails
            verdict_text = raw.upper()
            passed = "PASS" in verdict_text and "FAIL" not in verdict_text.replace("PASS", "")
            vlm_result = {
                "defect_resolved": passed,
                "verdict": "PASS" if passed else "FAIL",
                "repair_quality": "UNKNOWN",
                "confidence": 0.5 if passed else 0.0,
                "notes": raw[:300],
            }
    except Exception as exc:
        logger.error(f"verify_repair_photo VLM call failed: {exc}")
        vlm_result = {
            "defect_resolved": False,
            "verdict": "FAIL",
            "repair_quality": "UNKNOWN",
            "confidence": 0.0,
            "notes": f"Vision check error: {str(exc)}",
        }

    # Determine pass from either the explicit verdict field or defect_resolved
    verdict = vlm_result.get("verdict", "")
    if verdict == "PASS":
        passed = True
    elif verdict == "FAIL":
        passed = False
    else:
        # Fallback to defect_resolved if verdict field is missing
        passed = bool(vlm_result.get("defect_resolved", False))

    # OPTIONAL CRITICAL escalation: if CRITICAL urgency + no before photo,
    # flag for supervisor review instead of auto-passing (weakest automated check,
    # highest stakes — don't silently auto-pass these).
    needs_supervisor_review = (
        urgency == "CRITICAL"
        and method == "single_photo_completion"
        and passed  # Only flag passing CRITICAL single-photo checks, not failing ones
    )
    if needs_supervisor_review:
        logger.warning(
            f"Ticket {master_ticket['id']} is CRITICAL with no before-photo — "
            "flagging for supervisor review despite VLM PASS."
        )

    return {
        "passed": passed,
        "notes": vlm_result.get("notes", ""),
        "verification_method": method,
        "same_location": vlm_result.get("same_location", True),  # Not applicable in single-photo path
        "defect_resolved": vlm_result.get("defect_resolved", passed),
        "repair_quality": vlm_result.get("repair_quality", "UNKNOWN"),
        "confidence": float(vlm_result.get("confidence", 0.0)),
        "needs_supervisor_review": needs_supervisor_review,
    }
