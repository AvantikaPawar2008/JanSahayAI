"""Service for managing the immutable ticket_events audit log.

Every status change, automated model decision, verification pass/fail, and citizen
sign-off writes an append-only event record for complete non-repudiation, RTI compliance,
and threshold auditing.
"""

import logging
from typing import Optional, Dict, Any
from backend.db.supabase_client import get_supabase_client

logger = logging.getLogger("civicpulse.events")


def record_ticket_event(
    ticket_id: str,
    event_type: str,
    actor_id: Optional[str] = None,
    actor_role: str = "system",
    metadata: Optional[Dict[str, Any]] = None,
    model_version: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Appends an immutable event to the ticket_events audit table.
    Fails safely: logs error if table write fails without breaking main pipeline.
    """
    try:
        supabase = get_supabase_client()
        event_payload = {
            "ticket_id": ticket_id,
            "event_type": event_type,
            "actor_id": actor_id,
            "actor_role": actor_role,
            "metadata": metadata or {},
            "model_version": model_version,
        }
        res = supabase.table("ticket_events").insert(event_payload).execute()
        if res.data:
            logger.info(f"Audit event '{event_type}' recorded for ticket {ticket_id}")
            return res.data[0]
        return None
    except Exception as exc:
        logger.error(f"Failed to record ticket_event '{event_type}' for ticket {ticket_id}: {exc}")
        return None


def get_ticket_event_history(ticket_id: str) -> list[Dict[str, Any]]:
    """Fetches the complete chronological event audit trail for a master ticket."""
    try:
        supabase = get_supabase_client()
        res = (
            supabase.table("ticket_events")
            .select("*")
            .eq("ticket_id", ticket_id)
            .order("created_at", desc=False)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        logger.error(f"Failed to retrieve event history for ticket {ticket_id}: {exc}")
        return []
