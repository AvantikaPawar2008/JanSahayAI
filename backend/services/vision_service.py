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
from backend.utils.prompts import VISION_TRIAGE_PROMPT, BEFORE_AFTER_PROMPT, VISION_RUBRIC_PROMPT
from backend.config import get_settings

logger = logging.getLogger("civicpulse.vision")

ACTIVE_VISION_MODEL = "qwen/qwen3.8-27b"


def _clean_and_parse_json(raw: str) -> dict:
    """
    Robustly parses JSON from LLM output, handling markdown code fences,
    trailing commas, or explanatory text surrounding the JSON block.
    """
    if not raw or not isinstance(raw, str):
        raise ValueError("Empty or non-string response from vision model")

    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    # Extract outermost JSON object if surrounding text remains
    if "{" in text and "}" in text:
        start = text.find("{")
        end = text.rfind("}") + 1
        text = text[start:end]

    return json.loads(text)


def _call_groq_vision(messages: list, temperature: float = 0.1, max_tokens: int = 512) -> str:
    """
    Executes a Groq vision chat completion with automatic model validation and fallback.
    If the configured model is decommissioned or errors, automatically falls back to
    ACTIVE_VISION_MODEL ('qwen/qwen3.8-27b').
    """
    client = get_groq_client()
    settings = get_settings()
    model_name = settings.groq_vision_model or ACTIVE_VISION_MODEL

    # Intercept decommissioned models (e.g., llama-3.2-11b-vision-preview)
    if any(bad in model_name.lower() for bad in ["llama-3.2", "11b-vision", "90b-vision"]):
        model_name = ACTIVE_VISION_MODEL

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content
    except Exception as exc:
        err_msg = str(exc).lower()
        if "decommissioned" in err_msg or "not found" in err_msg or model_name != ACTIVE_VISION_MODEL:
            logger.warning(
                f"Groq vision model '{model_name}' failed ({exc}). Retrying with active model '{ACTIVE_VISION_MODEL}'..."
            )
            response = client.chat.completions.create(
                model=ACTIVE_VISION_MODEL,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            return response.choices[0].message.content
        raise


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
    try:
        messages = [
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
        ]
        raw = _call_groq_vision(messages=messages, temperature=0.1, max_tokens=512)
        parsed = _clean_and_parse_json(raw)
        return {
            "description": parsed.get("description") or "Civic issue reported via photo",
            "category": parsed.get("category") or "Unknown",
            "urgency": parsed.get("urgency") or "MEDIUM",
            "department": parsed.get("department") or "Roads & Infrastructure",
        }
    except Exception as exc:
        logger.error(f"analyze_complaint_photo failed: {exc}")
        return {
            "description": "Civic issue reported via photo",
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
    try:
        messages = [
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
        ]
        raw = _call_groq_vision(messages=messages, temperature=0.1, max_tokens=512)
        parsed = _clean_and_parse_json(raw)
        return {
            "same_location": bool(parsed.get("same_location", False)),
            "defect_resolved": bool(parsed.get("defect_resolved", False)),
            "repair_quality": parsed.get("repair_quality", "POOR"),
            "confidence": float(parsed.get("confidence", 0.0)),
            "notes": parsed.get("notes", ""),
        }
    except Exception as exc:
        logger.error(f"compare_before_after failed: {exc}")
        return {
            "same_location": False,
            "defect_resolved": False,
            "repair_quality": "POOR",
            "confidence": 0.0,
            "notes": f"Vision comparison error: {str(exc)}",
        }


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
        raw = _call_groq_vision(messages=[{"role": "user", "content": content}], temperature=0.1, max_tokens=512)
        vlm_result = _clean_and_parse_json(raw)
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


# ============================================================
# [TODO-VF-03] MULTI-CRITERIA SCORED RUBRIC VERIFICATION
# ============================================================

RUBRIC_PASS_THRESHOLD = 12   # 12-15 = auto-PASS
RUBRIC_FAIL_THRESHOLD = 7    # 0-7 = auto-FAIL, 8-11 = BORDERLINE (supervisor review)


async def verify_repair_photo_rubric(master_ticket: dict, after_photo_url: str) -> dict:
    """
    [TODO-VF-03] Multi-criteria scored rubric verification for repair photos.

    Evaluates three axes scored 0-5 each (max 15):
    - site_match: Are photos of the same location?
    - defect_resolved: Is the defect genuinely resolved?
    - repair_quality: Is the workmanship acceptable?

    Decision logic:
    - 12-15: PASS (auto-approve)
    - 8-11: BORDERLINE (route to human supervisor review)
    - 0-7: FAIL (reject, reopen ticket)
    """
    client = get_groq_client()
    settings = get_settings()

    sub_category = master_ticket.get("sub_category") or "civic issue"
    description = master_ticket.get("description") or "No description provided"
    urgency = master_ticket.get("urgency", "MEDIUM")
    has_before = bool(master_ticket.get("has_before_photo", False))

    before_photo_url = None
    if has_before:
        try:
            from backend.db.supabase_client import get_supabase_client
            supabase = get_supabase_client()
            before_res = (
                supabase.table("verification_photos")
                .select("image_url")
                .eq("master_ticket_id", master_ticket["id"])
                .eq("photo_type", "before")
                .order("captured_at", desc=False)
                .limit(1)
                .execute()
            )
            if before_res.data:
                before_photo_url = before_res.data[0]["image_url"]
        except Exception as exc:
            logger.warning("Could not fetch before photo for rubric verification: %s", exc)

    prompt = VISION_RUBRIC_PROMPT.format(
        sub_category=sub_category,
        description=description[:300],
        urgency=urgency,
    )

    content = [{"type": "text", "text": prompt}]
    if before_photo_url:
        content.append({"type": "image_url", "image_url": {"url": before_photo_url}})
    content.append({"type": "image_url", "image_url": {"url": after_photo_url}})

    try:
        raw = _call_groq_vision(messages=[{"role": "user", "content": content}], temperature=0.05, max_tokens=512)
        rubric = _clean_and_parse_json(raw)
    except Exception as exc:
        logger.error("Rubric VLM call failed: %s", exc)
        rubric = {
            "site_match": 0,
            "defect_resolved": 0,
            "repair_quality": 0,
            "total_score": 0,
            "verdict": "FAIL",
            "notes": f"VLM error: {str(exc)}",
            "confidence": 0.0,
        }

    site_match = int(rubric.get("site_match", 0))
    defect_resolved = int(rubric.get("defect_resolved", 0))
    repair_quality = int(rubric.get("repair_quality", 0))
    total_score = site_match + defect_resolved + repair_quality

    if total_score >= RUBRIC_PASS_THRESHOLD:
        verdict = "PASS"
        passed = True
    elif total_score <= RUBRIC_FAIL_THRESHOLD:
        verdict = "FAIL"
        passed = False
    else:
        verdict = "BORDERLINE"
        passed = False

    needs_supervisor_review = (verdict == "BORDERLINE") or (urgency == "CRITICAL" and verdict == "PASS")

    if needs_supervisor_review:
        logger.warning(
            "RUBRIC BORDERLINE/CRITICAL: ticket=%s total=%d/15 site=%d resolved=%d quality=%d - flagged for supervisor review",
            master_ticket.get("id"), total_score, site_match, defect_resolved, repair_quality,
        )

    return {
        "passed": passed,
        "verdict": verdict,
        "total_score": total_score,
        "site_match": site_match,
        "defect_resolved": defect_resolved,
        "repair_quality": repair_quality,
        "notes": rubric.get("notes", ""),
        "confidence": float(rubric.get("confidence", 0.0)),
        "needs_supervisor_review": needs_supervisor_review,
        "verification_method": "rubric_scored" + ("_before_after" if before_photo_url else "_single_photo"),
        "pass_threshold": RUBRIC_PASS_THRESHOLD,
        "fail_threshold": RUBRIC_FAIL_THRESHOLD,
    }

