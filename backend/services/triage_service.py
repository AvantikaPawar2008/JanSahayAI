"""Calls Groq LLM to classify complaints into department, urgency, sub_category, and generate field SOPs."""

import json
from backend.utils.groq_client import get_groq_client
from backend.utils.prompts import TRIAGE_PROMPT
from backend.config import get_settings
from backend.models.schemas import TriageResult


ALLOWED_DEPARTMENTS = {
    "Water Supply & Sewerage",
    "Roads & Infrastructure",
    "Solid Waste Management",
    "Electrical & Streetlighting",
    "Health & Sanitation",
}

# Fallback sub_category mappings for rule-based triage (when LLM unavailable)
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
    Sends complaint text to Groq LLM for classification and SOP generation.

    Args:
        complaint_text: The citizen's complaint (transcribed/translated if from audio)
        lat: Latitude of the complaint location
        lng: Longitude of the complaint location

    Returns:
        TriageResult with department, urgency, sub_category, sop_steps, tools, citizen_sms
    """
    client = get_groq_client()
    settings = get_settings()

    # Defensive sanitization to prevent delimiter breakout
    sanitized_text = (
        complaint_text.replace("</citizen_complaint>", "")
        .replace("<citizen_complaint>", "")
        .strip()
    )

    prompt = TRIAGE_PROMPT.format(
        complaint_text=sanitized_text,
        lat=lat,
        lng=lng,
    )

    parsed = None
    try:
        response = client.chat.completions.create(
            model=settings.groq_text_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a municipal complaint triage AI. "
                        "Respond ONLY with valid JSON with these exact keys: "
                        "department, urgency, category, sub_category, "
                        "sop_steps (array of 3 strings), "
                        "tools_required (array of strings), "
                        "citizen_sms_draft (string). "
                        "sub_category MUST be a lowercase snake_case identifier "
                        "such as: pothole, road_collapse, footpath_damage, water_leak, "
                        "no_water_supply, sewage_overflow, blocked_drain, garbage_dump, "
                        "overflowing_bin, uncollected_waste, streetlight_outage, "
                        "exposed_wire, power_line_down, open_manhole, dirty_public_toilet."
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
    except Exception as e:
        # Fallback to rule-based classification if Groq call fails
        lower_text = complaint_text.lower()

        # Determine sub_category from keywords
        sub_cat = "general_issue"
        for kw, sc in _KEYWORD_SUBCATEGORY.items():
            if kw in lower_text:
                sub_cat = sc
                break

        if any(w in lower_text for w in ["pothole", "road", "tar", "asphalt", "footpath", "collapse"]):
            dept = "Roads & Infrastructure"
            cat = "Pothole / Road Damage"
            urg = "HIGH" if any(w in lower_text for w in ["deep", "accident", "dangerous", "collapse"]) else "MEDIUM"
        elif any(w in lower_text for w in ["water", "leak", "pipe", "drainage", "sewage"]):
            dept = "Water Supply & Sewerage"
            cat = "Water Leakage"
            urg = "HIGH"
        elif any(w in lower_text for w in ["garbage", "trash", "waste", "dump", "bin"]):
            dept = "Solid Waste Management"
            cat = "Garbage Accumulation"
            urg = "MEDIUM"
        elif any(w in lower_text for w in ["light", "dark", "wire", "pole", "electricity"]):
            dept = "Electrical & Streetlighting"
            cat = "Streetlight Failure"
            urg = "HIGH" if "wire" in lower_text else "MEDIUM"
        else:
            dept = "Roads & Infrastructure"
            cat = "General Civic Issue"
            urg = "MEDIUM"

        parsed = {
            "department": dept,
            "urgency": urg,
            "category": cat,
            "sub_category": sub_cat,
            "sop_steps": [
                "Deploy field response team to reported coordinates",
                "Conduct on-site safety hazard assessment and cordon off",
                "Execute structural repair and capture post-resolution verification proof",
            ],
            "tools_required": ["Safety Barricades", "Inspection Camera", "Repair Materials"],
            "citizen_sms_draft": (
                f"Municipal update: Your {cat} complaint at this location has been "
                f"assigned to {dept}. Response team dispatched."
            ),
        }

    raw_dept = (parsed.get("department") or "").strip()
    needs_admin_review = False

    if raw_dept in ALLOWED_DEPARTMENTS:
        final_dept = raw_dept
    else:
        final_dept = "Roads & Infrastructure"
        needs_admin_review = True

    # Normalize sub_category to lowercase snake_case; default to empty string if absent
    raw_sub_cat = (parsed.get("sub_category") or "").strip().lower().replace(" ", "_")

    return TriageResult(
        department=final_dept,
        urgency=parsed.get("urgency", "MEDIUM"),
        category=parsed.get("category", "General Complaint"),
        sub_category=raw_sub_cat or None,
        sop_steps=parsed.get("sop_steps", []),
        tools_required=parsed.get("tools_required", []),
        citizen_sms_draft=parsed.get("citizen_sms_draft", ""),
        needs_admin_review=needs_admin_review,
    )
