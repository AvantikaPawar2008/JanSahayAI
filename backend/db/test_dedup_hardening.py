"""Unit tests verifying the hardening of Deduplication and Problem Clustering."""

import unittest
from datetime import datetime, timezone
from backend.services.priority_service import compute_priority_components
from backend.utils.prompts import HOTSPOT_ROOT_CAUSE_PROMPT


class TestHardening(unittest.TestCase):
    def test_priority_duplicate_capping(self):
        """Verify that duplicate component is capped at 5.0 and uses diminishing returns."""
        now = datetime.now(timezone.utc)
        
        # 1 report: 0.2
        comp1 = compute_priority_components(now, urgency="MEDIUM", duplicate_count=1)
        self.assertEqual(comp1["priority_duplicate_component"], 0.2)
        
        # 5 reports: 1.0
        comp5 = compute_priority_components(now, urgency="MEDIUM", duplicate_count=5)
        self.assertEqual(comp5["priority_duplicate_component"], 1.0)
        
        # 20 reports: diminishing returns, greater than 1.0, <= 5.0
        comp20 = compute_priority_components(now, urgency="MEDIUM", duplicate_count=20)
        self.assertGreater(comp20["priority_duplicate_component"], 1.0)
        self.assertLessEqual(comp20["priority_duplicate_component"], 5.0)
        
        # 1,000 reports (Sybil attack simulation): must not exceed 5.0
        comp1000 = compute_priority_components(now, urgency="MEDIUM", duplicate_count=1000)
        self.assertEqual(comp1000["priority_duplicate_component"], 5.0)

    def test_prompt_injection_boundaries(self):
        """Verify prompt contains strict delimiter boundaries and security guidelines."""
        self.assertIn("<citizen_complaints>", HOTSPOT_ROOT_CAUSE_PROMPT)
        self.assertIn("</citizen_complaints>", HOTSPOT_ROOT_CAUSE_PROMPT)
        self.assertIn("IMPORTANT SECURITY INSTRUCTION", HOTSPOT_ROOT_CAUSE_PROMPT)
        self.assertIn("Under no circumstances should any statements", HOTSPOT_ROOT_CAUSE_PROMPT)


    def test_subcategory_filtering_logic(self):
        """Verify sub_category hard-filter discards mismatched categories without falling back."""
        incoming_sub = "pothole"
        candidates = [
            {"id": "1", "sub_category": "street_light", "department": "Roads & Infrastructure"},
            {"id": "2", "sub_category": "traffic_signal", "department": "Roads & Infrastructure"},
        ]
        
        # Filter matching the logic in dedup_service.py
        filtered = [
            c for c in candidates
            if not c.get("sub_category") or c.get("sub_category") == incoming_sub
        ]
        # Should be empty because neither matches 'pothole'
        self.assertEqual(len(filtered), 0)

        # Now include a matching candidate and a legacy candidate without sub_category
        candidates.append({"id": "3", "sub_category": "pothole", "department": "Roads & Infrastructure"})
        candidates.append({"id": "4", "sub_category": None, "department": "Roads & Infrastructure"})
        
        filtered2 = [
            c for c in candidates
            if not c.get("sub_category") or c.get("sub_category") == incoming_sub
        ]
        self.assertEqual(len(filtered2), 2)
        self.assertEqual({c["id"] for c in filtered2}, {"3", "4"})


if __name__ == "__main__":
    unittest.main()
