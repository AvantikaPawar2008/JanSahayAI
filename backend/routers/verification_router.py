"""Before/after photo verification with anti-fraud checks (geofence + VLM)."""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.db.supabase_client import get_supabase_client
from backend.services.geo_service import is_within_geofence
from backend.services.vision_service import compare_before_after
from backend.services.notification_service import send_citizen_notification
from backend.models.schemas import VerificationResult

logger = logging.getLogger("civicpulse.verification")
router = APIRouter(prefix="/api/verify", tags=["Verification"])


class VerifyPhotoRequest(BaseModel):
    master_ticket_id: str
    officer_id: str | None = None


class CitizenResponseRequest(BaseModel):
    master_ticket_id: str
    response: str  # "verified" or "reopen"


@router.post("/photo", response_model=VerificationResult)
async def verify_before_after(request: VerifyPhotoRequest):
    """
    Runs anti-fraud checks on before/after photos:
    1. Geofence: shutter GPS within 150m of ticket location
    2. VLM structural check: same location? defect resolved?
    
    On pass → sets ticket to RESOLVED_PENDING_CITIZEN
    """
    supabase = get_supabase_client()

    # Get the ticket
    ticket_result = (
        supabase.table("master_tickets")
        .select("*")
        .eq("id", request.master_ticket_id)
        .single()
        .execute()
    )
    if not ticket_result.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ticket = ticket_result.data

    # Get before and after photos
    photos_result = (
        supabase.table("verification_photos")
        .select("*")
        .eq("master_ticket_id", request.master_ticket_id)
        .order("captured_at", desc=True)
        .execute()
    )

    photos = photos_result.data or []
    before_photos = [p for p in photos if p["photo_type"] == "before"]
    after_photos = [p for p in photos if p["photo_type"] == "after"]

    if not before_photos:
        raise HTTPException(status_code=400, detail="No 'before' photo found")
    if not after_photos:
        raise HTTPException(status_code=400, detail="No 'after' photo found")

    before_photo = before_photos[0]
    after_photo = after_photos[0]

    # Check 1: Geofence — is the after photo within 150m of the ticket location?
    after_within, after_distance = is_within_geofence(
        after_photo["lat"], after_photo["lng"],
        ticket["lat"], ticket["lng"],
    )

    before_within, before_distance = is_within_geofence(
        before_photo["lat"], before_photo["lng"],
        ticket["lat"], ticket["lng"],
    )

    if not after_within:
        # Geofence failed — short circuit
        result = VerificationResult(
            geofence_passed=False,
            vision_check_passed=False,
            same_location=False,
            defect_resolved=False,
            confidence=0.0,
            notes=f"After photo GPS is {after_distance}m from ticket location (max 150m allowed)",
            overall_passed=False,
        )

        # Update photo records with fraud check result
        supabase.table("verification_photos").update({
            "fraud_check_passed": False,
            "fraud_check_notes": result.notes,
        }).eq("id", after_photo["id"]).execute()

        return result

    # Check 2: VLM structural comparison
    try:
        vision_result = await compare_before_after(
            before_photo["image_url"],
            after_photo["image_url"],
        )
    except Exception as e:
        logger.error(f"Vision comparison failed: {e}")
        vision_result = {
            "same_location": True,
            "defect_resolved": False,
            "repair_quality": "UNKNOWN",
            "confidence": 0.0,
            "notes": f"Vision check error: {str(e)}",
        }

    overall_passed = (
        after_within
        and vision_result.get("same_location", False)
        and vision_result.get("defect_resolved", False)
    )

    result = VerificationResult(
        geofence_passed=after_within,
        vision_check_passed=vision_result.get("defect_resolved", False),
        same_location=vision_result.get("same_location", False),
        defect_resolved=vision_result.get("defect_resolved", False),
        repair_quality=vision_result.get("repair_quality"),
        confidence=vision_result.get("confidence", 0.0),
        notes=vision_result.get("notes", ""),
        overall_passed=overall_passed,
    )

    # Update photo records
    for photo in [before_photo, after_photo]:
        supabase.table("verification_photos").update({
            "fraud_check_passed": overall_passed,
            "fraud_check_notes": result.notes,
        }).eq("id", photo["id"]).execute()

    # If verification passed, update ticket status
    if overall_passed:
        supabase.table("master_tickets").update({
            "status": "RESOLVED_PENDING_CITIZEN",
        }).eq("id", request.master_ticket_id).execute()

        logger.info(f"Ticket {request.master_ticket_id} verified — awaiting citizen confirmation")

    return result


@router.post("/citizen-response")
async def citizen_verify_resolution(request: CitizenResponseRequest):
    """
    Citizen confirms or reopens a resolved ticket.
    'verified' → RESOLVED, 'reopen' → REOPENED
    """
    supabase = get_supabase_client()

    if request.response.lower() not in ("verified", "reopen"):
        raise HTTPException(status_code=400, detail="Response must be 'verified' or 'reopen'")

    if request.response.lower() == "verified":
        from datetime import datetime, timezone
        supabase.table("master_tickets").update({
            "status": "RESOLVED",
            "resolved_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", request.master_ticket_id).execute()

        return {"status": "RESOLVED", "message": "Thank you for confirming the resolution!"}
    else:
        supabase.table("master_tickets").update({
            "status": "REOPENED",
        }).eq("id", request.master_ticket_id).execute()

        return {"status": "REOPENED", "message": "Ticket has been reopened. An officer will be reassigned."}
