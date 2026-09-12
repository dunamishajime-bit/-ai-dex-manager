import json
import io
import os
import sys
import tempfile
import time
import unittest
import json as json_module
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v13d_v11eq_stock_live_engine as base  # noqa: E402
import disdex_v96_v52_margin_guard as margin_guard  # noqa: E402


class AsterGlobalRateBudgetPythonTests(unittest.TestCase):
    def test_margin_guard_state_remains_readable_by_deploy_group(self):
        if os.name == "nt":
            self.skipTest("POSIX ownership contract")
        with tempfile.TemporaryDirectory() as directory:
            guard = object.__new__(margin_guard.MarginGuard)
            guard.state_root = Path(directory)
            guard.state_path = guard.state_root / "guard-live.json"
            guard.state = {}
            guard.write_state({"stage": "HEALTHY", "ordersAllowed": True})
            self.assertEqual(guard.state_path.stat().st_mode & 0o777, 0o660)
            self.assertEqual(guard.state_path.stat().st_gid, guard.state_root.stat().st_gid)

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
                if os.name != "nt":
                    self.assertEqual(budget.stat().st_mode & 0o777, 0o660)
                    self.assertEqual(budget.stat().st_gid, budget.parent.stat().st_gid)
        finally:
            base.http_json = original_http
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_weighted_rate_budget_reserves_multiple_weight_units(self):
        original_env = {key: os.environ.get(key) for key in ("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH", "DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS", "DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS")}
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "aster-rate-budget.json"
                os.environ["DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH"] = str(path)
                os.environ["DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS"] = "20"
                os.environ["DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS"] = "1000"
                base.wait_for_aster_global_rate_budget(1)
                first = json.loads(path.read_text(encoding="utf-8"))
                base.wait_for_aster_global_rate_budget(5)
                second = json.loads(path.read_text(encoding="utf-8"))
                self.assertGreaterEqual(second["nextAllowedAt"] - first["nextAllowedAt"], 100)
        finally:
            for key, value in original_env.items():
                if value is None: os.environ.pop(key, None)
                else: os.environ[key] = value

    def test_python_weight_table_covers_heavy_aster_endpoints(self):
        self.assertEqual(base.aster_futures_request_weight("GET", "/fapi/v3/balance", {}), 5)
        self.assertEqual(base.aster_futures_request_weight("GET", "/fapi/v3/positionRisk", {}), 5)
        self.assertEqual(base.aster_futures_request_weight("GET", "/fapi/v3/openOrders", {}), 40)
        self.assertEqual(base.aster_futures_request_weight("GET", "/fapi/v3/openOrders", {"symbol": "BTCUSDT"}), 1)
        self.assertEqual(base.aster_futures_request_weight("GET", "/fapi/v1/aggTrades", {"limit": 200}), 20)
        self.assertEqual(base.aster_futures_request_weight("GET", "/fapi/v1/depth", {"limit": 20}), 2)
        self.assertEqual(base.aster_futures_request_weight("GET", "/fapi/v3/fundingRate", {"symbol": "PENGUUSDT"}), 1)
        self.assertEqual(base.aster_futures_request_weight("GET", "/fapi/v3/unknown-future-endpoint", {}), 100)

    def test_shared_cooldown_blocks_followup_requests(self):
        original_env = {key: os.environ.get(key) for key in ("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH", "DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS", "DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS")}
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "aster-rate-budget.json"
                os.environ["DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH"] = str(path)
                os.environ["DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS"] = "50"
                os.environ["DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS"] = "5000"
                base.defer_aster_global_rate_budget(60_000, 429)
                state = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(state["lastRateLimitStatus"], 429)
                with self.assertRaisesRegex(RuntimeError, "ASTER_GLOBAL_RATE_BUDGET_SATURATED"):
                    base.wait_for_aster_global_rate_budget(1)
        finally:
            for key, value in original_env.items():
                if value is None: os.environ.pop(key, None)
                else: os.environ[key] = value

    def test_python_http_429_publishes_shared_cooldown(self):
        original_urlopen = base.urllib.request.urlopen
        original_env = {key: os.environ.get(key) for key in ("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH", "DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS", "DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS")}
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "aster-rate-budget.json"
                os.environ["DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH"] = str(path)
                os.environ["DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS"] = "50"
                os.environ["DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS"] = "5000"
                def fail_429(request, timeout=10):
                    raise base.urllib.error.HTTPError(request.full_url, 429, "Too Many Requests", {"Retry-After": "0"}, io.BytesIO(b'{}'))
                base.urllib.request.urlopen = fail_429
                with self.assertRaisesRegex(RuntimeError, "HTTP 429"):
                    base.http_json("https://fapi.asterdex.com/fapi/v3/ping")
                state = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(state["lastRateLimitStatus"], 429)
                self.assertGreater(state["nextAllowedAt"], base.now_ms() + 50_000)
        finally:
            base.urllib.request.urlopen = original_urlopen
            for key, value in original_env.items():
                if value is None: os.environ.pop(key, None)
                else: os.environ[key] = value

    def test_nonfinite_rate_budget_env_fails_closed(self):
        keys = ("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH", "DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS", "DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS")
        original_env = {key: os.environ.get(key) for key in keys}
        try:
            with tempfile.TemporaryDirectory() as directory:
                os.environ[keys[0]] = str(Path(directory) / "aster-rate-budget.json")
                os.environ[keys[1]] = "not-a-number"
                os.environ[keys[2]] = "1000"
                with self.assertRaisesRegex(RuntimeError, "ASTER_GLOBAL_RATE_BUDGET_CONFIG_INVALID"):
                    base.wait_for_aster_global_rate_budget()
        finally:
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_shared_budget_never_evicts_an_old_lock_owned_by_a_live_process(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "aster-rate-budget.json"
            lock_path = Path(str(path) + ".lock")
            lock_path.mkdir()
            (lock_path / "owner.json").write_text(json_module.dumps({
                "schema": "disdex-aster-rate-budget-lock/v1",
                "pid": os.getpid(),
                "createdAt": int(time.time() * 1000) - 30_000,
                "token": "live-owner",
            }), encoding="utf-8")
            old = time.time() - 30
            os.utime(lock_path, (old, old))
            original_env = {key: os.environ.get(key) for key in ("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH", "DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS", "DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS")}
            try:
                os.environ["DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH"] = str(path)
                os.environ["DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS"] = "20"
                os.environ["DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS"] = "20"
                with self.assertRaisesRegex(RuntimeError, "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT"):
                    base.wait_for_aster_global_rate_budget()
                self.assertIn("live-owner", (lock_path / "owner.json").read_text(encoding="utf-8"))
            finally:
                for key, value in original_env.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value

if __name__ == "__main__":
    unittest.main()
