import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ops" / "deploy"))
import disdex_allrunner_order_enable as m


class SharedRiskFreshnessTest(unittest.TestCase):
    def test_requires_fresh_utc_day_and_actual_seven_point_five_percent_limit(self):
        now = 1793596500000
        risk = {"sourceComplete": True, "tripped": False, "utcDay": "2026-11-02",
                "updatedAt": now - 1000, "maximumLossPct": 7.5}
        m.validate_shared_risk(risk, now)
        for change in ({"maximumLossPct": 8.0}, {"maximumLossPct": None},
                       {"utcDay": "2026-11-01"}, {"updatedAt": now - 900001},
                       {"updatedAt": now + 1001}, {"sourceComplete": False},
                       {"tripped": True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                m.validate_shared_risk(dict(risk, **change), now)


if __name__ == "__main__":
    unittest.main()
