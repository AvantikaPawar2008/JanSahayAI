"""Clears all tickets, reports, verification photos, and hotspots from Supabase.
Leaves schema, officers, and table structures intact for real-world production use.
"""

import os
import sys

# Configure UTF-8 for Windows terminals
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend", ".env"))

from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in backend/.env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def clear_all_data():
    print("[INFO] Clearing all demo data from Supabase for real-world usage...")
    
    # Delete in order of foreign key constraints
    tables = [
        "verification_photos",
        "ticket_reports",
        "hotspot_alerts",
        "master_tickets"
    ]
    
    for table in tables:
        try:
            # Delete all rows where id is not null (matches all rows)
            res = supabase.table(table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            print(f"  [OK] Cleared table: {table}")
        except Exception as e:
            print(f"  [WARN] Warning clearing {table}: {e}")

    print("\n[SUCCESS] Database is clean and ready for real-world civic resolution complaints!")

if __name__ == "__main__":
    clear_all_data()
