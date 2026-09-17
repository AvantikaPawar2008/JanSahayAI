"""Seeds fake historical tickets around Pune so the hotspot demo works live."""

import os
import sys
import random
import uuid
from datetime import datetime, timezone, timedelta

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", ".env"))

# pyrefly: ignore [missing-import]
from supabase import create_client

# ============================================================
# Config
# ============================================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Pune center coordinates
PUNE_LAT = 18.5204
PUNE_LNG = 73.8567

# ============================================================
# Hotspot Clusters (designed to trigger DBSCAN detection)
# ============================================================
CLUSTERS = [
    {
        "name": "Kothrud Pothole Cluster",
        "center_lat": 18.5074,
        "center_lng": 73.8077,
        "category": "Pothole",
        "department": "Roads & Infrastructure",
        "urgency_pool": ["HIGH", "HIGH", "CRITICAL", "MEDIUM", "HIGH"],
        "descriptions": [
            "Massive pothole near Kothrud bus stop, 3 feet wide, dangerous for two-wheelers",
            "Road caved in near Dahanukar Colony, water accumulating inside",
            "Multiple potholes on Paud Road making driving hazardous",
            "Deep pothole near Kothrud chowk caused an accident yesterday",
            "Road surface completely broken near MIT College entrance",
            "Pothole on service road near Vanaz, bikes slipping during rain",
            "Large crater on Karve Road near Deccan Gymkhana",
        ],
        "count": 7,
    },
    {
        "name": "Hadapsar Water Leak Cluster",
        "center_lat": 18.5089,
        "center_lng": 73.9260,
        "category": "Water Leak",
        "department": "Water Supply & Sewerage",
        "urgency_pool": ["MEDIUM", "HIGH", "MEDIUM", "CRITICAL", "HIGH"],
        "descriptions": [
            "Water pipe burst on Solapur Road, flooding entire street since 2 days",
            "Underground water main leaking near Magarpatta entrance",
            "Sewage overflow near Hadapsar industrial estate, bad smell",
            "Water supply line leaking continuously at Amanora Park junction",
            "Sewage water mixing with drinking water pipe near Gawar Chowk",
            "Pipeline burst causing water logging near Hadapsar metro station",
        ],
        "count": 6,
    },
    {
        "name": "Viman Nagar Garbage Cluster",
        "center_lat": 18.5679,
        "center_lng": 73.9143,
        "category": "Garbage Dump",
        "department": "Solid Waste Management",
        "urgency_pool": ["MEDIUM", "LOW", "MEDIUM", "HIGH", "MEDIUM"],
        "descriptions": [
            "Garbage not collected for a week near Phoenix Marketcity",
            "Open garbage dump attracting stray dogs near Dutta Mandir Chowk",
            "Waste bins overflowing on Airport Road for 3 days",
            "Construction debris dumped on empty plot near Symbiosis College",
            "Garbage burning happening near Viman Nagar garden every night",
            "Food waste rotting near Eon IT Park, unbearable stench",
        ],
        "count": 6,
    },
    {
        "name": "Sinhagad Road Streetlight Cluster",
        "center_lat": 18.4800,
        "center_lng": 73.8340,
        "category": "Broken Streetlight",
        "department": "Electrical & Streetlighting",
        "urgency_pool": ["MEDIUM", "MEDIUM", "HIGH", "LOW", "HIGH"],
        "descriptions": [
            "Entire stretch of Sinhagad Road dark at night, no streetlights working",
            "Streetlight pole leaning dangerously near Manik Baug",
            "Three consecutive streetlights non-functional near Vadgaon",
            "Flickering streetlight near Anand Nagar, creating visibility issues",
            "Broken streetlight exposing live wires near Dhayari Phata — DANGEROUS",
        ],
        "count": 5,
    },
]

# Scattered individual tickets (not part of hotspots)
SCATTERED = [
    {"lat": 18.5320, "lng": 73.8480, "category": "Open Manhole", "dept": "Roads & Infrastructure", "urgency": "CRITICAL",
     "desc": "Manhole cover missing on FC Road near Good Luck Chowk, very dangerous at night"},
    {"lat": 18.5562, "lng": 73.7912, "category": "Water Leak", "dept": "Water Supply & Sewerage", "urgency": "MEDIUM",
     "desc": "Minor water leak from overhead tank near Aundh IT Park"},
    {"lat": 18.4960, "lng": 73.8670, "category": "Pothole", "dept": "Roads & Infrastructure", "urgency": "LOW",
     "desc": "Small pothole forming on Satara Road near Swargate bus stand"},
    {"lat": 18.5400, "lng": 73.8890, "category": "Garbage Dump", "dept": "Solid Waste Management", "urgency": "MEDIUM",
     "desc": "Garbage accumulated near Yerawada central jail wall"},
    {"lat": 18.5230, "lng": 73.8760, "category": "Sewage Overflow", "dept": "Health & Sanitation", "urgency": "HIGH",
     "desc": "Sewage overflowing on Camp road, health hazard for nearby shops"},
    {"lat": 18.4730, "lng": 73.8650, "category": "Broken Streetlight", "dept": "Electrical & Streetlighting", "urgency": "LOW",
     "desc": "One streetlight not working near Katraj snake park entrance"},
    {"lat": 18.5890, "lng": 73.7830, "category": "Pothole", "dept": "Roads & Infrastructure", "urgency": "MEDIUM",
     "desc": "Rough patches on highway near Hinjewadi phase 2 exit"},
    {"lat": 18.5150, "lng": 73.8300, "category": "Water Leak", "dept": "Water Supply & Sewerage", "urgency": "HIGH",
     "desc": "Fire hydrant leaking non-stop on Shivaji Road near Parvati"},
    {"lat": 18.5620, "lng": 73.8050, "category": "Garbage Dump", "dept": "Solid Waste Management", "urgency": "LOW",
     "desc": "Scattered litter near Aundh Chest Hospital garden"},
    {"lat": 18.5480, "lng": 73.8420, "category": "Broken Streetlight", "dept": "Electrical & Streetlighting", "urgency": "MEDIUM",
     "desc": "Streetlight sparking intermittently near Model Colony"},
]

STATUSES = ["OPEN", "OPEN", "OPEN", "ASSIGNED", "IN_PROGRESS", "OPEN", "REOPENED"]
SOP_TEMPLATES = {
    "Pothole": [
        "Inspect pothole dimensions (depth, width) and document with photos",
        "Barricade the area and place warning signs for traffic safety",
        "Apply cold mix asphalt patch or schedule hot mix repair based on severity"
    ],
    "Water Leak": [
        "Locate the exact leak point and assess pipe condition",
        "Shut off upstream valve to stop water flow if major",
        "Repair pipe joint or replace damaged section, restore water supply"
    ],
    "Garbage Dump": [
        "Assess volume of waste and identify type (household, construction, hazardous)",
        "Coordinate with waste collection team for immediate pickup",
        "Sanitize the area and install proper waste bins with signage"
    ],
    "Broken Streetlight": [
        "Inspect the electrical connection and identify the fault type",
        "Replace bulb/LED panel or repair wiring as needed",
        "Test the light and verify proper functioning at night"
    ],
    "Open Manhole": [
        "Immediately barricade the open manhole with safety barriers",
        "Source and install a replacement manhole cover",
        "Inspect surrounding manholes in the area for similar issues"
    ],
    "Sewage Overflow": [
        "Identify the blockage point in the sewer line",
        "Deploy jetting equipment to clear the blockage",
        "Disinfect the affected area and verify proper drainage flow"
    ],
}

TOOLS = {
    "Pothole": ["Cold mix asphalt", "Compactor", "Safety barriers", "Camera"],
    "Water Leak": ["Pipe wrench set", "Pipe clamps", "Valve key", "Camera"],
    "Garbage Dump": ["Waste collection truck", "Shovels", "Bins", "Sanitizer spray"],
    "Broken Streetlight": ["Electrical toolkit", "LED panel", "Safety harness", "Ladder truck"],
    "Open Manhole": ["Replacement cover", "Safety barriers", "Reflective tape", "Camera"],
    "Sewage Overflow": ["Jetting machine", "PPE kit", "Disinfectant", "Camera"],
}


def jitter(center, radius_deg=0.003):
    """Add small random offset to coordinates to spread points within a cluster."""
    return center + random.uniform(-radius_deg, radius_deg)


def random_time_within_hours(max_hours=72):
    """Generate a random timestamp within the last max_hours hours."""
    now = datetime.now(timezone.utc)
    offset = timedelta(hours=random.uniform(0, max_hours))
    return (now - offset).isoformat()


def seed():
    print("🌱 Seeding CivicPulse demo data for Pune...")
    total = 0

    # Seed clustered tickets (for hotspot demo)
    for cluster in CLUSTERS:
        print(f"\n  📍 Seeding cluster: {cluster['name']} ({cluster['count']} tickets)")
        for i in range(cluster["count"]):
            lat = jitter(cluster["center_lat"])
            lng = jitter(cluster["center_lng"])
            desc = cluster["descriptions"][i % len(cluster["descriptions"])]
            urgency = cluster["urgency_pool"][i % len(cluster["urgency_pool"])]
            status = random.choice(STATUSES)
            category = cluster["category"]

            sop = SOP_TEMPLATES.get(category, ["Inspect", "Fix", "Verify"])
            tools = TOOLS.get(category, ["Camera", "Safety gear"])

            ticket_data = {
                "category": category,
                "department": cluster["department"],
                "urgency": urgency,
                "status": status,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "sop_steps": sop,
                "tools_required": tools,
                "description": desc,
                "upvote_count": random.randint(1, 8),
                "created_at": random_time_within_hours(72),
                "citizen_sms_draft": f"Thank you for reporting this {category.lower()} issue. Our {cluster['department']} team has been notified and will respond within 24-48 hours.",
            }

            result = supabase.table("master_tickets").insert(ticket_data).execute()
            if result.data:
                total += 1
                print(f"    [OK] {category} | {urgency} | ({round(lat, 4)}, {round(lng, 4)})")
            else:
                print(f"    [FAIL] Failed to insert ticket")

    # Seed scattered tickets
    print(f"\n  [INFO] Seeding {len(SCATTERED)} scattered tickets...")
    for item in SCATTERED:
        category = item["category"]
        sop = SOP_TEMPLATES.get(category, ["Inspect", "Fix", "Verify"])
        tools = TOOLS.get(category, ["Camera", "Safety gear"])
        status = random.choice(STATUSES)

        ticket_data = {
            "category": category,
            "department": item["dept"],
            "urgency": item["urgency"],
            "status": status,
            "lat": round(jitter(item["lat"], 0.001), 6),
            "lng": round(jitter(item["lng"], 0.001), 6),
            "sop_steps": sop,
            "tools_required": tools,
            "description": item["desc"],
            "upvote_count": random.randint(1, 3),
            "created_at": random_time_within_hours(168),  # up to 1 week ago
            "citizen_sms_draft": f"Thank you for reporting this issue. Our team will address it promptly.",
        }

        result = supabase.table("master_tickets").insert(ticket_data).execute()
        if result.data:
            total += 1
            print(f"    [OK] {category} | {item['urgency']} | Scattered")
        else:
            print(f"    [FAIL] Failed to insert")

    print(f"\n[SUCCESS] Seeded {total} tickets across Pune!")
    print(f"   - {sum(c['count'] for c in CLUSTERS)} clustered (in {len(CLUSTERS)} hotspot zones)")
    print(f"   - {len(SCATTERED)} scattered individual reports")
    print(f"\n[INFO] Run hotspot detection to discover the clusters!")


if __name__ == "__main__":
    seed()
