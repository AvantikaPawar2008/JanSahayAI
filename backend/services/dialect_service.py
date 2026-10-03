"""[TODO-IN-03] Vernacular Dialect Accuracy - Indian Municipal Gazetteer.

Handles phonetic Marathi/Hindi/Kannada/Telugu landmark normalization for
improved complaint routing and deduplication accuracy.

Features:
 1. Phonetic gazetteer: Lookup table of common Indian landmark transliterations
 (e.g., "ganpati mandir" -> "Ganesh Temple", "metro pillar 142" -> structured landmark)
 2. LLM-assisted normalization: For landmarks not in the static gazetteer,
 uses Groq LLM with the DIALECT_NORMALIZATION_PROMPT
 3. Transparent fallback: Returns original text if normalization fails (never drops data)

Usage:
 from backend.services.dialect_service import normalize_complaint_text
 result = await normalize_complaint_text("pothole opp ganpati mandir near pillar 42")
"""

import logging
import re
from typing import Optional

from backend.config import get_settings

logger = logging.getLogger("civicpulse.dialect")


# Static Phonetic Gazetteer
# Maps transliterated Indian landmark terms to their standardized form.
_GAZETTEER: list[tuple[str, str]] = [
    # Religious landmarks
    (r"\bganpati\s*mandir\b", "Ganesh Temple"),
    (r"\bganesh\s*mandir\b", "Ganesh Temple"),
    (r"\bshiv\s*mandir\b", "Shiva Temple"),
    (r"\bmasjid\b", "Mosque"),
    (r"\bgurudwara\b", "Gurudwara"),
    (r"\bchurch\b", "Church"),
    (r"\bdargah\b", "Dargah"),
    (r"\bmata\s*mandir\b", "Mata Mandir"),
    (r"\bhanuman\s*mandir\b", "Hanuman Temple"),
    (r"\bbhagwan\s*temple\b", "Hindu Temple"),
    (r"\bsai\s*baba\s*mandir\b", "Sai Baba Mandir"),
    # Metro landmarks
    (r"\bmetro\s*pillar\s*[no.#]*\s*(\d+)\b", r"Metro Pillar \1"),
    (r"\bmetro\s*station\b", "Metro Station"),
    (r"\bmetro\s*bridge\b", "Metro Viaduct"),
    # Street type normalizations
    (r"\bmarg\b", "Road"),
    (r"\bpath\b", "Lane"),
    (r"\bwadi\b", "Colony"),
    (r"\bnagar\b", "Nagar"),
    (r"\bchowk\b", "Square/Chowk"),
    (r"\bgali\b", "Lane"),
    (r"\bphata\b", "Junction"),
    (r"\bfata\b", "Junction"),
    # Common municipal reference points
    (r"\bpmrda\b", "PMRDA"),
    (r"\bbbmp\b", "BBMP"),
    (r"\bmnc\b", "Municipal Corporation"),
    (r"\bgramachap\b", "Grampanchayat"),
    # Schools / Hospitals (common reference points)
    (r"\bshala\b", "School"),
    (r"\bvidyalay\b", "School"),
    (r"\brupali\b", "Hospital"),
    (r"\bdawakhana\b", "Dispensary/Clinic"),
    (r"\bpmc\s*hospital\b", "PMC Hospital"),
    # Direction prefixes
    (r"\bopp[.\s]*\b", "Opposite "),
    (r"\bopposite\b", "Opposite"),
    (r"\bnear\b", "Near"),
    (r"\bbehind\b", "Behind"),
    (r"\badjacent\s*to\b", "Adjacent to"),
    (r"\bbeside\b", "Beside"),
]


def _apply_gazetteer(text: str) -> tuple[str, list[dict]]:
    """
    Apply the static phonetic gazetteer to normalize Indian landmark terms.

    Returns:
        Tuple of (normalized_text, list of replacement dicts)
    """
    replacements = []
    normalized = text

    for pattern, replacement in _GAZETTEER:
        match = re.search(pattern, normalized, re.IGNORECASE)
        if match:
            original_fragment = match.group(0)
            new_text = re.sub(pattern, replacement, normalized, flags=re.IGNORECASE)
            if new_text != normalized:
                replacements.append({
                    "original": original_fragment,
                    "normalized": re.sub(pattern, replacement, original_fragment, flags=re.IGNORECASE),
                    "source": "gazetteer",
                })
            normalized = new_text

    return normalized, replacements


async def normalize_complaint_text(
    complaint_text: str,
    use_llm_fallback: bool = True,
) -> dict:
    """
    Normalize Indian vernacular dialect in a complaint text.

    Pipeline:
    1. Apply static phonetic gazetteer (sub-millisecond, zero API calls)
    2. Optionally call LLM for residual normalization (async, only if gazetteer found replacements < 2)

    Args:
        complaint_text: Raw citizen complaint text (may contain Marathi/Hindi landmarks)
        use_llm_fallback: If True, call LLM for additional normalization

    Returns:
        dict with:
        normalized_text: Processed text
        original_text: Unchanged input
        detected_landmarks: List of {original, normalized, source} dicts
        detected_streets: List of normalized street names
        confidence: 0.0-1.0 confidence in normalization
        llm_used: bool - whether LLM was invoked
    """
    original_text = complaint_text

    # Stage 1: Static gazetteer normalization
    normalized_text, gazetteer_replacements = _apply_gazetteer(complaint_text)
    detected_landmarks = gazetteer_replacements
    llm_used = False
    llm_confidence = 0.0

    # Stage 2: LLM normalization (only if text has Indian-language indicators AND gazetteer found < 2 matches)
    has_indian_chars = bool(re.search(
        r'[\u0900-\u097F\u0C80-\u0CFF\u0B80-\u0BFF\u0A00-\u0A7F]|'
        r'\b(mandir|masjid|wadi|nagar|chowk|gali|phata|marg|shala)\b',
        normalized_text, re.IGNORECASE
    ))

    if use_llm_fallback and (has_indian_chars or len(detected_landmarks) < 2):
        try:
            llm_result = await _llm_normalize(normalized_text)
            if llm_result.get("normalized_text") and llm_result["normalized_text"] != normalized_text:
                for lm in llm_result.get("detected_landmarks", []):
                    lm["source"] = "llm"
                    detected_landmarks.append(lm)
                normalized_text = llm_result["normalized_text"]
                llm_confidence = float(llm_result.get("confidence", 0.5))
                llm_used = True
        except Exception as exc:
            logger.warning("LLM dialect normalization failed (non-fatal): %s", exc)

    # Extract detected street names
    detected_streets = []
    street_pattern = re.compile(
        r'\b([A-Za-z][A-Za-z\s]*(?:Road|Marg|Street|Lane|Avenue|Nagar|Path|Ring Road))\b',
        re.IGNORECASE,
    )
    for m in street_pattern.finditer(normalized_text):
        street = m.group(1).strip().title()
        if len(street) > 4 and street not in detected_streets:
            detected_streets.append(street)

    # Compute confidence
    if detected_landmarks:
        confidence = min(1.0, 0.6 + 0.1 * len(detected_landmarks) + llm_confidence * 0.2)
    else:
        confidence = 0.5

    return {
        "normalized_text": normalized_text,
        "original_text": original_text,
        "detected_landmarks": detected_landmarks,
        "detected_streets": detected_streets[:5],
        "confidence": round(confidence, 3),
        "llm_used": llm_used,
        "gazetteer_hits": len(gazetteer_replacements),
    }


async def _llm_normalize(text: str) -> dict:
    """
    LLM-assisted vernacular normalization using DIALECT_NORMALIZATION_PROMPT.
    Called only when static gazetteer coverage is insufficient.
    """
    import json
    from backend.utils.prompts import DIALECT_NORMALIZATION_PROMPT
    from backend.utils.groq_client import get_groq_client

    settings = get_settings()
    client = get_groq_client()

    prompt = DIALECT_NORMALIZATION_PROMPT.format(complaint_text=text[:500])

    response = client.chat.completions.create(
        model=settings.groq_text_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an Indian municipal geography expert. "
                    "Respond ONLY with valid JSON."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        max_tokens=512,
        response_format={"type": "json_object"},
    )

    raw = response.choices[0].message.content
    return json.loads(raw)
