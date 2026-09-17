"""Unit tests verifying Migration 007 fixes: clustering, deduplication, and security policies."""

import unittest
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.models.schemas import HotspotAlert
from backend.services.hotspot_service import run_python_dbscan


class TestMigration007(unittest.TestCase):
    def test_migration_007_sql_structure(self):
        """Verify 007 migration SQL file exists and contains all required security fixes."""
        migration_file = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "migrations",
                "007_fix_clustering_dedup_vulnerabilities.sql",
            )
        )
        self.assertTrue(os.path.exists(migration_file), "007 migration file must exist")

        with open(migration_file, "r", encoding="utf-8") as f:
            sql = f.read()

        # Fix 1: Columns and indexes on hotspot_alerts
        self.assertIn("ALTER TABLE hotspot_alerts ADD COLUMN IF NOT EXISTS department department_type", sql)
        self.assertIn("ALTER TABLE hotspot_alerts ADD COLUMN IF NOT EXISTS sub_category TEXT", sql)
        self.assertIn("idx_hotspot_alerts_department", sql)
        self.assertIn("idx_hotspot_alerts_sub_category", sql)

        # Fix 2: detect_hotspot_clusters rolling window and partition by department + sub_category
        self.assertIn("CREATE OR REPLACE FUNCTION detect_hotspot_clusters", sql)
        self.assertIn("PARTITION BY mt.department, mt.sub_category", sql)
        self.assertIn("hours_window || ' hours'", sql)
        self.assertIn("mt.needs_admin_review IS NOT TRUE", sql)

        # Fix 3: find_nearby_tickets department + sub_category hard filter
        self.assertIn("CREATE OR REPLACE FUNCTION find_nearby_tickets", sql)
        self.assertIn("search_department department_type DEFAULT NULL", sql)
        self.assertIn("search_sub_category TEXT DEFAULT NULL", sql)
        self.assertIn("mt.department = search_department", sql)
        self.assertIn("mt.sub_category = search_sub_category", sql)

        # Fix 4: find_nearby_hotspots strict department and sub_category match
        self.assertIn("CREATE OR REPLACE FUNCTION find_nearby_hotspots", sql)
        self.assertIn("ha.department = search_department", sql)
        self.assertIn("ha.sub_category = search_sub_category", sql)

        # Fix 5: sync_ticket_upvote_count trigger replacing increment_ticket_upvote
        self.assertIn("DROP FUNCTION IF EXISTS increment_ticket_upvote(UUID) CASCADE", sql)
        self.assertIn("CREATE OR REPLACE FUNCTION sync_ticket_upvote_count()", sql)
        self.assertIn("CREATE TRIGGER on_ticket_report_change", sql)

        # Fix 6: RLS policy security closures
        self.assertIn('DROP POLICY IF EXISTS "Anon can read master_tickets" ON master_tickets', sql)
        self.assertIn('DROP POLICY IF EXISTS "Authenticated read hotspot_alerts" ON hotspot_alerts', sql)
        self.assertIn('CREATE POLICY "citizens_view_linked_tickets"', sql)
        self.assertIn('CREATE POLICY "admins_view_hotspot_alerts"', sql)

    def test_hotspot_alert_model_fields(self):
        """Verify HotspotAlert model supports department and sub_category."""
        alert = HotspotAlert(
            id="alert-123",
            category="Road Damage",
            sub_category="pothole",
            department="Roads & Infrastructure",
            center_lat=18.5204,
            center_lng=73.8567,
            radius_m=100.0,
            ticket_count=6,
            ticket_ids=["t1", "t2", "t3", "t4", "t5", "t6"],
            status="NEW",
        )
        self.assertEqual(alert.department, "Roads & Infrastructure")
        self.assertEqual(alert.sub_category, "pothole")
        self.assertEqual(alert.ticket_count, 6)

    def test_python_dbscan_clustering_preserves_sub_category(self):
        """Verify DBSCAN clustering returns both department and sub_category."""
        tickets = [
            {
                "id": f"t{i}",
                "lat": 18.5204 + i * 0.0001,
                "lng": 73.8567 + i * 0.0001,
                "department": "Roads & Infrastructure",
                "category": "Pothole",
                "sub_category": "pothole",
            }
            for i in range(5)
        ]
        clusters = run_python_dbscan(tickets, eps_meters=100, min_pts=5)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["department"], "Roads & Infrastructure")
        self.assertEqual(clusters[0]["sub_category"], "pothole")


if __name__ == "__main__":
    unittest.main()
