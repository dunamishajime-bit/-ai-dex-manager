import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ops" / "deploy"))
import disdex_allrunner_final_verify as m


class FinalVenueEvidenceTest(unittest.TestCase):
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
