import os
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend", ".env"))

# pyrefly: ignore [missing-import]
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in backend/.env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

USERS = [
    {
        "email": "officer@pune.gov.in",
        "password": "Password@123",
        "full_name": "Ramesh Shinde (Junior Engineer)",
        "phone_number": "+91 98230 11223",
        "role": "officer",
        "department": "Roads & Infrastructure",
    },
    {
        "email": "admin@pune.gov.in",
        "password": "Password@123",
        "full_name": "Municipal Commissioner Office",
        "phone_number": "+91 98230 99887",
        "role": "admin",
        "department": None,
    },
    {
        "email": "citizen@pune.gov.in",
        "password": "Password@123",
        "full_name": "Pooja Patil",
        "phone_number": "+91 98230 55443",
        "role": "citizen",
        "department": None,
    }
]

def create_or_update_user(user_info):
    email = user_info["email"]
    password = user_info["password"]
    role = user_info["role"]
    dept = user_info.get("department")
    name = user_info["full_name"]
    phone = user_info.get("phone_number")

    print(f"\n[USER] Setting up {role.upper()}: {email} ...")
    user_id = None

    # Try creating user via Admin API
    try:
        res = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": name,
                "phone_number": phone,
            }
        })
        if res.user:
            user_id = res.user.id
            print(f"  [OK] Created new user account (ID: {user_id})")
    except Exception as e:
        # If user already exists, fetch their ID
        print(f"  [INFO] Account already exists or notice: {e}")
        try:
            list_res = supabase.auth.admin.list_users()
            for u in list_res:
                if u.email == email:
                    user_id = u.id
                    print(f"  [OK] Found existing user ID: {user_id}")
                    # Update password
                    supabase.auth.admin.update_user_by_id(user_id, {"password": password})
                    break
        except Exception as list_err:
            print(f"  [WARN] Could not search existing users: {list_err}")

    if not user_id:
        print(f"  [FAIL] Could not determine user ID for {email}")
        return

    # Update or insert into profiles table
    try:
        profile_data = {
            "id": user_id,
            "role": role,
            "full_name": name,
            "phone_number": phone,
            "department": dept,
        }
        res = supabase.table("profiles").upsert(profile_data).execute()
        print(f"  [OK] Profile configured with role='{role}'" + (f" and department='{dept}'" if dept else ""))
    except Exception as profile_err:
        print(f"  [WARN] Error updating profile: {profile_err}")

if __name__ == "__main__":
    print("[RUN] Creating test accounts for CivicPulse...")
    for u in USERS:
        create_or_update_user(u)
    print("\n[SUCCESS] Test credentials setup completed!")
