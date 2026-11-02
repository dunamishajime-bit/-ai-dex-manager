import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.disdex_strict_portfolio_planner import plan_v52_stock_capacity, v52_shared_total_reclaim_required


class V52WorstCaseCapacityTests(unittest.TestCase):
    def test_worst_case_fill_is_reserved_before_entry(self):
        result = plan_v52_stock_capacity(
            {"equityUsd": 1000, "cryptoGross": 0, "stockGross": 3.25, "totalGross": 3.25},
            1.0,
            2.0,
            candidate_worst_case_gross=1.02,
        )
        self.assertEqual(result["status"], "planned")
        self.assertLess(result["acceptedGross"], 1.0)


    def test_free_total_gross_never_requests_preemption(self):
        self.assertFalse(v52_shared_total_reclaim_required(
            {"equityUsd": 1000, "cryptoGross": 1.5, "stockGross": 0.5, "totalGross": 2.0},
            1.0,
            2.0,
        ))

    def test_total_shortfall_requests_preemption_only_when_stock_capacity_can_fit(self):
        self.assertTrue(v52_shared_total_reclaim_required(
            {"equityUsd": 1000, "cryptoGross": 3.0, "stockGross": 1.0, "totalGross": 4.0},
            1.0,
            2.0,
        ))
        self.assertFalse(v52_shared_total_reclaim_required(
            {"equityUsd": 1000, "cryptoGross": 0.0, "stockGross": 4.0, "totalGross": 4.0},
            1.0,
            2.0,
        ))

    def test_slot_cap_shortfall_does_not_preempt_other_runners(self):
        self.assertFalse(v52_shared_total_reclaim_required(
            {"equityUsd": 1000, "cryptoGross": 3.0, "stockGross": 0.0, "totalGross": 3.0},
            2.5,
            2.0,
        ))


if __name__ == "__main__":
    unittest.main()
