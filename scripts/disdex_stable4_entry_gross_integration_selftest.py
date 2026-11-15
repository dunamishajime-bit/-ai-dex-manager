"""Exercise the actual V52 final non-reduce call boundary without venue I/O."""
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import disdex_v52_aster_only_legacy_engine as engine_module
from disdex_stable4_entry_gross_guard_selftest import NOW, pending


class Sent(Exception):
    pass


class V52FinalEntryTests(unittest.TestCase):
    def make_engine(self):
        engine = object.__new__(engine_module.V52AsterOnlyEngine)
        engine.live = True
        engine.state = {}
        engine._prepare_quality102_for_stock_entry = lambda slot, gross: gross
        engine.gross_snapshot = lambda: {"equityUsd": 100, "stockGross": 0, "totalGross": 0}
        engine.assert_gross_safe = lambda snapshot: None
        engine.v11_gross_cap = engine.v50_gross_cap = 1
        engine.stock_gross_cap = 1.5
        engine.portfolio_gross_cap = 3.5
        engine.minimum_entry_usd = 1
        engine.client_id = lambda *args: "my-client"
        engine.log = lambda *args, **kwargs: None
        engine.save = lambda: None
        self.sent = []
        self.released = []
        self.registry = {"schema": "disdex-pending-exposure/v1", "accountScope": "ASTER_FUTURES", "updatedAt": NOW, "entries": []}

        def set_pending(payload):
            engine.state["pendingOrder"] = payload
            self.registry["entries"].append(pending("my-client", strategyId="V11_EQ", sleeve="STOCK", symbol="META", notionalUsd=payload["quantity"] * payload["price"]))

        def clear_pending():
            self.released.append(engine.state.pop("pendingOrder")["clientId"])

        def place_limit(**kwargs):
            self.sent.append(kwargs)
            raise Sent()

        engine._set_pending = set_pending
        engine._clear_pending = clear_pending
        engine.lock = SimpleNamespace(_owned=lambda: {"accountScope": "ASTER_FUTURES", "ownerId": "owner", "leaseId": "lease"})
        engine.aster = SimpleNamespace(
            normalize=lambda symbol, quantity, price, side: (quantity, price),
            balances=lambda: [{"asset": "USDT", "balance": "100"}],
            positions=lambda: [],
            place_limit=place_limit,
        )
        return engine

    def run_entry(self, engine, mode="LIVE"):
        with patch.dict(os.environ, {"DISDEX_STABLE4_MODE": mode}), patch.object(engine_module.base, "now_ms", return_value=NOW), patch.object(engine_module, "read_registry", side_effect=lambda: self.registry, create=True):
            return engine.open_basis_position("V11_EQ", {"symbol": "META", "side": "BUY", "entryPrice": 100}, 0.5)

    def test_above_cap_final_signed_exposure_sends_nothing_and_releases_own(self):
        engine = self.make_engine()
        engine.aster.positions = lambda: [{"symbol": "AMZNUSDT", "positionAmt": "3.75", "markPrice": "100", "unRealizedProfit": "0"}]
        self.assertFalse(self.run_entry(engine))
        self.assertEqual(self.sent, [])
        self.assertEqual(self.released, ["my-client"])

    def test_exact_stock_cap_allows_one_normalized_send(self):
        engine = self.make_engine()
        engine.aster.positions = lambda: [{"symbol": "AMZNUSDT", "positionAmt": "-1", "markPrice": "100", "unRealizedProfit": "0"}]
        with self.assertRaises(Sent):
            self.run_entry(engine)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["quantity"], 0.5)
        self.assertEqual(self.released, [])

    def test_ownership_missing_or_lost_fails_closed(self):
        for lock in [None, SimpleNamespace(_owned=lambda: (_ for _ in ()).throw(RuntimeError("ACCOUNT_LOCK_NOT_OWNER")))]:
            engine = self.make_engine()
            engine.lock = lock
            self.assertFalse(self.run_entry(engine))
            self.assertEqual(self.sent, [])

    def test_lease_lost_after_signed_reads_prevents_send(self):
        engine = self.make_engine()
        checks = iter([{"accountScope": "ASTER_FUTURES", "ownerId": "owner", "leaseId": "lease"}, RuntimeError("ACCOUNT_LOCK_NOT_OWNER")])
        def check():
            result = next(checks)
            if isinstance(result, Exception):
                raise result
            return result
        engine.lock._owned = check
        self.assertFalse(self.run_entry(engine))
        self.assertEqual(self.sent, [])
        self.assertEqual(self.released, ["my-client"])

    def test_slow_signed_reads_keep_original_observation_age(self):
        engine = self.make_engine()
        with patch.dict(os.environ, {"DISDEX_STABLE4_MODE": "LIVE"}), patch.object(engine_module.base, "now_ms", side_effect=[NOW, NOW + 120001, NOW + 120002]), patch.object(engine_module, "read_registry", side_effect=lambda: self.registry):
            result = engine.open_basis_position("V11_EQ", {"symbol": "META", "side": "BUY", "entryPrice": 100}, 0.5)
        self.assertFalse(result)
        self.assertEqual(self.sent, [])

    def test_stale_registry_fails_before_send(self):
        engine = self.make_engine()
        self.registry["updatedAt"] = NOW - 120001
        self.assertFalse(self.run_entry(engine))
        self.assertEqual(self.sent, [])

    def test_unknown_nonzero_and_invalid_signed_quantity_fail_closed(self):
        for quantity in ["0.00000000000001", "1e-999", "", None, True, "nan"]:
            engine = self.make_engine()
            engine.aster.positions = lambda: [{"symbol": "UNKNOWN", "positionAmt": quantity, "markPrice": "1", "unRealizedProfit": "0"}]
            self.assertFalse(self.run_entry(engine))
            self.assertEqual(self.sent, [])

    def test_exact_zero_unknown_row_is_filtered_before_classification(self):
        engine = self.make_engine()
        engine.aster.positions = lambda: [{"symbol": "UNKNOWN", "positionAmt": "0"}]
        with self.assertRaises(Sent):
            self.run_entry(engine)
        self.assertEqual(len(self.sent), 1)

    def test_equity_includes_unrealized_pnl_for_nonzero_positions(self):
        engine = self.make_engine()
        engine.aster.positions = lambda: [{"symbol": "AMZNUSDT", "positionAmt": "1", "markPrice": "100", "unRealizedProfit": "-75"}]
        self.assertFalse(self.run_entry(engine))
        self.assertEqual(self.sent, [])

    def test_off_and_shadow_preserve_existing_boundary(self):
        for mode in ["OFF", "SHADOW", "live", ""]:
            engine = self.make_engine()
            engine.aster.balances = lambda: (_ for _ in ()).throw(AssertionError("unexpected read"))
            engine.lock = None
            with self.assertRaises(Sent):
                self.run_entry(engine, mode)
            self.assertEqual(len(self.sent), 1)

    def test_network_failure_stays_visible_and_clears_unsent_own_pending(self):
        engine = self.make_engine()
        engine.aster.balances = lambda: (_ for _ in ()).throw(ConnectionError("signed API unavailable"))
        with self.assertRaises(ConnectionError):
            self.run_entry(engine)
        self.assertEqual(self.sent, [])
        self.assertEqual(self.released, ["my-client"])

    def test_same_symbol_reservation_cannot_borrow_a_foreign_strategy_identity(self):
        engine = self.make_engine()
        original = engine._set_pending
        def set_pending(payload):
            original(payload)
            self.registry["entries"][0]["strategyId"] = "V50_POST_OPEN_BASIS"
        engine._set_pending = set_pending
        self.assertFalse(self.run_entry(engine))
        self.assertEqual(self.sent, [])
        self.assertEqual(self.released, ["my-client"])


if __name__ == "__main__":
    unittest.main()
