"""
seed_demo_data.py — Pre-built Hackathon Seed Script for JanSahayAI

1. Deletes all pre-existing tickets, reports, photos, and hotspots (clean state).
2. Seeds 12 realistic municipal tickets in Pune across all 5 departments:
   - Roads & Infrastructure (Includes a 3-ticket cluster on FC Road for DBSCAN)
   - Water Supply & Sewerage (Includes a 3-ticket cluster in Kothrud for DBSCAN)
   - Solid Waste Management
   - Electrical & Streetlighting
   - Health & Sanitation
3. Seeds realistic priority scores, SLA components, and reverse-geocoded addresses.
4. Includes varied statuses: OPEN, IN_PROGRESS, RESOLVED_PENDING_CITIZEN (for citizen verify demo),
   and one needs_admin_review ticket (for admin reassignment demo).
5. Automatically triggers DBSCAN clustering to generate live Hotspot Alerts.
"""

import os
import sys
import asyncio
from datetime import datetime, timezone, timedelta

# UTF-8 stdout for Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Add root directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend", ".env"))

from supabase import create_client
from backend.services.priority_service import compute_priority_components
from backend.services.hotspot_service import detect_hotspots

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def delete_existing_data():
    print("\n" + "=" * 65)
    print("[STEP 1/3] Deleting all pre-existing tickets, reports, and hotspots...")
    print("=" * 65)

    tables = [
        "verification_photos",
        "ticket_reports",
        "hotspot_alerts",
        "master_tickets",
    ]

    for table in tables:
        try:
            supabase.table(table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            print(f"  [CLEARED] Table '{table}' emptied.")
        except Exception as e:
            print(f"  [WARN] Note clearing '{table}': {e}")

    print("  [OK] Clean state established.")


async def seed_demo_tickets():
    print("\n" + "=" * 65)
    print("[STEP 2/3] Seeding high-fidelity Pune municipal tickets...")
    print("=" * 65)

    now = datetime.now(timezone.utc)

    # 12 Curated tickets with realistic Pune coordinates and department distributions
    seed_tickets = [
        # --- CLUSTER 1: ROADS & INFRASTRUCTURE (FC Road, Shivajinagar) ---
        {
            "category": "Pothole",
            "sub_category": "Pothole",
            "department": "Roads & Infrastructure",
            "urgency": "CRITICAL",
            "status": "OPEN",
            "lat": 18.5204,
            "lng": 73.8415,
            "address_text": "Fergusson College Rd, Near Goodluck Cafe, Shivajinagar, Pune",
            "description": "Massive 2-foot deep pothole cluster right outside Goodluck Cafe causing severe vehicular traffic jams and two-wheeler skidding.",
            "upvote_count": 6,
            "created_offset_hours": 3,
            "sop_steps": ["Inspect crater depth", "Set up warning barricades", "Fill with rapid-hardening asphalt cold-mix", "Compact with roller"],
            "tools_required": ["Asphalt Cold Mix", "Compactor Roller", "Traffic Cones", "Depth Gauge"],
            "needs_admin_review": False,
        },
        {
            "category": "Pothole",
            "sub_category": "Pothole",
            "department": "Roads & Infrastructure",
            "urgency": "HIGH",
            "status": "IN_PROGRESS",
            "lat": 18.5208,
            "lng": 73.8419,
            "address_text": "Opposite FC College Main Gate, FC Road, Pune",
            "description": "Asphalt subsidence and broken road edge near college gate creating hazard for cyclists and pedestrians.",
            "upvote_count": 4,
            "created_offset_hours": 5,
            "sop_steps": ["Inspect road edge", "Barricade lane", "Apply bitumen binder", "Resurface top layer"],
            "tools_required": ["Bitumen Emulsion", "Tamping Rammer", "Safety Cones"],
            "needs_admin_review": False,
        },
        {
            "category": "Road Damage",
            "sub_category": "Road Damage",
            "department": "Roads & Infrastructure",
            "urgency": "HIGH",
            "status": "OPEN",
            "lat": 18.5201,
            "lng": 73.8412,
            "address_text": "FC Road & Deccan Gymkhana Corner, Shivajinagar, Pune",
            "description": "Multiple potholes after recent cable trenching left unpaved at the Deccan junction turn.",
            "upvote_count": 3,
            "created_offset_hours": 8,
            "sop_steps": ["Level trenching gravel", "Apply asphalt patch", "Test surface grade"],
            "tools_required": ["Asphalt Mix", "Hand Roller", "Warning Board"],
            "needs_admin_review": False,
        },
        {
            "category": "Pothole",
            "sub_category": "Pothole",
            "department": "Roads & Infrastructure",
            "urgency": "CRITICAL",
            "status": "OPEN",
            "lat": 18.5206,
            "lng": 73.8417,
            "address_text": "FC Road, Near Starbucks, Shivajinagar, Pune",
            "description": "Deep asphalt crater in middle lane causing rapid braking and near collisions during evening peak hours.",
            "upvote_count": 5,
            "created_offset_hours": 2,
            "sop_steps": ["Place emergency barrier", "Excavate loose gravel", "Fill with cold asphalt binder"],
            "tools_required": ["Asphalt Cold Mix", "Tamping Tool", "Reflective Cones"],
            "needs_admin_review": False,
        },
        {
            "category": "Pothole",
            "sub_category": "Pothole",
            "department": "Roads & Infrastructure",
            "urgency": "HIGH",
            "status": "OPEN",
            "lat": 18.5202,
            "lng": 73.8414,
            "address_text": "FC Road, Near Vaishali Restaurant, Pune",
            "description": "Rainwater-filled pothole concealing sharp road edge. Multiple complaints of vehicle wheel rim damage.",
            "upvote_count": 4,
            "created_offset_hours": 6,
            "sop_steps": ["Dewater depression", "Fill road base with crushed stone", "Seal with hot bitumen"],
            "tools_required": ["Water Pump", "Crushed Stone Aggregates", "Bitumen Sprayer"],
            "needs_admin_review": False,
        },

        # --- CLUSTER 2: WATER SUPPLY & SEWERAGE (Kothrud, Pune) ---
        {
            "category": "Water Leakage",
            "sub_category": "Pipe Leak",
            "department": "Water Supply & Sewerage",
            "urgency": "CRITICAL",
            "status": "OPEN",
            "lat": 18.5074,
            "lng": 73.8077,
            "address_text": "Near MIT World Peace University, Karve Road, Kothrud, Pune",
            "description": "Major drinking water pipeline rupture spraying water across Karve Road. High clean water wastage and street flooding.",
            "upvote_count": 8,
            "created_offset_hours": 2,
            "sop_steps": ["Isolate upstream control valve", "Excavate pipe section", "Install pipe clamp sleeve or replace section", "Pressure test and backfill"],
            "tools_required": ["Excavator/Backhoe", "Pipe Clamp Collar (150mm)", "Hydraulic Pump", "Trench Shoring"],
            "needs_admin_review": False,
        },
        {
            "category": "Water Leakage",
            "sub_category": "Pipe Leak",
            "department": "Water Supply & Sewerage",
            "urgency": "HIGH",
            "status": "OPEN",
            "lat": 18.5078,
            "lng": 73.8082,
            "address_text": "Mayur Colony Lane 3, Kothrud, Pune",
            "description": "Continuous water stream emerging from sidewalk joint. Ward 28 resident pressure dropped.",
            "upvote_count": 4,
            "created_offset_hours": 4,
            "sop_steps": ["Detect leak point with acoustic sensor", "Expose connection", "Replace damaged ferrule"],
            "tools_required": ["Acoustic Leak Detector", "Pipe Wrenches", "Ferrule Fitting"],
            "needs_admin_review": False,
        },
        {
            "category": "Water Contamination",
            "sub_category": "Contamination",
            "department": "Water Supply & Sewerage",
            "urgency": "HIGH",
            "status": "ASSIGNED",
            "lat": 18.5071,
            "lng": 73.8072,
            "address_text": "Paud Phata Junction, Karve Road, Kothrud, Pune",
            "description": "Muddy tap water supplied in morning cycle. Possible cross-contamination with nearby storm drain.",
            "upvote_count": 5,
            "created_offset_hours": 6,
            "sop_steps": ["Collect water samples for lab", "Flush distribution main", "Inspect cross-connection valves"],
            "tools_required": ["Water Sampling Kit", "Chlorine Test Meter", "Valve Key"],
            "needs_admin_review": False,
        },
        {
            "category": "Water Leakage",
            "sub_category": "Pipe Leak",
            "department": "Water Supply & Sewerage",
            "urgency": "CRITICAL",
            "status": "OPEN",
            "lat": 18.5076,
            "lng": 73.8079,
            "address_text": "Karve Road City Bus Stop, Kothrud, Pune",
            "description": "Fresh water flooding pedestrian waiting shelter from ruptured underground branch connection.",
            "upvote_count": 6,
            "created_offset_hours": 3,
            "sop_steps": ["Shut off branch isolation stopcock", "Sleeve damaged pipe joint", "Restore flow"],
            "tools_required": ["Valve Key", "Socket Sleeves", "Dewatering Sump"],
            "needs_admin_review": False,
        },
        {
            "category": "Water Leakage",
            "sub_category": "Pipe Leak",
            "department": "Water Supply & Sewerage",
            "urgency": "HIGH",
            "status": "OPEN",
            "lat": 18.5073,
            "lng": 73.8075,
            "address_text": "Near Krishna Hospital, Karve Road, Kothrud, Pune",
            "description": "Subterranean leak bubbling through road asphalt, causing road surface softening and potholing.",
            "upvote_count": 4,
            "created_offset_hours": 5,
            "sop_steps": ["Dig exploratory pit", "Inspect cast iron main", "Clamp or replace section"],
            "tools_required": ["Jackhammer", "Pneumatic Compressor", "Pipeline Repair Clamp"],
            "needs_admin_review": False,
        },

        # --- SOLID WASTE MANAGEMENT (Model Colony & Shukrawar Peth) ---
        {
            "category": "Garbage",
            "sub_category": "Garbage Overflow",
            "department": "Solid Waste Management",
            "urgency": "MEDIUM",
            "status": "OPEN",
            "lat": 18.5314,
            "lng": 73.8446,
            "address_text": "Model Colony 4th Cross, Shivajinagar, Pune",
            "description": "Community bin overflowing for 3 days. Stray dogs scattering waste across residential walkway.",
            "upvote_count": 3,
            "created_offset_hours": 12,
            "sop_steps": ["Deploy compactor truck", "Clear bin overflow", "Sanitize ground perimeter with lime"],
            "tools_required": ["Garbage Compactor Truck", "Shovels", "Disinfectant Spray"],
            "needs_admin_review": False,
        },
        {
            "category": "Illegal Dumping",
            "sub_category": "Illegal Dumping",
            "department": "Solid Waste Management",
            "urgency": "HIGH",
            "status": "OPEN",
            "lat": 18.5123,
            "lng": 73.8567,
            "address_text": "Mahatma Phule Mandai, Shukrawar Peth, Pune",
            "description": "Large dump of rotting vegetable waste and plastic crates blocking market lane.",
            "upvote_count": 5,
            "created_offset_hours": 10,
            "sop_steps": ["Segregate organic mass", "Load onto dumper", "Hose down street with jet cleaner"],
            "tools_required": ["Dumper Truck", "High-Pressure Water Jet", "Safety Masks"],
            "needs_admin_review": False,
        },

        # --- ELECTRICAL & STREETLIGHTING (Baner & Erandwane) ---
        {
            "category": "Streetlight",
            "sub_category": "Dark Spot",
            "department": "Electrical & Streetlighting",
            "urgency": "HIGH",
            "status": "IN_PROGRESS",
            "lat": 18.5590,
            "lng": 73.7868,
            "address_text": "Baner High Street, Baner, Pune",
            "description": "Entire 200m stretch of LED streetlights unlit for 48 hours creating dangerous dark spot for evening pedestrians.",
            "upvote_count": 7,
            "created_offset_hours": 14,
            "sop_steps": ["Inspect feeder pillar fuse", "Check underground phase continuity", "Replace blown capacitor unit"],
            "tools_required": ["Multimeter", "Insulated Toolkit", "Sky-lift Crane Truck", "LED Driver Module"],
            "needs_admin_review": False,
        },
        {
            "category": "Exposed Wire",
            "sub_category": "Exposed Wire",
            "department": "Electrical & Streetlighting",
            "urgency": "CRITICAL",
            "status": "OPEN",
            "lat": 18.5089,
            "lng": 73.8258,
            "address_text": "Near SNDT Women's College, Erandwane, Pune",
            "description": "Damaged streetlight inspection door with live insulated copper wires exposed at waist height near footpath.",
            "upvote_count": 4,
            "created_offset_hours": 1,
            "sop_steps": ["De-energize circuit loop", "Insulate bare connections", "Lock and weld pole junction door"],
            "tools_required": ["Voltage Detector", "Insulating Heat-shrink Tape", "Junction Box Key"],
            "needs_admin_review": False,
        },

        # --- HEALTH & SANITATION (Viman Nagar & Swargate) ---
        {
            "category": "Stagnant Water",
            "sub_category": "Stagnant Water",
            "department": "Health & Sanitation",
            "urgency": "MEDIUM",
            "status": "RESOLVED_PENDING_CITIZEN",  # Perfect for citizen verification demo!
            "lat": 18.5679,
            "lng": 73.9143,
            "address_text": "Viman Nagar Road, Near Phoenix Marketcity, Pune",
            "description": "Stagnant water puddle accumulating near market turn. Field team treated with anti-larval spray. Awaiting citizen verification.",
            "upvote_count": 2,
            "created_offset_hours": 24,
            "sop_steps": ["Clear drain inlet", "Spray BTI anti-larval chemical", "Document photo of dry surface"],
            "tools_required": ["Knapsack Chemical Sprayer", "Drain Hoe"],
            "needs_admin_review": False,
        },

        # --- MISCLASSIFIED TICKET (Needs Admin Review Demo) ---
        {
            "category": "General Civic Issue",
            "sub_category": "General",
            "department": "Health & Sanitation",  # Incorrectly routed! Admin can reassign to Roads
            "urgency": "MEDIUM",
            "status": "OPEN",
            "lat": 18.5290,
            "lng": 73.8520,
            "address_text": "Narayan Peth, Laxmi Road Junction, Pune",
            "description": "Broken stone paver blocks and loose cement slab near shop entrance causing pedestrian tripping.",
            "upvote_count": 1,
            "created_offset_hours": 6,
            "sop_steps": ["Reassign to Roads Department", "Replace cracked paving stones", "Cement mortar finish"],
            "tools_required": ["Masonry Trowel", "Paver Blocks", "Cement Mix"],
            "needs_admin_review": True,  # Will show up on Admin Dashboard Misclassified Panel!
        },
    ]

    inserted_count = 0
    for t_data in seed_tickets:
        created_time = now - timedelta(hours=t_data.pop("created_offset_hours"))
        
        # Calculate dynamic priority components
        priority_info = compute_priority_components(
            created_at=created_time,
            urgency=t_data["urgency"],
            duplicate_count=t_data["upvote_count"],
        )

        record = {
            **t_data,
            "created_at": created_time.isoformat(),
            "priority_score": priority_info["priority_score"],
            "priority_sla_component": priority_info["priority_sla_component"],
            "priority_urgency_component": priority_info["priority_urgency_component"],
            "priority_duplicate_component": priority_info["priority_duplicate_component"],
        }

        try:
            res = supabase.table("master_tickets").insert(record).execute()
            if res.data and len(res.data) > 0:
                ticket_id = res.data[0]["id"]
                inserted_count += 1
                
                # Insert initial ticket_report
                supabase.table("ticket_reports").insert({
                    "master_ticket_id": ticket_id,
                    "raw_text": t_data["description"],
                    "lat": t_data["lat"],
                    "lng": t_data["lng"],
                    "location_source": "manual",
                    "created_at": created_time.isoformat(),
                }).execute()

                print(f"  [INSERTED] [{t_data['department']}] {t_data['category']} — {t_data['address_text'][:45]}... (Score: {priority_info['priority_score']})")
        except Exception as err:
            print(f"  [ERROR] Inserting {t_data['category']}: {err}")

    print(f"\n  [OK] Successfully seeded {inserted_count} high-fidelity tickets.")


async def run_hotspot_clustering():
    print("\n" + "=" * 65)
    print("[STEP 3/3] Running DBSCAN spatial clustering to initialize Hotspots...")
    print("=" * 65)

    from backend.services.hotspot_service import analyze_hotspot_root_cause

    try:
        # Run clustering RPC with min_pts=3 to guarantee clusters are formed
        result = supabase.rpc(
            "detect_hotspot_clusters",
            {
                "eps_meters": 150.0,
                "min_pts": 3,
                "hours_window": 72,
            },
        ).execute()

        raw_clusters = result.data or []
        print(f"  [DBSCAN FOUND] {len(raw_clusters)} spatial clusters identified.")

        created_alerts = []
        for cluster in raw_clusters:
            alert_data = {
                "category": cluster["category"],
                "sub_category": cluster.get("sub_category"),
                "department": cluster.get("department"),
                "center_lat": cluster["center_lat"],
                "center_lng": cluster["center_lng"],
                "radius_m": cluster.get("radius_m", 100),
                "ticket_count": cluster["ticket_count"],
                "ticket_ids": cluster.get("ticket_ids", []),
                "status": "NEW",
            }
            ins = supabase.table("hotspot_alerts").insert(alert_data).execute()
            if ins.data:
                alert_id = ins.data[0]["id"]
                created_alerts.append(alert_id)
                print(f"  [HOTSPOT CREATED] {cluster['category']} ({cluster.get('department')}) — {cluster['ticket_count']} tickets clustered.")
                
                # Pre-generate AI root-cause analysis so it's ready for presentation
                try:
                    analysis = await analyze_hotspot_root_cause(alert_id)
                    print(f"    -> [AI ROOT CAUSE READY] Generated for alert {alert_id[:8]}...")
                except Exception as ana_err:
                    print(f"    -> [NOTE] Root cause analysis skipped: {ana_err}")

        print(f"\n  [OK] Successfully primed {len(created_alerts)} active Hotspot Alerts.")

    except Exception as e:
        print(f"  [WARN] Note running clustering: {e}")


async def main():
    print("=" * 65)
    print(" JANSAHAYAI HACKATHON SEED PIPELINE ")
    print("=" * 65)

    delete_existing_data()
    await seed_demo_tickets()
    await run_hotspot_clustering()

    print("\n" + "=" * 65)
    print(" [READY] Database is fully primed for your live Hackathon presentation!")
    print("=" * 65)
    print("Test User Credentials:")
    print("  • Officer (Roads & Infra): officer@pune.gov.in / Password@123")
    print("  • Admin (City Telemetry):  admin@pune.gov.in   / Password@123")
    print("  • Citizen:                 citizen@pune.gov.in / Password@123")
    print("=" * 65)


if __name__ == "__main__":
    asyncio.run(main())
