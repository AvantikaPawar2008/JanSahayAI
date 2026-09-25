"""Calls Laya for typed classification (department, urgency) and Groq LLM for SOP/SMS generation."""

import json
import logging
from backend.utils.groq_client import get_groq_client
from backend.utils.prompts import TRIAGE_SOP_PROMPT
from backend.config import get_settings
from backend.models.schemas import TriageResult
from backend.services.laya_service import (
    classify_department,
    score_urgency,
    LAYA_LOW_CONFIDENCE_REVIEW_THRESHOLD,
    DEPARTMENTS,
)

logger = logging.getLogger("civicpulse.triage")

ALLOWED_DEPARTMENTS = set(DEPARTMENTS)

# Fallback sub_category mappings for defect identification
_KEYWORD_SUBCATEGORY = {
    "pothole": "pothole",
    "road": "road_damage",
    "tar": "road_damage",
    "asphalt": "road_damage",
    "footpath": "footpath_damage",
    "collapse": "road_collapse",
    "water": "water_leak",
    "leak": "water_leak",
    "pipe": "water_leak",
    "sewage": "sewage_overflow",
    "drainage": "blocked_drain",
    "garbage": "garbage_dump",
    "trash": "uncollected_waste",
    "waste": "uncollected_waste",
    "dump": "garbage_dump",
    "bin": "overflowing_bin",
    "light": "streetlight_outage",
    "dark": "streetlight_outage",
    "wire": "exposed_wire",
    "pole": "streetlight_outage",
    "electricity": "exposed_wire",
    "manhole": "open_manhole",
    "toilet": "dirty_public_toilet",
}


async def triage_complaint(complaint_text: str, lat: float, lng: float) -> TriageResult:
    """
    Two-stage triage pipeline:
      1. Laya Typed-Decision Model (local, ~33ms):
         - Choice: classifies municipal department with calibrated probability
         - Score: rates urgency on ordinal scale (LOW, MEDIUM, HIGH, CRITICAL)
         - Low confidence (< 0.55) flags needs_admin_review = True
      2. Groq LLM:
         - Generates ONLY field SOP steps, equipment tools required, and citizen SMS draft.

    Args:
        complaint_text: The citizen's complaint (transcribed/translated if from audio)
        lat: Latitude of the complaint location
        lng: Longitude of the complaint location

    Returns:
        TriageResult with department, urgency, category, sub_category, sop_steps, tools, citizen_sms, needs_admin_review
    """
    settings = get_settings()

    # Defensive sanitization to prevent delimiter breakout
    sanitized_text = (
        complaint_text.replace("</citizen_complaint>", "")
        .replace("<citizen_complaint>", "")
        .strip()
    )

    # ------------------------------------------------------------------
    # Step 1: Laya Typed Decisions for Department and Urgency
    # ------------------------------------------------------------------
    try:
        dept_result = classify_department(sanitized_text)
        dept = dept_result["department"]
        dept_confidence = dept_result["confidence"]
    except Exception as e:
        logger.error(f"Laya department classification failed ({e}); using fallback.")
        dept = "Roads & Infrastructure"
        dept_confidence = 0.0

    try:
        urgency_result = score_urgency(sanitized_text)
        urg = urgency_result["urgency"]
    except Exception as e:
        logger.error(f"Laya urgency scoring failed ({e}); using fallback.")
        urg = "MEDIUM"

    # Admin review flag triggered by Laya confidence or department validation
    needs_admin_review = False
    review_threshold = getattr(settings, "laya_low_confidence_review_threshold", LAYA_LOW_CONFIDENCE_REVIEW_THRESHOLD)
    if dept_confidence < review_threshold:
        needs_admin_review = True
        logger.info(f"Laya department confidence ({dept_confidence:.4f}) below threshold ({review_threshold}). Flagged for admin review.")

    if dept not in ALLOWED_DEPARTMENTS:
        final_dept = "Roads & Infrastructure"
        needs_admin_review = True
    else:
        final_dept = dept

    # Determine sub_category and category from keywords
    lower_text = sanitized_text.lower()
    sub_cat = "general_issue"
    for kw, sc in _KEYWORD_SUBCATEGORY.items():
        if kw in lower_text:
            sub_cat = sc
            break

    cat = sub_cat.replace("_", " ").title() if sub_cat != "general_issue" else "General Civic Issue"

    # ------------------------------------------------------------------
    # Step 2: Groq Generates ONLY SOP Steps, Tools Required & SMS Draft
    # ------------------------------------------------------------------
    sop_steps = [
        "Deploy field response team to reported coordinates",
        "Conduct on-site safety hazard assessment and cordon off",
        "Execute structural repair and capture post-resolution verification proof",
    ]
    tools_required = ["Safety Barricades", "Inspection Camera", "Repair Materials"]
    citizen_sms_draft = (
        f"Municipal update: Your {cat} complaint at this location has been "
        f"assigned to {final_dept}. Response team dispatched."
    )

    client = get_groq_client()
    prompt = TRIAGE_SOP_PROMPT.format(
        department=final_dept,
        urgency=urg,
        complaint_text=sanitized_text,
        lat=lat,
        lng=lng,
    )

    try:
        response = client.chat.completions.create(
            model=settings.groq_text_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a municipal complaint field response coordinator. "
                        "Respond ONLY with valid JSON with these exact keys: "
                        "sop_steps (array of 3 strings), "
                        "tools_required (array of strings), "
                        "citizen_sms_draft (string)."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=1024,
            response_format={"type": "json_object"},
        )
        raw_content = response.choices[0].message.content
        parsed = json.loads(raw_content)
        if parsed.get("sop_steps") and isinstance(parsed["sop_steps"], list):
            sop_steps = parsed["sop_steps"]
        if parsed.get("tools_required") and isinstance(parsed["tools_required"], list):
            tools_required = parsed["tools_required"]
        if parsed.get("citizen_sms_draft") and isinstance(parsed["citizen_sms_draft"], str):
            citizen_sms_draft = parsed["citizen_sms_draft"]
    except Exception as e:
        logger.warning(f"Groq SOP generation fallback engaged: {e}")

    return TriageResult(
        department=final_dept,
        urgency=urg,
        category=cat,
        sub_category=sub_cat,
        sop_steps=sop_steps,
        tools_required=tools_required,
        citizen_sms_draft=citizen_sms_draft,
        needs_admin_review=needs_admin_review,
    )
