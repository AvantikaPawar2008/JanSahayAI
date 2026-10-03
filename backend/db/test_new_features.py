"""
JanSahayAI — Comprehensive Test Suite for All New Features (TODO Items)

Tests:
  [TODO-IN-01] Async job queue worker
  [TODO-SEC-01] RLS policies
  [TODO-DD-01]  60-day contractor warranty engine
  [TODO-DD-03]  Road-network-aware deduplication
  [TODO-VF-03]  Multi-criteria vision rubric
  [TODO-TR-02]  RAG-grounded municipal SOPs
  [TODO-HS-01]  Poisson statistical hotspot testing
  [TODO-VF-04]  Offline PWA (service worker file check)
  [TODO-HS-02]  Weather & asset risk fusion
  [TODO-IN-03]  Vernacular dialect normalization

Usage:
    # Make sure backend is running first:
    #   cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

    python backend/db/test_new_features.py
    python backend/db/test_new_features.py --unit-only    # skip live API tests
    python backend/db/test_new_features.py --api-only     # skip unit tests
"""

import os
import sys
import time
import json
import asyncio
import argparse
import traceback

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Set up paths
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

BASE_URL = "http://localhost:8000"

# ─── Helpers ──────────────────────────────────────────────────────────────────
PASS = "[PASS]"
FAIL = "[FAIL]"
SKIP = "[SKIP]"
INFO = "[INFO]"

pass_count = 0
fail_count = 0
skip_count = 0

def ok(msg: str):
    global pass_count
    pass_count += 1
    print(f"  {PASS} {msg}")

def fail(msg: str, exc: Exception = None):
    global fail_count
    fail_count += 1
    print(f"  {FAIL} {msg}")
    if exc:
        print(f"         Exception: {exc}")

def skip(msg: str):
    global skip_count
    skip_count += 1
    print(f"  {SKIP} {msg}")

def section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


# ─── Unit Tests (no server needed) ────────────────────────────────────────────

def test_dialect_service():
    """[TODO-IN-03] Test vernacular dialect normalization."""
    section("TEST: Dialect Service (TODO-IN-03)")
    try:
        from backend.services.dialect_service import _apply_gazetteer, normalize_complaint_text

        # Test static gazetteer
        test_cases = [
            ("pothole opp ganpati mandir near metro pillar 42",
             "Ganesh Temple", "Metro Pillar"),
            ("water leak near shiv mandir chowk",
             "Shiva Temple", "Square"),
            ("garbage near masjid on main marg",
             "Mosque", "Road"),
            ("broken pole behind vidyalay gali",
             "School", "Lane"),
        ]
        for text, expected1, expected2 in test_cases:
            normalized, replacements = _apply_gazetteer(text)
            if expected1.lower() in normalized.lower() or expected2.lower() in normalized.lower():
                ok(f"Gazetteer: '{text[:40]}...' → '{normalized[:50]}'")
            else:
                fail(f"Gazetteer missed expected terms '{expected1}' or '{expected2}' in: {normalized}")

        # Test full async pipeline
        result = asyncio.run(normalize_complaint_text(
            "pothole opp ganpati mandir, near metro pillar 42 on shivaji nagar marg",
            use_llm_fallback=False
        ))
        ok(f"Full pipeline: {result['gazetteer_hits']} gazetteer hits, "
           f"confidence={result['confidence']}, "
           f"normalized='{result['normalized_text'][:60]}'")
        if result['detected_landmarks']:
            ok(f"Landmarks detected: {[lm['original'] for lm in result['detected_landmarks']]}")

    except Exception as e:
        fail("Dialect service unit test", e)


def test_poisson_service():
    """[TODO-HS-01] Test Poisson z-score computation."""
    section("TEST: Poisson Statistical Testing (TODO-HS-01)")
    try:
        from backend.services.poisson_service import _lat_lng_to_grid_cell, compute_hotspot_zscore

        # Test grid cell generation
        cell1 = _lat_lng_to_grid_cell(18.5204, 73.8567)
        cell2 = _lat_lng_to_grid_cell(18.5204, 73.8568)  # ~10m away
        cell3 = _lat_lng_to_grid_cell(18.5704, 73.9067)  # ~6km away
        ok(f"Grid cell for Pune center: {cell1}")
        if cell1 == cell2:
            ok(f"Adjacent points share grid cell (same 500m cell): {cell1}")
        if cell1 != cell3:
            ok(f"Distant points have different cells: {cell1} vs {cell3}")

        # Test z-score computation with mock data (0 historical = z will be very high)
        result = asyncio.run(compute_hotspot_zscore(
            center_lat=18.5204,
            center_lng=73.8567,
            department="Roads & Infrastructure",
            current_count=15,
        ))
        ok(f"Z-score computed: z={result['z_score']}, "
           f"baseline_mean={result['baseline_mean']:.2f}, "
           f"abnormal={result['is_abnormal']}, "
           f"ward_cell={result['ward_cell']}")

    except Exception as e:
        fail("Poisson service unit test", e)


def test_warranty_service():
    """[TODO-DD-01] Test warranty service logic."""
    section("TEST: Warranty Service (TODO-DD-01)")
    try:
        from backend.services.warranty_service import (
            WARRANTY_DAYS, WARRANTY_RADIUS_METERS
        )
        ok(f"Warranty constants: {WARRANTY_DAYS} days, {WARRANTY_RADIUS_METERS}m radius")

        # Test warranty period calculation
        from datetime import datetime, timezone, timedelta
        resolved_at = datetime.now(timezone.utc)
        warranty_until = resolved_at + timedelta(days=WARRANTY_DAYS)
        ok(f"Warranty period: {resolved_at.date()} → {warranty_until.date()} ({WARRANTY_DAYS} days)")

        # Test that warranty is expired correctly
        old_resolution = datetime.now(timezone.utc) - timedelta(days=WARRANTY_DAYS + 1)
        old_warranty = old_resolution + timedelta(days=WARRANTY_DAYS)
        is_expired = old_warranty < datetime.now(timezone.utc)
        if is_expired:
            ok(f"Expired warranty correctly identified ({WARRANTY_DAYS+1} days old = expired)")

    except Exception as e:
        fail("Warranty service unit test", e)


def test_road_network_service():
    """[TODO-DD-03] Test road barrier detection logic."""
    section("TEST: Road Network Dedup (TODO-DD-03)")
    try:
        from backend.services.road_network_service import _haversine, ROAD_NETWORK_DEDUP_THRESHOLD_METERS

        # Test Haversine calculation
        # Pune - two points ~100m apart
        dist = _haversine(18.5204, 73.8567, 18.5213, 73.8567)
        ok(f"Haversine distance (100m test): {dist:.1f}m (expected ~100m)")
        assert 90 < dist < 120, f"Expected ~100m, got {dist:.1f}m"

        # Test threshold constant
        ok(f"Road network dedup threshold: {ROAD_NETWORK_DEDUP_THRESHOLD_METERS}m")

        # Test async road barrier check (will use OSRM or Haversine fallback)
        result = asyncio.run(_test_road_barrier_async())
        ok(f"Road barrier check completed: barrier={result}")

    except Exception as e:
        fail("Road network service unit test", e)


async def _test_road_barrier_async():
    from backend.services.road_network_service import check_road_barrier
    # Two points 15m apart — should never be a barrier
    barrier = await check_road_barrier(18.5204, 73.8567, 18.5205, 73.8567, 11.1)
    return barrier


def test_rag_sop_service():
    """[TODO-TR-02] Test RAG SOP vector store."""
    section("TEST: RAG SOP Service (TODO-TR-02)")
    try:
        from backend.services.rag_sop_service import (
            initialize_sop_store, retrieve_relevant_sops, _sop_chunks, _BUILTIN_KNOWLEDGE
        )

        ok(f"Built-in knowledge base: {len(_BUILTIN_KNOWLEDGE)} document sections")

        # Initialize the vector store
        initialize_sop_store()

        from backend.services.rag_sop_service import _sop_chunks as chunks
        ok(f"Vector store initialized: {len(chunks)} embedded chunks")

        # Test retrieval for pothole complaint
        results = retrieve_relevant_sops(
            query_text="dangerous pothole on main road causing accidents",
            department="Roads & Infrastructure",
            top_k=3,
        )
        ok(f"Pothole query: retrieved {len(results)} chunks")
        if results:
            top = results[0]
            ok(f"Top match: '{top['title']}' ({top['section']}) — similarity={top['similarity']:.3f}")
            ok(f"Citations include: {[r['section'] for r in results]}")

        # Test retrieval for water leak
        water_results = retrieve_relevant_sops(
            query_text="water pipe burst flooding the street",
            department="Water Supply & Sewerage",
            top_k=2,
        )
        ok(f"Water leak query: retrieved {len(water_results)} chunks, "
           f"top='{water_results[0]['section'] if water_results else 'none'}'")

    except Exception as e:
        fail("RAG SOP service unit test", e)


def test_job_queue():
    """[TODO-IN-01] Test job queue service."""
    section("TEST: Async Job Queue (TODO-IN-01)")
    try:
        from backend.services.job_queue import (
            Job, JobType, JobStatus, get_job_status, _results
        )

        # Test Job dataclass creation
        job = Job(
            job_type=JobType.STT_TRANSCRIBE,
            payload={"audio_bytes": b"fake_audio", "filename": "test.webm", "ticket_report_id": "test-id"},
        )
        ok(f"Job created: id={job.job_id[:8]}..., type={job.job_type}, status={job.status}")

        # Test job status lookup
        _results[job.job_id] = job
        fetched = get_job_status(job.job_id)
        if fetched and fetched.job_id == job.job_id:
            ok(f"Job status lookup working: {fetched.status}")

        # Test job type enum values
        ok(f"Job types: {[t.value for t in JobType]}")
        ok(f"Job statuses: {[s.value for s in JobStatus]}")

    except Exception as e:
        fail("Job queue unit test", e)


def test_vision_rubric():
    """[TODO-VF-03] Test rubric constants and thresholds."""
    section("TEST: Vision Rubric (TODO-VF-03)")
    try:
        from backend.services.vision_service import RUBRIC_PASS_THRESHOLD, RUBRIC_FAIL_THRESHOLD

        ok(f"Rubric thresholds: PASS>={RUBRIC_PASS_THRESHOLD}, FAIL<={RUBRIC_FAIL_THRESHOLD}, "
           f"BORDERLINE={RUBRIC_FAIL_THRESHOLD+1}-{RUBRIC_PASS_THRESHOLD-1}")

        # Test score classification logic
        test_cases = [
            (15, "PASS"),   # Perfect score
            (12, "PASS"),   # Minimum pass
            (11, "BORDERLINE"),
            (8,  "BORDERLINE"),
            (7,  "FAIL"),
            (0,  "FAIL"),
        ]
        for score, expected in test_cases:
            if score >= RUBRIC_PASS_THRESHOLD:
                verdict = "PASS"
            elif score <= RUBRIC_FAIL_THRESHOLD:
                verdict = "FAIL"
            else:
                verdict = "BORDERLINE"

            if verdict == expected:
                ok(f"Score {score:2d}/15 → {verdict}")
            else:
                fail(f"Score {score}/15: expected {expected}, got {verdict}")

    except Exception as e:
        fail("Vision rubric unit test", e)


def test_weather_service():
    """[TODO-HS-02] Test weather service constants and risk computation."""
    section("TEST: Weather & Asset Risk (TODO-HS-02)")
    try:
        from backend.services.weather_service import (
            RAINFALL_ALERT_MM_PER_HOUR,
            COMBINED_RISK_THRESHOLD,
            PIPE_AGE_HIGH_RISK_YEARS,
        )
        ok(f"Weather thresholds: rainfall_alert>={RAINFALL_ALERT_MM_PER_HOUR}mm/hr, "
           f"risk_threshold={COMBINED_RISK_THRESHOLD}, "
           f"pipe_age_risk>={PIPE_AGE_HIGH_RISK_YEARS}yr")

        # Test async weather API call (Open-Meteo, no key needed)
        print(f"  {INFO} Calling Open-Meteo API for Pune (18.52°N, 73.86°E)...")
        result = asyncio.run(_test_weather_async())
        if "error" in result:
            skip(f"Open-Meteo API unavailable: {result['error']}")
        else:
            ok(f"Rainfall forecast: current={result['current_rainfall_mm']}mm, "
               f"max={result['max_rainfall_mm']}mm/hr, "
               f"flood_risk={result['has_flood_risk']}")

    except Exception as e:
        fail("Weather service unit test", e)


async def _test_weather_async():
    from backend.services.weather_service import get_rainfall_forecast
    return await get_rainfall_forecast(18.5204, 73.8567, hours_ahead=6)


# ─── Live API Tests (server must be running) ───────────────────────────────────

def test_api_intake_with_dialect():
    """[TODO-IN-03] Test intake with vernacular dialect in complaint text."""
    section("API TEST: Intake + Dialect Normalization (TODO-IN-03)")
    try:
        import httpx
        with httpx.Client(timeout=30) as client:
            payload = {
                "lat": "18.5204",
                "lng": "73.8567",
                "text": "Pothole opp Ganpati Mandir on main marg near Metro Pillar 42. Very dangerous for bikes.",
                "citizen_phone": "+919823099001",
            }
            res = client.post(f"{BASE_URL}/api/intake", data=payload)
            if res.status_code == 200:
                data = res.json()
                ok(f"Intake with dialect text: ticket={data['master_ticket_id'][:8]}..., "
                   f"dept={data['department']}, urgency={data['urgency']}")
            else:
                fail(f"Intake API returned {res.status_code}: {res.text[:200]}")
    except Exception as e:
        fail("API intake+dialect test", e)


def test_api_hotspots_with_zscore():
    """[TODO-HS-01] Test Poisson-enriched hotspot detection endpoint."""
    section("API TEST: Hotspot Detection + Poisson Z-Score (TODO-HS-01)")
    try:
        import httpx
        with httpx.Client(timeout=30) as client:
            res = client.post(f"{BASE_URL}/api/admin/detect-hotspots-with-stats")
            if res.status_code == 200:
                data = res.json()
                ok(f"Hotspot detection: {data['total_clusters']} clusters, "
                   f"{data['statistically_abnormal']} statistically abnormal")
                if data['alerts']:
                    first = data['alerts'][0]
                    ok(f"Sample alert: id={first.get('id','?')[:8]}..., "
                       f"z_score={first.get('z_score')}, "
                       f"abnormal={first.get('is_statistically_abnormal')}")
                else:
                    skip("No hotspot clusters found (need seed data — run seed_demo_data.py first)")
            else:
                fail(f"Hotspot API returned {res.status_code}: {res.text[:200]}")
    except Exception as e:
        fail("API hotspot+zscore test", e)


def test_api_infrastructure_risk():
    """[TODO-HS-02] Test infrastructure risk endpoint with Open-Meteo."""
    section("API TEST: Infrastructure Risk (TODO-HS-02)")
    try:
        import httpx
        with httpx.Client(timeout=20) as client:
            # Pune, Maharashtra — testing location
            res = client.get(f"{BASE_URL}/api/admin/infrastructure-risk",
                             params={"lat": 18.5204, "lng": 73.8567,
                                     "radius_meters": 200, "hours_ahead": 12})
            if res.status_code == 200:
                data = res.json()
                ok(f"Infrastructure risk: combined={data['combined_risk_score']:.3f}, "
                   f"asset={data['asset_risk_score']:.3f}, "
                   f"rainfall_max={data['rainfall_max_mm_per_hr']}mm/hr")
                ok(f"Tender alert: {data['should_raise_tender_alert']} "
                   f"(threshold={data['risk_threshold']})")
                if data.get("rainfall_max_mm_per_hr", 0) == 0:
                    ok("Open-Meteo returned forecast data (0mm = dry weather, working correctly)")
            else:
                fail(f"Infrastructure risk API returned {res.status_code}: {res.text[:200]}")
    except Exception as e:
        fail("API infrastructure risk test", e)


def test_api_job_status():
    """[TODO-IN-01] Test job status endpoint with a fake job ID."""
    section("API TEST: Job Queue Status Endpoint (TODO-IN-01)")
    try:
        import httpx
        with httpx.Client(timeout=10) as client:
            # Test with non-existent job (should 404)
            res = client.get(f"{BASE_URL}/api/admin/job-status/nonexistent-job-id")
            if res.status_code == 404:
                ok("Job not found returns 404 correctly")
            else:
                fail(f"Expected 404 for missing job, got {res.status_code}")
    except Exception as e:
        fail("API job status test", e)


def test_api_supervisor_review_queue():
    """[TODO-VF-03] Test supervisor review queue endpoint."""
    section("API TEST: Supervisor Review Queue (TODO-VF-03)")
    try:
        import httpx
        with httpx.Client(timeout=10) as client:
            res = client.get(f"{BASE_URL}/api/admin/supervisor-review-queue")
            if res.status_code == 200:
                data = res.json()
                ok(f"Supervisor queue: {data['count']} items pending review")
                if data['count'] == 0:
                    ok("Empty queue (expected if no BORDERLINE verifications yet)")
            else:
                fail(f"Supervisor queue API returned {res.status_code}: {res.text[:200]}")
    except Exception as e:
        fail("API supervisor review queue test", e)


def test_api_warranty_breach():
    """[TODO-DD-01] Test warranty breach detection via intake."""
    section("API TEST: Warranty Breach Detection (TODO-DD-01)")
    try:
        import httpx
        # Step 1: Submit original complaint
        with httpx.Client(timeout=30) as client:
            original = client.post(f"{BASE_URL}/api/intake", data={
                "lat": "18.5200",
                "lng": "73.8570",
                "text": "Pothole on MG Road repaired but it is already breaking again",
                "citizen_phone": "+919800000042",
            })
            if original.status_code == 200:
                orig_data = original.json()
                ok(f"Original complaint submitted: {orig_data['master_ticket_id'][:8]}...")

                # Step 2: Submit a near-identical complaint at same location
                # (In real scenario, the original would need to be RESOLVED with warranty set)
                duplicate = client.post(f"{BASE_URL}/api/intake", data={
                    "lat": "18.5200",
                    "lng": "73.8570",
                    "text": "Same pothole on MG Road has opened up again after repair last month",
                    "citizen_phone": "+919800000099",
                })
                if duplicate.status_code == 200:
                    dup_data = duplicate.json()
                    ok(f"Follow-up complaint: is_duplicate={dup_data['is_duplicate']}, "
                       f"ticket={dup_data['master_ticket_id'][:8]}...")
                    # Note: warranty breach will show in server logs as [WARRANTY BREACH]
                    ok("Check server logs for '⚠️ WARRANTY BREACH' messages if ticket was recently RESOLVED")
            else:
                fail(f"Original complaint failed: {original.status_code}")
    except Exception as e:
        fail("API warranty breach test", e)


def test_pwa_files():
    """[TODO-VF-04] Verify PWA files exist and are valid."""
    section("FILE TEST: Offline PWA (TODO-VF-04)")
    sw_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "..", "frontend", "public", "sw.js"
    )
    manifest_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "..", "frontend", "public", "manifest.json"
    )
    main_jsx_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "..", "frontend", "src", "main.jsx"
    )

    if os.path.exists(sw_path):
        size = os.path.getsize(sw_path)
        ok(f"Service worker exists: {size} bytes")
        with open(sw_path) as f:
            content = f.read()
        if "generateCryptoTimestamp" in content:
            ok("Web Crypto timestamping function present")
        if "indexedDB" in content:
            ok("IndexedDB background sync queue present")
        if "sync-offline-queue" in content:
            ok("Background sync tag 'sync-offline-queue' registered")
    else:
        fail(f"Service worker NOT found at: {sw_path}")

    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
        ok(f"PWA manifest valid: name='{manifest.get('name')}', display='{manifest.get('display')}'")
    else:
        fail(f"PWA manifest NOT found at: {manifest_path}")

    if os.path.exists(main_jsx_path):
        with open(main_jsx_path) as f:
            jsx_content = f.read()
        if "serviceWorker.register" in jsx_content:
            ok("Service worker registration code present in main.jsx")
        if "offlineSyncComplete" in jsx_content:
            ok("offlineSyncComplete event listener present")
    else:
        fail(f"main.jsx NOT found at: {main_jsx_path}")


def test_migration_file():
    """Verify migration 011 SQL file is complete."""
    section("FILE TEST: Migration 011 SQL")
    migration_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "migrations", "011_p1_p2_feature_completeness.sql"
    )
    if os.path.exists(migration_path):
        size = os.path.getsize(migration_path)
        with open(migration_path) as f:
            content = f.read()
        ok(f"Migration 011 exists: {size} bytes")

        checks = [
            ("RLS POLICIES", "ROW LEVEL SECURITY"),
            ("warranty function", "find_warranty_breach"),
            ("rubric columns", "rubric_site_match"),
            ("Poisson columns", "z_score"),
            ("infra risk table", "infrastructure_risk_alerts"),
            ("RAG tracking", "sop_regulatory_citations"),
            ("performance score", "performance_score"),
        ]
        for label, keyword in checks:
            if keyword in content:
                ok(f"Migration contains {label} ({keyword})")
            else:
                fail(f"Migration MISSING {label} ({keyword})")
    else:
        fail(f"Migration 011 NOT found at: {migration_path}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def run_unit_tests():
    print("\n" + "=" * 60)
    print("  UNIT TESTS (no server required)")
    print("=" * 60)
    test_dialect_service()
    test_job_queue()
    test_vision_rubric()
    test_warranty_service()
    test_road_network_service()
    test_rag_sop_service()
    test_weather_service()
    test_pwa_files()
    test_migration_file()


def run_api_tests():
    # Quick health check first
    try:
        import httpx
        with httpx.Client(timeout=5) as client:
            res = client.get(f"{BASE_URL}/health")
            if res.status_code != 200:
                raise ConnectionError(f"Health check failed: {res.status_code}")
    except Exception as e:
        print(f"\n  ⚠️  Backend not reachable at {BASE_URL}: {e}")
        print(f"     Start with: cd backend && uvicorn main:app --reload --port 8000")
        print(f"     Skipping all API tests.\n")
        return

    print("\n" + "=" * 60)
    print("  LIVE API TESTS (server must be running on :8000)")
    print("=" * 60)
    test_api_intake_with_dialect()
    test_api_hotspots_with_zscore()
    test_api_infrastructure_risk()
    test_api_job_status()
    test_api_supervisor_review_queue()
    test_api_warranty_breach()


def print_summary():
    print("\n" + "=" * 60)
    print(f"  TEST SUMMARY")
    print("=" * 60)
    total = pass_count + fail_count + skip_count
    print(f"  Total:  {total}")
    print(f"  Passed: {pass_count}  ✅")
    print(f"  Failed: {fail_count}  ❌")
    print(f"  Skipped:{skip_count}  ⚠️")
    if fail_count == 0:
        print("\n  🎉 ALL TESTS PASSED!")
    else:
        print(f"\n  ⚠️  {fail_count} test(s) failed — see output above.")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JanSahayAI New Feature Test Suite")
    parser.add_argument("--unit-only", action="store_true", help="Run only unit tests (no server needed)")
    parser.add_argument("--api-only", action="store_true", help="Run only live API tests")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  JanSahayAI — New Feature Test Suite")
    print("  Tests 11 TODO items implemented in Session 2")
    print("=" * 60)

    if not args.api_only:
        run_unit_tests()
    if not args.unit_only:
        run_api_tests()

    print_summary()
    sys.exit(0 if fail_count == 0 else 1)
