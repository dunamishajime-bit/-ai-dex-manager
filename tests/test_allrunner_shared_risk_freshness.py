import sys
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ops" / "deploy"))
import disdex_allrunner_order_enable as m
import disdex_allrunner_final_verify as final


class SharedRiskFreshnessTest(unittest.TestCase):
    def test_order_enable_and_final_audit_reject_invalid_shared_safety_data(self):
        now = 1793596500000
        valid_risk = {"sourceComplete": True, "tripped": False, "utcDay": "2026-11-02",
                      "updatedAt": now - 1000, "maximumLossPct": 7.5}
        margin = {"stage": "HEALTHY", "ordersAllowed": True, "checkedAt": now - 1000}
        for module, function, root_name, read_name, error in (
            (m, "validate_shared_safety", "RELEASES", "read_json", ValueError),
            (final, "shared_health", "BASE", "readj", RuntimeError),
        ):
            def check(risk, entries, margin_value=margin):
                records = {module.RISK: risk, module.MARGIN: margin_value,
                           module.KILL: {"active": False}, module.PENDING: {"entries": entries}}
                with patch.object(module.os.path, "realpath", return_value=str(getattr(module, root_name) / module.MAIN)), \
                     patch.object(module.time, "time", return_value=now / 1000), \
                     patch.object(module, read_name, side_effect=lambda path: records[path]):
                    getattr(module, function)()
            check(valid_risk, [])
            for risk, entries in ((dict(valid_risk, tripped=None), []),
                                  (dict(valid_risk, updatedAt=now-900001), []),
                                  (dict(valid_risk, maximumLossPct=8.0), []),
                                  (valid_risk, [None]), (valid_risk, [{}])):
                with self.subTest(module=module.__name__, risk=risk, entries=entries):
                    with self.assertRaises(error):
                        check(risk, entries)
            for bad_checked_at in (None, now - 900001, now + 1001):
                with self.subTest(module=module.__name__, checkedAt=bad_checked_at):
                    with self.assertRaises(error):
                        check(valid_risk, [], dict(margin, checkedAt=bad_checked_at))

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
