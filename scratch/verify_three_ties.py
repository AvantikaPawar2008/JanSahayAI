import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from datetime import datetime, timezone, timedelta
from backend.config import get_settings
from supabase import create_client
import requests

def test_three_ties():
    settings = get_settings()
    admin_sb = create_client(settings.supabase_url, settings.supabase_service_role_key)
    anon_sb = create_client(settings.supabase_url, settings.supabase_anon_key)
    res = anon_sb.auth.sign_in_with_password({
        "email": "officer@pune.gov.in",
        "password": "Password@123"
    })
    token = res.session.access_token
    headers = {"Authorization": f"Bearer {token}"}

    now = datetime.now(timezone.utc)
    t1_time = (now - timedelta(minutes=15)).isoformat()
    t2_time = (now - timedelta(minutes=10)).isoformat()
    t3_time = (now - timedelta(minutes=5)).isoformat()

    # Create 3 tickets with identical priority score (999.00) in Roads & Infrastructure with different created_at
    created_ids = []
    for idx, t_time in enumerate([t1_time, t2_time, t3_time]):
        data = {
            "category": f"Tie-Break Test Issue #{idx+1}",
            "department": "Roads & Infrastructure",
            "urgency": "CRITICAL",
            "status": "OPEN",
            "lat": 18.5204,
            "lng": 73.8567,
            "upvote_count": 1,
            "priority_score": 999.0,
            "created_at": t_time,
            "description": f"Testing deterministic tie breaking #{idx+1}",
        }
        ins = admin_sb.table("master_tickets").insert(data).execute()
        created_ids.append(ins.data[0]["id"])

    print(f"Created 3 test tickets with identical priority score (999.0): {created_ids}")

    try:
        # Perform 3 consecutive queue fetches to confirm consistent deterministic sorting (oldest first)
        for attempt in range(3):
            r = requests.get("http://127.0.0.1:8000/api/officer/queue?sort=priority_score_desc", headers=headers)
            assert r.status_code == 200
            tickets = r.json()
            tie_tickets = [t for t in tickets if t["id"] in created_ids]
            assert len(tie_tickets) == 3, f"Expected 3 tickets, found {len(tie_tickets)}"

            # They must be in order of created_ids (t1_time oldest, then t2, then t3)
            result_ids = [t["id"] for t in tie_tickets]
            assert result_ids == created_ids, f"Attempt {attempt+1}: Ties sorted unpredictably! Got {result_ids}, expected {created_ids}"
            print(f"Attempt {attempt+1}: Successfully sorted oldest-first: {result_ids}")

        print("PASS: 3 tickets with identical priority_score consistently sort oldest-first across repeated queue refreshes!")
    finally:
        # Cleanup test tickets
        for tid in created_ids:
            admin_sb.table("master_tickets").delete().eq("id", tid).execute()
        print("Cleaned up test tickets.")

if __name__ == "__main__":
    test_three_ties()
