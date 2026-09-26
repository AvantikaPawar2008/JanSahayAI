"""Before/after photo verification with anti-fraud checks (geofence + VLM).

Updated (Migration 009):
- Uses verify_repair_photo() which branches on master_ticket.has_before_photo:
    * True  → before/after visual comparison (high confidence)
    * False → single-image completion check (lower confidence, but GPS still mandatory)
- Stores verification_method on the 'after' verification_photo row.
- Sets needs_admin_review=True for CRITICAL tickets that pass via single-photo fallback
  (weakest automated confidence + highest stakes = supervisor escalation).
- Officer-self-correction endpoint: POST /reopen-by-officer
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.db.supabase_client import get_supabase_client
from backend.services.geo_service import is_within_geofence
from backend.services.vision_service import verify_repair_photo, compare_before_after
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


class OfficerReopenRequest(BaseModel):
    """Officer catches their own mistake and reverts to IN_PROGRESS before citizen sees it."""
    master_ticket_id: str
    officer_id: Optional[str] = None
    reason: str  # Short explanation required


@router.post("/photo", response_model=VerificationResult)
async def verify_before_after(request: VerifyPhotoRequest):
    """
    Runs anti-fraud checks on the most recent 'after' photo submitted for a ticket.

    Check 1 — GPS geofence (mandatory, both paths):
        After-photo GPS must be within 150m of ticket location.
    Check 2 — VLM structural check (branches on has_before_photo):
        * has_before_photo=True  → compare before vs. after (high confidence)
        * has_before_photo=False → judge completion from after photo alone (fallback)

    On pass → sets ticket to RESOLVED_PENDING_CITIZEN.
    CRITICAL + single-photo fallback → sets needs_admin_review=True (supervisor must confirm).
    Stores verification_method on the after-photo record so officers see which tier was used.
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

    # Get the most recent 'after' photo
    photos_result = (
        supabase.table("verification_photos")
        .select("*")
        .eq("master_ticket_id", request.master_ticket_id)
        .order("captured_at", desc=True)
        .execute()
    )

    photos = photos_result.data or []
    after_photos = [p for p in photos if p["photo_type"] == "after"]

    if not after_photos:
        raise HTTPException(status_code=400, detail="No 'after' photo found — officer must submit an after photo first")

    after_photo = after_photos[0]

    # ------------------------------------------------------------------
    # Check 1: Geofence — is the after photo within 150m of the ticket?
    # This check is MANDATORY regardless of verification path.
    # ------------------------------------------------------------------
    after_within, after_distance = is_within_geofence(
        after_photo["lat"], after_photo["lng"],
        ticket["lat"], ticket["lng"],
    )

    if not after_within:
        notes = f"After photo GPS is {after_distance:.0f}m from ticket location (max 150m allowed)"
        result = VerificationResult(
            geofence_passed=False,
            vision_check_passed=False,
            same_location=False,
            defect_resolved=False,
            confidence=0.0,
            notes=notes,
            overall_passed=False,
            verification_method="before_after_comparison" if ticket.get("has_before_photo") else "single_photo_completion",
        )

        # Record the failure on the after photo
        supabase.table("verification_photos").update({
            "fraud_check_passed": False,
            "fraud_check_notes": notes,
        }).eq("id", after_photo["id"]).execute()

        return result

    # ------------------------------------------------------------------
    # Check 2: VLM verification (branches internally on has_before_photo)
    # ------------------------------------------------------------------
    try:
        vlm_result = await verify_repair_photo(
            master_ticket=ticket,
            after_photo_url=after_photo["image_url"],
        )
    except Exception as exc:
        logger.error(f"verify_repair_photo failed for ticket {request.master_ticket_id}: {exc}")
        vlm_result = {
            "passed": False,
            "notes": f"Vision check error: {str(exc)}",
            "verification_method": "before_after_comparison" if ticket.get("has_before_photo") else "single_photo_completion",
            "same_location": True,
            "defect_resolved": False,
            "repair_quality": "UNKNOWN",
            "confidence": 0.0,
            "needs_supervisor_review": False,
        }

    method = vlm_result["verification_method"]
    overall_passed = after_within and vlm_result["passed"]
    needs_supervisor = vlm_result.get("needs_supervisor_review", False)

    result = VerificationResult(
        geofence_passed=after_within,
        vision_check_passed=vlm_result["passed"],
        same_location=vlm_result.get("same_location", True),
        defect_resolved=vlm_result.get("defect_resolved", vlm_result["passed"]),
        repair_quality=vlm_result.get("repair_quality"),
        confidence=vlm_result.get("confidence", 0.0),
        notes=vlm_result.get("notes", ""),
        overall_passed=overall_passed,
        verification_method=method,
    )

    # Store method + result on the after-photo record
    supabase.table("verification_photos").update({
        "fraud_check_passed": overall_passed,
        "fraud_check_notes": result.notes,
        "verification_method": method,
    }).eq("id", after_photo["id"]).execute()

    # Also stamp method on the before-photo if it exists
    before_photos = [p for p in photos if p["photo_type"] == "before"]
    if before_photos:
        supabase.table("verification_photos").update({
            "fraud_check_passed": overall_passed,
            "fraud_check_notes": result.notes,
        }).eq("id", before_photos[0]["id"]).execute()

    if overall_passed:
        ticket_update = {"status": "RESOLVED_PENDING_CITIZEN"}
        if needs_supervisor:
            # CRITICAL + single-photo fallback → flag for admin/supervisor review
            ticket_update["needs_admin_review"] = True
            logger.warning(
                f"Ticket {request.master_ticket_id} passed single-photo verification but is CRITICAL — "
                "flagging for supervisor review."
            )

        supabase.table("master_tickets").update(ticket_update).eq(
            "id", request.master_ticket_id
        ).execute()

        logger.info(
            f"Ticket {request.master_ticket_id} verification PASSED via {method} — "
            f"awaiting citizen confirmation"
            + (" [supervisor review requested]" if needs_supervisor else "")
        )
    else:
        logger.info(
            f"Ticket {request.master_ticket_id} verification FAILED via {method} — "
            f"status remains unchanged"
        )

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
        update_data = {
            "status": "RESOLVED",
            "resolved_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            supabase.table("master_tickets").update(update_data).eq("id", request.master_ticket_id).execute()
        except Exception as e:
            if "resolved_at" in str(e):
                update_data.pop("resolved_at", None)
                supabase.table("master_tickets").update(update_data).eq("id", request.master_ticket_id).execute()
            else:
                raise e

        return {"status": "RESOLVED", "message": "Thank you for confirming the resolution!"}
    else:
        update_data = {
            "status": "REOPENED",
            "needs_admin_review": True,
        }
        supabase.table("master_tickets").update(update_data).eq("id", request.master_ticket_id).execute()

        from backend.services.priority_service import update_ticket_priority
        try:
            update_ticket_priority(request.master_ticket_id)
        except Exception:
            pass

        return {"status": "REOPENED", "message": "Ticket has been reopened. An officer will be reassigned."}


@router.post("/reopen-by-officer")
async def officer_self_correction_reopen(request: OfficerReopenRequest):
    """
    Officer catches their own mistake after a passed verification and reverts the ticket
    to IN_PROGRESS before the citizen sees the 'awaiting confirmation' notification.

    This is NOT a close/resolve action — it's a self-correction that puts the ticket
    back in the officer's own queue so they can re-do the repair properly.

    Requirements:
    - Ticket must be in RESOLVED_PENDING_CITIZEN status.
    - A non-empty reason must be provided.
    - Sets reopened_by = 'officer_self_correction' (stored in fraud_check_notes on latest photo).
    """
    supabase = get_supabase_client()

    if not request.reason or not request.reason.strip():
        raise HTTPException(status_code=400, detail="A reason is required for officer self-correction reopen")

    # Verify current status
    ticket_res = (
        supabase.table("master_tickets")
        .select("id, status")
        .eq("id", request.master_ticket_id)
        .single()
        .execute()
    )
    if not ticket_res.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    current_status = ticket_res.data.get("status")
    if current_status != "RESOLVED_PENDING_CITIZEN":
        raise HTTPException(
            status_code=409,
            detail=f"Officer self-correction is only allowed when ticket is RESOLVED_PENDING_CITIZEN. Current status: {current_status}"
        )

    # Revert to IN_PROGRESS
    supabase.table("master_tickets").update({
        "status": "IN_PROGRESS",
    }).eq("id", request.master_ticket_id).execute()

    # Annotate the most recent after-photo with the correction note
    photos_res = (
        supabase.table("verification_photos")
        .select("id")
        .eq("master_ticket_id", request.master_ticket_id)
        .eq("photo_type", "after")
        .order("captured_at", desc=True)
        .limit(1)
        .execute()
    )
    if photos_res.data:
        correction_note = f"[officer_self_correction] {request.reason.strip()}"
        supabase.table("verification_photos").update({
            "fraud_check_passed": False,
            "fraud_check_notes": correction_note,
        }).eq("id", photos_res.data[0]["id"]).execute()

    logger.info(
        f"Officer self-correction reopen for ticket {request.master_ticket_id} "
        f"(officer={request.officer_id}, reason='{request.reason[:80]}')"
    )

    return {
        "status": "IN_PROGRESS",
        "message": "Ticket reverted to IN_PROGRESS. Please re-submit corrected proof of work.",
        "reopened_by": "officer_self_correction",
        "reason": request.reason,
    }
