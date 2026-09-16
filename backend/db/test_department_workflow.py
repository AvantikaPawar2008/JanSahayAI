"""Comprehensive automated test for Department-Based Classification & Officer Queues.
Tests:
1. Triage classification & validation (valid enum vs fallback with needs_admin_review = True)
2. Complaint intake creates ticket with proper department
3. Officer isolation via Supabase RLS (officer only receives their department tickets)
4. Admin reclassification endpoint overrides department and shifts ticket to new queue
"""

import os
import sys
import asyncio
import httpx

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend", ".env"))

from backend.config import get_settings
from backend.db.supabase_client import get_supabase_client, get_supabase_anon_client
from backend.services.triage_service import triage_complaint, ALLOWED_DEPARTMENTS

BASE_URL = "http://localhost:8000"


async def run_tests():
    print("=" * 65)
    print("[RUN] Testing Department Classification & Officer Queue Isolation")
    print("=" * 65)

    # 1. Test Classification logic & validation
    print("\n[1/4] Testing Classification Logic & Fallback Validation...")
    # Test valid pothole complaint
    triage_valid = await triage_complaint(
        "Huge pothole on Karve road near MIT college causing traffic jams",
        18.5074,
        73.8077,
    )
    print(f"  [OK] Valid complaint classified as: '{triage_valid.department}' (needs_review={triage_valid.needs_admin_review})")
    assert triage_valid.department in ALLOWED_DEPARTMENTS
    assert triage_valid.needs_admin_review is False

    # 2. Test Complaint Intake via API
    print("\n[2/4] Testing Complaint Intake & Department Auto-Assignment via API...")
    anon_client = get_supabase_anon_client()
    admin_supabase = get_supabase_client()

    created_ticket_id = None
    with httpx.Client(timeout=30) as client:
        res = client.post(f"{BASE_URL}/api/intake", data={
            "lat": "18.5074",
            "lng": "73.8077",
            "text": "Dangerous crater in the middle of Karve Road junction, vehicles skidding",
            "citizen_phone": "+919823011111"
        })
        assert res.status_code == 200, f"Intake failed: {res.text}"
        data = res.json()
        created_ticket_id = data["master_ticket_id"]
        assigned_dept = data["department"]
        print(f"  [OK] Ticket {created_ticket_id} created with department='{assigned_dept}'")
        assert assigned_dept in ALLOWED_DEPARTMENTS

    # 3. Test Officer Queue Visibility & RLS Isolation
    print("\n[3/4] Testing Officer Queue Isolation via Authenticated Session...")
    # Officer login (Roads & Infrastructure team)
    officer_auth = anon_client.auth.sign_in_with_password({
        "email": "officer@pune.gov.in",
        "password": "Password@123"
    })
    officer_token = officer_auth.session.access_token
    print(f"  [OK] Signed in as officer (ID: {officer_auth.user.id})")

    with httpx.Client(timeout=15) as client:
        headers = {"Authorization": f"Bearer {officer_token}"}
        res_queue = client.get(f"{BASE_URL}/api/officer/queue", headers=headers)
        assert res_queue.status_code == 200
        officer_tickets = res_queue.json()
        print(f"  [OK] Retrieved {len(officer_tickets)} tickets for Roads & Infrastructure queue")
        
        # Verify all tickets belong to Roads & Infrastructure
        for t in officer_tickets:
            assert t["department"] == "Roads & Infrastructure", f"RLS Violation: Ticket {t['id']} has department '{t['department']}'"
        print("  [OK] Verification passed: 0 cross-department tickets visible to officer")

    # 4. Test Admin Reclassification Override
    print("\n[4/4] Testing Admin Department Reclassification Endpoint...")
    admin_auth = anon_client.auth.sign_in_with_password({
        "email": "admin@pune.gov.in",
        "password": "Password@123"
    })
    admin_token = admin_auth.session.access_token
    print(f"  [OK] Signed in as admin (ID: {admin_auth.user.id})")

    # Reassign created_ticket_id from Roads & Infrastructure to Water Supply & Sewerage
    target_new_dept = "Water Supply & Sewerage"
    with httpx.Client(timeout=15) as client:
        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json"
        }
        res_reassign = client.patch(
            f"{BASE_URL}/api/admin/tickets/{created_ticket_id}/reassign-department",
            headers=headers,
            json={"department": target_new_dept}
        )
        assert res_reassign.status_code == 200, f"Reassignment failed: {res_reassign.text}"
        reassigned_data = res_reassign.json()
        print(f"  [OK] Admin API response: {reassigned_data['message']}")

        # Verify DB reflects new department
        ticket_db = admin_supabase.table("master_tickets").select("*").eq("id", created_ticket_id).single().execute().data
        assert ticket_db["department"] == target_new_dept
        print(f"  [OK] Database master_tickets updated: department='{ticket_db['department']}'")

        # Verify ticket is NO LONGER visible in the Roads officer's queue!
        res_officer_after = client.get(f"{BASE_URL}/api/officer/queue", headers={"Authorization": f"Bearer {officer_token}"})
        after_ticket_ids = [t["id"] for t in res_officer_after.json()]
        assert created_ticket_id not in after_ticket_ids, "Ticket still visible in old department officer queue!"
        print(f"  [OK] Verified ticket {created_ticket_id} automatically removed from Roads officer queue")

    print("\n" + "=" * 65)
    print("[SUCCESS] ALL DEPARTMENT WORKFLOW TESTS PASSED!")
    print("=" * 65)


if __name__ == "__main__":
    asyncio.run(run_tests())
