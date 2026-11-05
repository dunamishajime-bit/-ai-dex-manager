"""Mock-only test: never connect to Aster or place a real order."""
from __future__ import annotations
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import disdex_v52_aster_only_live_engine as subject

class NoUnnecessaryPreemption(unittest.TestCase):
    def setup_engine(self, snapshot):
        engine=object.__new__(subject.V52AsterOnlyEngine)
        engine.live=True
        engine.v11_gross_cap=2.0
        engine.v50_gross_cap=2.0
        engine.stock_gross_cap=4.0
        engine.crypto_gross_cap=3.0
        engine.portfolio_gross_cap=4.25
        engine._v52_last_entry_blocked_before_order=False
        engine.gross_snapshot=lambda: dict(snapshot)
        engine._pending_adjusted_snapshot=lambda row: dict(row)
        engine.assert_gross_safe=lambda row: subject.validate_gross_snapshot(row)
        engine.require_fresh_preorder_margin_guard=lambda: None
        engine.log=lambda *args, **kwargs: None
        calls=[]
        for method in ("_prepare_idle_residual_for_stock_entry","_prepare_fet_for_stock_entry",
                       "_prepare_quality102_for_stock_entry","_prepare_v12_dynamic_for_stock_entry",
                       "_prepare_hype_zec_for_stock_entry"):
            def stub(*args, method=method):
                calls.append(method)
                return args[-1] if method != "_prepare_hype_zec_for_stock_entry" else args[-1]
            setattr(engine,method,stub)
        return engine,calls
    def test_spare_gross_never_preempts(self):
        engine,calls=self.setup_engine({"equityUsd":1000,"cryptoGross":1,"stockGross":0.5,"totalGross":1.5})
        with patch.object(subject.legacy.V52AsterOnlyEngine,"open_basis_position",return_value=True) as submit:
            self.assertTrue(engine.open_basis_position(subject.V11_SLOT,{},1))
            submit.assert_called_once()
        self.assertEqual(calls,[])
    def test_stock_cap_exceeded_blocks_before_any_preemption(self):
        engine,calls=self.setup_engine({"equityUsd":1000,"cryptoGross":0.25,"stockGross":4,"totalGross":4.25})
        with patch.object(subject.legacy.V52AsterOnlyEngine,"open_basis_position",side_effect=AssertionError("TEST_MUST_NEVER_ORDER")):
            self.assertFalse(engine.open_basis_position(subject.V11_SLOT,{},1))
        self.assertEqual(calls,[])
        self.assertTrue(engine._v52_last_entry_blocked_before_order)
    def test_total_cap_shortage_is_the_only_reason_to_inspect_preemption(self):
        engine,calls=self.setup_engine({"equityUsd":1000,"cryptoGross":3,"stockGross":1.25,"totalGross":4.25})
        with patch.object(subject.legacy.V52AsterOnlyEngine,"open_basis_position",side_effect=AssertionError("TEST_MUST_NEVER_ORDER")):
            self.assertFalse(engine.open_basis_position(subject.V11_SLOT,{},1))
        self.assertIn("_prepare_fet_for_stock_entry",calls)
        self.assertEqual(calls[0],"_prepare_idle_residual_for_stock_entry")
    def test_partial_spare_gross_blocks_unchanged_target_without_unneeded_stop_cancel(self):
        engine,calls=self.setup_engine({"equityUsd":1000,"cryptoGross":2,"stockGross":1,
                                       "totalGross":3})
        with patch.object(subject.legacy.V52AsterOnlyEngine,"open_basis_position",
                          side_effect=AssertionError("TEST_MUST_NEVER_ORDER")):
            self.assertFalse(engine.open_basis_position(subject.V11_SLOT,{},1.5))
        self.assertEqual(calls,[])
        self.assertTrue(engine._v52_last_entry_blocked_before_order)
    def test_first_successful_release_prevents_subsequent_FET_Q102_unneeded_reductions(self):
        exposure={"equityUsd":1000,"cryptoGross":3,"stockGross":1.25,"totalGross":4.25}
        engine,calls=self.setup_engine(exposure)
        engine.gross_snapshot=lambda: dict(exposure)
        def idle_release(slot,gross):
            calls.append("IDLE_ACTUALLY_RELEASED")
            exposure["cryptoGross"]=1.5
            exposure["totalGross"]=2.75
            return gross
        engine._prepare_idle_residual_for_stock_entry=idle_release
        with patch.object(subject.legacy.V52AsterOnlyEngine,"open_basis_position",
                          return_value=True) as submit:
            self.assertTrue(engine.open_basis_position(subject.V11_SLOT,{},1))
            submit.assert_called_once()
        self.assertEqual(calls,["IDLE_ACTUALLY_RELEASED"])
    def test_invalid_snapshot_fails_closed(self):
        engine,calls=self.setup_engine({"equityUsd":1000,"cryptoGross":float("nan"),"stockGross":0,"totalGross":float("nan")})
        with patch.object(subject.legacy.V52AsterOnlyEngine,"open_basis_position",side_effect=AssertionError("TEST_MUST_NEVER_ORDER")):
            with self.assertRaises(RuntimeError):
                engine.open_basis_position(subject.V11_SLOT,{},1)
        self.assertEqual(calls,[])
if __name__=="__main__":
    unittest.main()
