import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v52_aster_only_legacy_engine as v52  # noqa: E402


class V52KillFlattenIdempotencyTests(unittest.TestCase):
    def make_engine(self, kill_ref, calls):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        engine._last_kill_flatten_key = None
        engine.reset_days = lambda: None
        engine.kill_switch = lambda: kill_ref[0]
        engine.flatten_all = lambda reason: calls.append(reason)
        engine.log = lambda *_args, **_kwargs: None
        engine.positions = lambda: {}
        engine.current_local_time = lambda: v52.dt.datetime(2026, 9, 10, 17, 0, tzinfo=v52.base.NY)
        return engine

    def test_same_active_kill_flattens_only_once(self):
        calls = []
        kill = [{"active": True, "reason": "RISK_LIMIT", "updatedAt": 1}]
        engine = self.make_engine(kill, calls)
        engine.tick({})
        engine.tick({})
        self.assertEqual(calls, ["RISK_LIMIT"])

    def test_cleared_kill_allows_same_reason_to_flatten_again(self):
        calls = []
        kill_row = {"active": True, "reason": "RISK_LIMIT", "updatedAt": 1}
        kill = [kill_row]
        engine = self.make_engine(kill, calls)
        engine.tick({})
        kill[0] = None
        engine.prepare_tick_inputs()
        kill[0] = kill_row
        engine.tick({})
        self.assertEqual(calls, ["RISK_LIMIT", "RISK_LIMIT"])

    def test_completed_kill_hold_skips_shared_account_lock(self):
        calls = []
        kill = [{"active": True, "reason": "RISK_LIMIT", "updatedAt": 1}]
        engine = self.make_engine(kill, calls)
        engine.tick({})
        prepared = engine.prepare_tick_inputs()
        self.assertTrue(prepared["skipWithoutLock"])
        self.assertTrue(prepared["killHold"])

class V52KillHoldCadenceTests(unittest.TestCase):
    def test_completed_kill_hold_uses_idle_cadence(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        engine.positions = lambda: {}
        original = v52.os.environ.get("DISDEX_STOCK_IDLE_INTERVAL_MS")
        try:
            v52.os.environ["DISDEX_STOCK_IDLE_INTERVAL_MS"] = "5000"
            self.assertEqual(engine._loop_interval_ms({"killHold": True}), 5000)
        finally:
            if original is None:
                v52.os.environ.pop("DISDEX_STOCK_IDLE_INTERVAL_MS", None)
            else:
                v52.os.environ["DISDEX_STOCK_IDLE_INTERVAL_MS"] = original


class V52ManagedCancelTests(unittest.TestCase):
    class FakeAster:
        def __init__(self, orders):
            self.orders = orders
            self.cancel_calls = []
            self.cancel_all_calls = []
            self.open_orders_calls = 0
        def open_orders(self, symbol=None):
            self.open_orders_calls += 1
            return list(self.orders)
        def cancel(self, symbol, client_id):
            self.cancel_calls.append((symbol, client_id))
            return {"status": "CANCELED"}
        def cancel_all(self, symbol):
            self.cancel_all_calls.append(symbol)

    def make_flat_engine(self, orders):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine.live = True
        engine.state = {"positions": {}, "pendingOrder": None}
        engine.aster = self.FakeAster(orders)
        engine.positions = lambda: {}
        engine.managed_aster_positions = lambda: {}
        engine.save = lambda: None
        return engine
    def test_flat_kill_reads_open_orders_once_and_sends_no_blanket_cancel(self):
        engine = self.make_flat_engine([])
        engine.flatten_all("RISK_LIMIT")
        self.assertEqual(engine.aster.open_orders_calls, 1)
        self.assertEqual(engine.aster.cancel_calls, [])
        self.assertEqual(engine.aster.cancel_all_calls, [])

    def test_kill_cancels_only_v52_managed_open_orders(self):
        managed = {"symbol": "METAUSDT", "clientOrderId": "stock-v52-v11_eq-meta-open-abc"}
        unmanaged = {"symbol": "METAUSDT", "clientOrderId": "manual-order"}
        engine = self.make_flat_engine([managed, unmanaged])
        engine.flatten_all("RISK_LIMIT")
        self.assertEqual(engine.aster.open_orders_calls, 1)
        self.assertEqual(engine.aster.cancel_calls, [("METAUSDT", managed["clientOrderId"])])
        self.assertEqual(engine.aster.cancel_all_calls, [])

    def test_pending_is_preserved_when_exchange_flat_verification_fails(self):
        engine = self.make_flat_engine([])
        engine.state["pendingOrder"] = {"clientId": "stock-v52-pending"}
        engine.managed_aster_positions = lambda: {"METAUSDT": 1.0}
        with self.assertRaisesRegex(RuntimeError, "flatten left unmanaged"):
            engine.flatten_all("RISK_LIMIT")
        self.assertEqual(engine.state["pendingOrder"], {"clientId": "stock-v52-pending"})

if __name__ == "__main__":
    unittest.main()
