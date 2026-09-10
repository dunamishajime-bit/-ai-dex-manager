import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v13d_v11eq_stock_live_engine as base  # noqa: E402


class AsterGlobalRateBudgetPythonTests(unittest.TestCase):
    def test_aster_client_reserves_shared_rate_slots(self):
        original_http = base.http_json
        keys = ("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH", "DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS", "DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS")
        original_env = {key: os.environ.get(key) for key in keys}
        try:
            with tempfile.TemporaryDirectory() as directory:
                budget = Path(directory) / "aster-rate-budget.json"
                os.environ[keys[0]] = str(budget)
                os.environ[keys[1]] = "20"
                os.environ[keys[2]] = "1000"
                base.http_json = lambda *_args, **_kwargs: {}
                client = base.AsterClient(False)
                client.ping()
                self.assertTrue(budget.is_file(), "Aster client must reserve the shared VPS rate budget before REST")
                first = json.loads(budget.read_text(encoding="utf-8"))
                client.ping()
                second = json.loads(budget.read_text(encoding="utf-8"))
                self.assertEqual(second["schema"], "disdex-aster-rate-budget/v1")
                self.assertGreaterEqual(second["nextAllowedAt"] - first["nextAllowedAt"], 20)
        finally:
            base.http_json = original_http
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
