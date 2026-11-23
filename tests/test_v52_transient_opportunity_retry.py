import datetime as dt
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v52_aster_only_live_engine as live  # noqa: E402
import disdex_v52_aster_only_legacy_engine as legacy  # noqa: E402


class V52TransientOpportunityRetryTests(unittest.TestCase):
    def _engine(self, local_time: dt.datetime):
        engine = object.__new__(live.V52AsterOnlyEngine)
        engine.live = False
        engine.state = {
            "positions": {},
            "v11SignalBasis": {"META": 100.0},
            "v11Attempted": False,
            "v50Attempted": {},
            "v50CompletedTrades": 0,
        }
        engine.current_local_time = lambda: local_time
        engine.reset_days = lambda: None
        engine.kill_switch = lambda: None
        engine.enforce_daily_loss = lambda: False
        engine.update_history = lambda: None
        engine.positions = lambda: engine.state["positions"]
        engine.v96_requires_margin = lambda: False
        engine.manage_positions = lambda _rows: None
        engine.available_slot_gross = lambda _slot: (1.0, {"equityUsd": 100.0})
        engine.log = lambda *_args, **_kwargs: None
        engine.save = lambda: None
        engine.v11_candidates = lambda _rows: (
            {"symbol": "META", "side": "BUY", "entryPrice": 100.0, "basisBps": -100.0},
            {},
        )
        engine.v50_candidate = lambda window, _rows, _notional: (
            {"symbol": "META", "side": "BUY", "entryPrice": 100.0, "basisBps": -100.0, "route": f"POST_{window.replace(':', '')}"},
            {},
        )
        return engine

    def test_v11_preorder_exception_releases_attempt_for_same_window_retry(self):
        local = dt.datetime(2026, 9, 21, 10, 30, 5, tzinfo=legacy.base.NY)
        engine = self._engine(local)
        engine.open_basis_position = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("temporary Margin Guard block"))
        with self.assertRaisesRegex(RuntimeError, "temporary Margin Guard block"):
            engine.tick({"local": local, "rows": {}})
        self.assertFalse(engine.state["v11Attempted"])

    def test_v11_preorder_capacity_false_releases_attempt(self):
        local = dt.datetime(2026, 9, 21, 10, 30, 5, tzinfo=legacy.base.NY)
        engine = self._engine(local)
        def blocked(*_args, **_kwargs):
            engine._v52_last_entry_blocked_before_order = True
            return False
        engine.open_basis_position = blocked
        engine.tick({"local": local, "rows": {}})
        self.assertFalse(engine.state["v11Attempted"])

    def test_v11_order_path_false_remains_consumed_to_prevent_duplicate_submission(self):
        local = dt.datetime(2026, 9, 21, 10, 30, 5, tzinfo=legacy.base.NY)
        engine = self._engine(local)
        def order_path(*_args, **_kwargs):
            engine._v52_last_entry_blocked_before_order = False
            return False
        engine.open_basis_position = order_path
        engine.tick({"local": local, "rows": {}})
        self.assertTrue(engine.state["v11Attempted"])

    def test_v11_no_candidate_does_not_consume_window(self):
        local = dt.datetime(2026, 9, 21, 10, 30, 5, tzinfo=legacy.base.NY)
        engine = self._engine(local)
        engine.v11_candidates = lambda _rows: (None, {"META": ["STALE_DATA"]})
        engine.tick({"local": local, "rows": {}})
        self.assertFalse(engine.state["v11Attempted"])

    def test_v11_success_consumes_window(self):
        local = dt.datetime(2026, 9, 21, 10, 30, 5, tzinfo=legacy.base.NY)
        engine = self._engine(local)
        engine.open_basis_position = lambda *_args, **_kwargs: True
        engine.tick({"local": local, "rows": {}})
        self.assertTrue(engine.state["v11Attempted"])

    def test_v50_preorder_exception_releases_only_that_window(self):
        local = dt.datetime(2026, 9, 21, 11, 30, 5, tzinfo=legacy.base.NY)
        engine = self._engine(local)
        engine.state["v11Attempted"] = True
        engine.open_basis_position = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("temporary pre-order block"))
        with self.assertRaisesRegex(RuntimeError, "temporary pre-order block"):
            engine.tick({"local": local, "rows": {}})
        self.assertFalse(engine.state["v50Attempted"].get("11:30", False))

    def test_strict_capacity_block_is_explicitly_retryable_before_order(self):
        engine = object.__new__(live.V52AsterOnlyEngine)
        engine.live = False
        engine.crypto_gross_cap = 3.0
        engine.stock_gross_cap = 1.98
        engine.portfolio_gross_cap = 3.5
        engine.v11_gross_cap = 1.64
        engine.v50_gross_cap = 1.64
        engine.gross_snapshot = lambda: {"equityUsd": 100.0, "cryptoGross": 2.0, "stockGross": 1.0, "totalGross": 3.0}
        engine.assert_gross_safe = lambda _snapshot=None: None
        engine.log = lambda *_args, **_kwargs: None
        with patch.object(live, "plan_v52_stock_capacity", return_value={"status": "blocked", "acceptedGross": 0.0, "reason": "TOTAL_GROSS_CAP"}):
            opened = engine.open_basis_position(legacy.V11_SLOT, {"symbol": "META", "side": "BUY", "entryPrice": 100.0}, 1.0)
        self.assertFalse(opened)
        self.assertTrue(engine._v52_last_entry_blocked_before_order)


if __name__ == "__main__":
    unittest.main()
