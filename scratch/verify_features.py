import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import asyncio
import time
import requests
from unittest.mock import patch

from backend.db.supabase_client import get_supabase_client
from backend.services.geo_service import reverse_geocode
from backend.services.priority_service import compute_priority_components

BASE_URL = "http://127.0.0.1:8000"

def get_officer_token():
    sb = get_supabase_client()
    res = sb.auth.sign_in_with_password({
        "email": "officer@pune.gov.in",
        "password": "Password@123"
    })
    return res.session.access_token

def test_reverse_geocoding():
    print("\n--- TEST 1: Reverse Geocoding & Rate Limit ---")
    t0 = time.time()
    addr1 = asyncio.run(reverse_geocode(18.5204, 73.8567))
    t1 = time.time()
    print(f"Address 1 (Pune center): {addr1} (took {t1 - t0:.2f}s)")
    assert "Pune" in addr1 or "411001" in addr1 or "Maharashtra" in addr1, f"Unexpected address: {addr1}"

    # Second call should respect 1 req/sec rate limit
    addr2 = asyncio.run(reverse_geocode(18.5314, 73.8446))
    t2 = time.time()
    elapsed = t2 - t1
    print(f"Address 2 (Shivajinagar): {addr2} (gap between calls: {elapsed:.2f}s)")
    assert elapsed >= 0.95, f"Rate limiter did not throttle: gap was {elapsed:.2f}s"

    # Test failure fallback
    with patch("httpx.AsyncClient.get", side_effect=Exception("Network error")):
        fallback = asyncio.run(reverse_geocode(18.5204, 73.8567))
        print(f"Fallback on error: {fallback}")
        assert fallback == "18.52040, 73.85670", f"Unexpected fallback: {fallback}"
    print("PASS: Reverse geocoding & fallback verified!")

def test_officer_queue_sort_and_filters():
    print("\n--- TEST 2: Officer Queue Sort & Filter Correctness ---")
    token = get_officer_token()
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Fetch default queue
    r = requests.get(f"{BASE_URL}/api/officer/queue", headers=headers)
    assert r.status_code == 200, f"Failed: {r.status_code} {r.text}"
    tickets = r.json()
    print(f"Loaded {len(tickets)} tickets from default queue")
    assert len(tickets) > 0, "No tickets found for officer"

    # Verify priority score descending sort
    scores = [t["priority_score"] for t in tickets]
    for i in range(len(scores) - 1):
        assert scores[i] >= scores[i + 1], f"Sort violation at {i}: {scores[i]} < {scores[i+1]}"
    print("PASS: Default queue is strictly sorted by priority_score DESC")

    # 2. Verify tie-breaker: tickets with equal priority_score are sorted oldest-first (created_at ASC)
    tie_found = False
    for i in range(len(tickets) - 1):
        if tickets[i]["priority_score"] == tickets[i + 1]["priority_score"]:
            tie_found = True
            t_curr = tickets[i]["created_at"]
            t_next = tickets[i + 1]["created_at"]
            assert t_curr <= t_next, f"Tiebreaker failed: {t_curr} is newer than {t_next}"
    print(f"PASS: Deterministic tiebreaker (created_at ASC) verified (ties checked: {tie_found})")

    # 3. Verify filter dropdown preserves sort: GET /api/officer/queue?urgency=CRITICAL&sort=priority_score_desc
    r_crit = requests.get(f"{BASE_URL}/api/officer/queue?urgency=CRITICAL&sort=priority_score_desc", headers=headers)
    assert r_crit.status_code == 200
    crit_tickets = r_crit.json()
    print(f"Loaded {len(crit_tickets)} CRITICAL tickets")
    for t in crit_tickets:
        assert t["urgency"] == "CRITICAL", f"Urgency filter violated: {t['urgency']}"
    crit_scores = [t["priority_score"] for t in crit_tickets]
    for i in range(len(crit_scores) - 1):
        assert crit_scores[i] >= crit_scores[i + 1], "Sort not preserved under urgency filter!"
    print("PASS: Urgency filter preserves priority_score DESC ordering")

    # 4. Verify alias /api/officer/tickets also works
    r_alias = requests.get(f"{BASE_URL}/api/officer/tickets?sort=priority_score_desc", headers=headers)
    assert r_alias.status_code == 200
    assert len(r_alias.json()) == len(tickets), "Alias /tickets returned different count than /queue"
    print("PASS: Route alias /api/officer/tickets works identically to /api/officer/queue")

    # 5. Multi-filter combination: status=OPEN AND urgency=CRITICAL (verify AND logic)
    r_multi = requests.get(f"{BASE_URL}/api/officer/queue?status=OPEN&urgency=CRITICAL&sort=priority_score_desc", headers=headers)
    assert r_multi.status_code == 200
    multi_tickets = r_multi.json()
    for t in multi_tickets:
        assert t["status"] == "OPEN", f"Status condition violated in AND: {t['status']}"
        assert t["urgency"] == "CRITICAL", f"Urgency condition violated in AND: {t['urgency']}"
    print(f"PASS: Multi-filter combinations use SQL AND logic correctly ({len(multi_tickets)} matched)")

def test_department_isolation():
    print("\n--- TEST 3: Officer Department Isolation ---")
    token = get_officer_token()
    headers = {"Authorization": f"Bearer {token}"}

    # Attempt to query another department's tickets (e.g. Health & Sanitation)
    r = requests.get(f"{BASE_URL}/api/officer/queue?department=Health%20%26%20Sanitation", headers=headers)
    assert r.status_code == 200
    other_dept_tickets = r.json()
    print(f"Queried cross-department tickets: got {len(other_dept_tickets)} tickets")
    # Officer belongs to Roads & Infrastructure, RLS prevents reading other departments
    for t in other_dept_tickets:
        assert t["department"] == "Roads & Infrastructure", f"RLS leak detected! Officer received {t['department']}"
    print("PASS: Officer department isolation verified (zero cross-department leaks)!")

def test_intake_with_reverse_geocoding():
    print("\n--- TEST 4: Ticket Intake with Reverse Geocoding ---")
    r = requests.post(
        f"{BASE_URL}/api/intake",
        data={
            "lat": 18.5204,
            "lng": 73.8567,
            "text": f"Broken street asphalt and deep pothole on Shivaji Road, Pune near Kasba Peth #{int(time.time())}",
            "citizen_phone": "+919876543210"
        }
    )
    assert r.status_code == 200, f"Intake failed: {r.status_code} {r.text}"
    data = r.json()
    print(f"Ticket created: ID={data['master_ticket_id']}, duplicate={data['is_duplicate']}")
    print(f"Address text returned: {data.get('address_text')}")
    assert data.get("address_text"), "address_text was empty in intake response!"
    assert "Pune" in data["address_text"] or "Kasba" in data["address_text"] or "411001" in data["address_text"], f"Unexpected address: {data['address_text']}"
    print("PASS: End-to-end ticket creation populated reverse-geocoded address!")

if __name__ == "__main__":
    test_reverse_geocoding()
    test_officer_queue_sort_and_filters()
    test_department_isolation()
    test_intake_with_reverse_geocoding()
    print("\n==========================================")
    print("ALL 4 AUTOMATED TEST SUITES PASSED 100%!")
    print("==========================================")
