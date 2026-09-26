import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.disdex_strict_portfolio_planner import plan_v52_stock_capacity


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


if __name__ == "__main__":
    unittest.main()
