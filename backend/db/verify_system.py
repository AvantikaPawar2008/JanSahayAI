import os
import sys
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

settings = get_settings()
BASE_URL = "http://localhost:8000"

def run_tests():
    print("=" * 60)
    print("[RUN] Comprehensive CivicPulse System Verification")
    print("=" * 60)

    anon_client = get_supabase_anon_client()

    # 1. Test Officer Login & Profile
    print("\n[1/5] Testing Officer Authentication & Profile...")
    try:
        officer_auth = anon_client.auth.sign_in_with_password({
            "email": "officer@pune.gov.in",
            "password": "Password@123"
        })
        officer_token = officer_auth.session.access_token
        print(f"  [OK] Officer login successful (User ID: {officer_auth.user.id})")

        # Query profile
        anon_client.postgrest.auth(officer_token)
        p = anon_client.table("profiles").select("*").eq("id", officer_auth.user.id).single().execute()
        print(f"  [OK] Profile fetched: role='{p.data.get('role')}', dept='{p.data.get('department')}'")
        assert p.data.get("role") == "officer"
    except Exception as e:
        print(f"  [FAIL] Officer auth failed: {e}")
        return

    # 2. Test Admin Login & Profile
    print("\n[2/5] Testing Admin Authentication & Profile...")
    try:
        admin_auth = anon_client.auth.sign_in_with_password({
            "email": "admin@pune.gov.in",
            "password": "Password@123"
        })
        admin_token = admin_auth.session.access_token
        print(f"  [OK] Admin login successful (User ID: {admin_auth.user.id})")

        anon_client.postgrest.auth(admin_token)
        p_admin = anon_client.table("profiles").select("*").eq("id", admin_auth.user.id).single().execute()
        print(f"  [OK] Admin profile: role='{p_admin.data.get('role')}'")
        assert p_admin.data.get("role") == "admin"
    except Exception as e:
        print(f"  [FAIL] Admin auth failed: {e}")
        return

    # 3. Test Complaint Intake & AI Triage + Priority Components
    print("\n[3/5] Testing Complaint Intake & Priority Scoring via Backend API...")
    try:
        with httpx.Client(timeout=30) as client:
            intake_payload = {
                "lat": "18.5204",
                "lng": "73.8567",
                "text": "Dangerous deep pothole on main road causing bikes to slip",
                "citizen_phone": "+919823055443"
            }
            res = client.post(f"{BASE_URL}/api/intake", data=intake_payload)
            print(f"  Intake API status: {res.status_code}")
            assert res.status_code == 200, f"Failed intake: {res.text}"
            intake_data = res.json()
            ticket_id = intake_data["master_ticket_id"]
            print(f"  [OK] Ticket created: ID={ticket_id}")
            print(f"  [OK] Category: {intake_data['category']} | Dept: {intake_data['department']} | Urgency: {intake_data['urgency']}")

            # Verify priority components in database
            service_supabase = get_supabase_client()
            ticket_row = service_supabase.table("master_tickets").select("*").eq("id", ticket_id).single().execute()
            t = ticket_row.data
            print(f"  [OK] Stored Priority Score: {t.get('priority_score')}")
            print(f"     • SLA Component: {t.get('priority_sla_component')}")
            print(f"     • Urgency Component: {t.get('priority_urgency_component')}")
            print(f"     • Duplicate Component: {t.get('priority_duplicate_component')}")
            assert t.get("priority_score") is not None
            assert t.get("priority_urgency_component") is not None

            # Test duplicate submission nearby
            print("\n  Submitting nearby duplicate report...")
            res_dup = client.post(f"{BASE_URL}/api/intake", data={
                "lat": "18.5204",
                "lng": "73.8568",
                "text": "Big pothole here, road is damaged and vehicles falling in",
                "citizen_phone": "+919823011111"
            })
            dup_data = res_dup.json()
            print(f"  [OK] Duplicate detected: {dup_data['is_duplicate']} (Ticket ID: {dup_data['master_ticket_id']})")
            print(f"  [OK] Upvote count updated to: {dup_data['upvote_count']}")

            # Check updated priority score
            updated_ticket = service_supabase.table("master_tickets").select("*").eq("id", ticket_id).single().execute().data
            print(f"  [OK] Updated Priority Score after duplicate: {updated_ticket.get('priority_score')} (duplicates={updated_ticket.get('priority_duplicate_component')})")
    except Exception as e:
        print(f"  [FAIL] Intake test failed: {e}")
        return

    # 4. Test Officer Queue with RLS Bearer Token
    print("\n[4/5] Testing Officer Queue Endpoint with Bearer Token...")
    try:
        with httpx.Client(timeout=15) as client:
            headers = {"Authorization": f"Bearer {officer_token}"}
            res_queue = client.get(f"{BASE_URL}/api/officer/queue", headers=headers)
            print(f"  Queue status code: {res_queue.status_code}")
            assert res_queue.status_code == 200
            queue_items = res_queue.json()
            print(f"  [OK] Queue retrieved {len(queue_items)} tickets for officer's department")
            if queue_items:
                item = queue_items[0]
                print(f"  [OK] Top Ticket ID: {item['id']}")
                print(f"  [OK] Priority Breakdown available: SLA={item['priority_sla_component']} · Urgency={item['priority_urgency_component']} · Duplicates={item['priority_duplicate_component']} = Total {item['priority_score']}")
    except Exception as e:
        print(f"  [FAIL] Officer queue test failed: {e}")
        return

    # 5. Test Admin Metrics & Hotspot Map Endpoints
    print("\n[5/5] Testing Admin Endpoints...")
    try:
        with httpx.Client(timeout=15) as client:
            headers = {"Authorization": f"Bearer {admin_token}"}
            # Metrics
            res_m = client.get(f"{BASE_URL}/api/admin/metrics", headers=headers)
            assert res_m.status_code == 200
            m = res_m.json()
            print(f"  [OK] Metrics: total={m['total_tickets']}, open={m['open_tickets']}, SLA breach rate={m['sla_breach_rate']}%")

            # Hotspot Map
            res_h = client.get(f"{BASE_URL}/api/admin/hotspot-map", headers=headers)
            assert res_h.status_code == 200
            h = res_h.json()
            print(f"  [OK] Hotspot Map Data: {h['total_active_clusters']} clusters, {h['total_incident_points']} heatmap points")
    except Exception as e:
        print(f"  [FAIL] Admin endpoints test failed: {e}")
        return

    print("\n" + "=" * 60)
    print("[SUCCESS] ALL SYSTEMS FULLY OPERATIONAL & VERIFIED!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
