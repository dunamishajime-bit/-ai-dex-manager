import sys
import unittest
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ops" / "deploy"))
import disdex_allrunner_final_verify as m


class FinalVenueEvidenceTest(unittest.TestCase):
    def test_final_audit_does_not_pass_without_three_tick_audit_cycles(self):
        def property_value(unit, key):
            if "97830672" in unit or "margin-guard@4d33" in unit:
                return "inactive"
            return "active"
        with patch.object(m, "shared_health"), patch.object(m, "verify_service", return_value=1234), \
             patch.object(m, "prop", side_effect=property_value), patch.object(m, "hype_overlay_verify"), \
             patch.object(m, "signed_get", side_effect=[1, 2, 3]):
            with self.assertRaisesRegex(RuntimeError, "THREE_CYCLE_TICK_AUDIT_NOT_CERTIFIED"):
                m.verify_step("FINAL_ALL_RUNNERS_AUDIT")

    def test_signed_get_uses_v4_budget_configuration_and_deploy_identity(self):
        now = 1793596500000
        value = {"status": "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
                 "observedAt": now, "venueTime": now, "positions": [], "openOrders": [],
                 "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}
        seen = []
        def run(argv, **kwargs):
            seen.append(argv)
            return SimpleNamespace(returncode=0, stdout=json.dumps(value), stderr="")
        with patch.object(m.subprocess, "run", side_effect=run), \
             patch.object(m.time, "time", return_value=now / 1000):
            self.assertEqual(m.signed_get(), now)
        command = seen[0][2]
        self.assertIn("/etc/disdex/current-runtime/" + m.V4 + ".env", command)
        self.assertIn("/var/lib/disdex/shared/aster-rate-budget.json", command)
        self.assertIn("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH", command)
        self.assertIn("/usr/sbin/runuser -u deploy --", command)

    def test_flat_evidence_requires_fresh_explicit_arrays_and_zero_mutations(self):
        now = 1793596500000
        value = {"status": "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
                 "observedAt": now, "venueTime": now,
                 "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
                 "positions": [], "openOrders": []}
        self.assertEqual(m.validate_flat_signed_get(value, now), now)
        for change in ({"positions": None}, {"openOrders": None},
                       {"positions": [{"symbol": "DOGEUSDT", "positionAmt": "-226"}]},
                       {"openOrders": [{"symbol": "DOGEUSDT"}]},
                       {"observedAt": now - 30001}, {"venueTime": now + 5001},
                       {"ordersSent": 1}):
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                m.validate_flat_signed_get(dict(value, **change), now)


if __name__ == "__main__":
    unittest.main()
