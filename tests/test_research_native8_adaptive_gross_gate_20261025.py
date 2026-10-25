"""Causal source-expressions used by the native eight-owner research replay."""
import inspect
import unittest

from scripts import research_native8_adaptive_gross_gate_20261025 as native
from scripts import research_native8_selective_gross_rescue_20261025 as selective


class NativeEightAdaptiveGrossTests(unittest.TestCase):
    @staticmethod
    def other_hold(positions, candidate_strategy, ts):
        context={"active":positions,"strategy":candidate_strategy,"ts":ts}
        return eval(native.OTHER_HELD_PREEXISTING_EXPR, context, context)

    @staticmethod
    def past_completed(rows, strategy, ts):
        context={"completed":rows,"strategy":strategy,"ts":ts}
        return eval(native.PAST_CLOSED_STRATEGY_TRADES_EXPR, context, context)

    def test_only_different_strategy_opened_before_signal_enables_rescue(self):
        original = {"a":{"strategy_id":"V12","entry_ts_ms":100,"quantity":1}}
        self.assertTrue(self.other_hold(original,"IDLE",101))
        self.assertFalse(self.other_hold(original,"V12",101))
        self.assertFalse(self.other_hold(original,"IDLE",100))
        self.assertFalse(self.other_hold({}, "IDLE", 101))
        self.assertFalse(self.other_hold({"a":{"strategy_id":"IDLE","entry_ts_ms":99,"quantity":1}}, "IDLE", 101))
        self.assertFalse(self.other_hold({"a":{"strategy_id":"Q102","entry_ts_ms":103,"quantity":1}}, "IDLE", 101))

    def test_future_or_same_timestamp_closed_positions_do_not_influence_score(self):
        closed = [
            {"strategy_id":"IDLE","exit_ts_ms":100, "total_pnl_jpy":-1},
            {"strategy_id":"IDLE","exit_ts_ms":101, "total_pnl_jpy":5},
            {"strategy_id":"IDLE","exit_ts_ms":110, "total_pnl_jpy":5},
            {"strategy_id":"V12","exit_ts_ms":90, "total_pnl_jpy":999},
        ]
        self.assertEqual(self.past_completed(closed,"IDLE",101), closed[:1])
        self.assertEqual(self.past_completed(closed,"IDLE",111), closed[:3])
        self.assertEqual(self.past_completed(closed,"Q102",111), [])

    def test_research_minimum_does_not_override_native_min_quantity(self):
        self.assertEqual(native.RESEARCH_MIN_RESIDUAL_GROSS, 0.05)
        self.assertEqual(selective.RESEARCH_MIN_RESIDUAL_GROSS, 0.05)
        for module in (native,selective):
            source=inspect.getsource(module.replay)
            self.assertIn('_normalize_quantity(candidate["symbol"],quantity,entry_price)',source)
            self.assertIn("NATIVE_VENUE_QTY_PROOF_REQUIRED",source)
            self.assertIn("NATIVE_FULL_1X_GROSS_SOURCE_MISMATCH",source)
            self.assertIn("NATIVE_1X_QUANTITY_GATE_SOURCE_MISMATCH",source)
            self.assertIn("original(text,strict)",source)
            self.assertIn("mode==\"inspect\"",source)

    def test_selective_symbol_exclusion_affects_only_rescue_branch(self):
        source=inspect.getsource(selective.replay)
        self.assertIn("candidate['symbol'] != 'JUPUSDT'",source)
        self.assertIn("candidate['symbol'] not in ('JUPUSDT','TIAUSDT')",source)
        self.assertIn("if mode.startswith(\"adaptive_score\")",source)
        self.assertIn("score",source)

    def test_source_binding_consistency(self):
        self.assertEqual(native.OTHER_HELD_PREEXISTING_EXPR,selective.OTHER_HELD_PREEXISTING_EXPR)
        self.assertEqual(native.PAST_CLOSED_STRATEGY_TRADES_EXPR,selective.PAST_CLOSED_STRATEGY_TRADES_EXPR)


if __name__=="__main__":
    unittest.main()
