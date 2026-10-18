import json
import unittest
from pathlib import Path

from scripts.disdex_pending_exposure_registry import aggregate_pending, read_registry


class PendingExposureRegistryTests(unittest.TestCase):
    def test_idle_and_hype_pending_rows_are_crypto_owned(self):
        path = Path.cwd() / "_test_pending_exposure_registry.json"
        try:
            now = 1_800_000_000_000
            path.write_text(
                json.dumps(
                    {
                        "schema": "disdex-pending-exposure/v1",
                        "accountScope": "ASTER_FUTURES",
                        "updatedAt": now,
                        "entries": [
                            {
                                "reservationId": "idle-1",
                                "strategyId": "IDLE_PRIORITY_SHORT",
                                "sleeve": "CRYPTO",
                                "status": "PENDING",
                                "gross": 0.25,
                                "notionalUsd": 25,
                                "createdAt": now,
                                "updatedAt": now,
                            },
                            {
                                "reservationId": "hype-1",
                                "strategyId": "HYPE_LONG",
                                "sleeve": "CRYPTO",
                                "status": "PENDING",
                                "gross": 1.0,
                                "notionalUsd": 100,
                                "createdAt": now,
                                "updatedAt": now,
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )

            registry = read_registry(path)
            aggregate = aggregate_pending(path)

            self.assertEqual(len(registry["entries"]), 2)
            self.assertEqual(aggregate["cryptoGross"], 1.25)
            self.assertEqual(aggregate["stockGross"], 0.0)
            self.assertEqual(aggregate["byStrategyGross"]["IDLE_PRIORITY_SHORT"], 0.25)
            self.assertEqual(aggregate["byStrategyGross"]["HYPE_LONG"], 1.0)
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
