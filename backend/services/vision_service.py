"""Groq vision model calls — photo triage and before/after structural comparison."""

import json
import base64
from backend.utils.groq_client import get_groq_client
from backend.utils.prompts import VISION_TRIAGE_PROMPT, BEFORE_AFTER_PROMPT
from backend.config import get_settings


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
