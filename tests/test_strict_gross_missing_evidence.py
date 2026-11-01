import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from disdex_strict_portfolio_planner import plan_v52_stock_capacity


class GrossEvidenceTests(unittest.TestCase):
    def test_missing_gross_fields_never_authorize_capacity(self):
        complete = {"equityUsd": 100.0, "cryptoGross": 0.0, "stockGross": 0.0, "totalGross": 0.0}
        for name in complete:
            with self.subTest(missing=name):
                incomplete = {key: value for key, value in complete.items() if key != name}
                with self.assertRaises((RuntimeError, ValueError, TypeError)):
                    plan_v52_stock_capacity(incomplete, 0.5, 2.0)

    def test_negative_and_nonfinite_gross_never_authorize_capacity(self):
        for value in (-1e-10, -0.1, math.nan, math.inf, -math.inf):
            for name in ("cryptoGross", "stockGross", "totalGross"):
                with self.subTest(field=name, value=value):
                    snapshot = {"equityUsd": 100.0, "cryptoGross": 0.0, "stockGross": 0.0, "totalGross": 0.0}
                    snapshot[name] = value
                    with self.assertRaises((RuntimeError, ValueError, TypeError)):
                        plan_v52_stock_capacity(snapshot, 0.5, 2.0)

    def test_explicit_zero_gross_can_be_used(self):
        snapshot = {"equityUsd": 100.0, "cryptoGross": 0.0, "stockGross": 0.0, "totalGross": 0.0}
        decision = plan_v52_stock_capacity(snapshot, 0.5, 2.0)
        self.assertEqual(decision["status"], "planned")
        self.assertEqual(decision["acceptedGross"], 0.5)


if __name__ == "__main__":
    unittest.main()
