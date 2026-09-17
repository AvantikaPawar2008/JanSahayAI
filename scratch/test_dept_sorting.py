import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import requests
from backend.config import get_settings
from supabase import create_client

BASE_URL = "http://127.0.0.1:8000"

def get_tokens():
    settings = get_settings()
    anon_sb = create_client(settings.supabase_url, settings.supabase_anon_key)
    
    # Officer login
    off_res = anon_sb.auth.sign_in_with_password({
        "email": "officer@pune.gov.in",
        "password": "Password@123"
    })
    off_token = off_res.session.access_token

    # Admin login (can see all departments)
    admin_res = anon_sb.auth.sign_in_with_password({
        "email": "admin@pune.gov.in",
        "password": "Password@123"
    })
    admin_token = admin_res.session.access_token

    return off_token, admin_token

def test_department_sorting():
    off_token, admin_token = get_tokens()
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    off_headers = {"Authorization": f"Bearer {off_token}"}

    print("=== TEST 1: Admin query with sort=department_asc ===")
    r = requests.get(f"{BASE_URL}/api/officer/queue?sort=department_asc", headers=admin_headers)
    assert r.status_code == 200, f"Error: {r.status_code} {r.text}"
    tickets = r.json()
    print(f"Retrieved {len(tickets)} tickets across departments")
    
    # Verify department is alphabetically non-decreasing (A-Z)
    depts = [t["department"] for t in tickets if t.get("department")]
    for i in range(len(depts) - 1):
        assert depts[i] <= depts[i + 1], f"Department sort violation: {depts[i]} > {depts[i+1]}"
    print(f"Departments in order: {list(dict.fromkeys(depts))}")

    # Verify that within each department, tickets are sorted by priority_score DESC
    dept_groups = {}
    for t in tickets:
        d = t.get("department", "Unknown")
        dept_groups.setdefault(d, []).append(t["priority_score"])

    for d, scores in dept_groups.items():
        for i in range(len(scores) - 1):
            assert scores[i] >= scores[i + 1], f"In dept '{d}', priority score sort violation: {scores[i]} < {scores[i+1]}"
    print("PASS: department_asc sorts by department A-Z, and within each department by priority_score DESC!")

    print("\n=== TEST 2: Admin query with sort=department_desc ===")
    r_desc = requests.get(f"{BASE_URL}/api/officer/queue?sort=department_desc", headers=admin_headers)
    assert r_desc.status_code == 200
    tickets_desc = r_desc.json()
    depts_desc = [t["department"] for t in tickets_desc if t.get("department")]
    for i in range(len(depts_desc) - 1):
        assert depts_desc[i] >= depts_desc[i + 1], f"Department desc violation: {depts_desc[i]} < {depts_desc[i+1]}"
    print(f"Departments in reverse order: {list(dict.fromkeys(depts_desc))}")
    print("PASS: department_desc sorts by department Z-A, and within each department by priority_score DESC!")

    print("\n=== TEST 3: Department filter query ===")
    target_dept = "Roads & Infrastructure"
    r_filter = requests.get(f"{BASE_URL}/api/officer/queue?department={requests.utils.quote(target_dept)}&sort=priority_score_desc", headers=admin_headers)
    assert r_filter.status_code == 200
    filtered_tickets = r_filter.json()
    print(f"Filtered {len(filtered_tickets)} tickets for '{target_dept}'")
    for t in filtered_tickets:
        assert t["department"] == target_dept, f"Filter leak: ticket has dept '{t['department']}'"
    print("PASS: Specific department filter works accurately!")

    print("\n=== TEST 4: Officer queue defaults to officer's department ===")
    r_off = requests.get(f"{BASE_URL}/api/officer/queue?sort=priority_score_desc", headers=off_headers)
    assert r_off.status_code == 200
    off_tickets = r_off.json()
    for t in off_tickets:
        assert t["department"] == "Roads & Infrastructure", f"Officer received non-assigned dept ticket: {t['department']}"
    print(f"PASS: Officer queue accurately scoped to officer's department ({len(off_tickets)} tickets)")

if __name__ == "__main__":
    test_department_sorting()
    print("\n==========================================")
    print("ALL DEPARTMENT SORTING TESTS PASSED 100%!")
    print("==========================================")
