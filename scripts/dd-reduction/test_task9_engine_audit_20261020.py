import importlib.util
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parent / "task9_initial_adverse_stop_20261020.py"
SPEC = importlib.util.spec_from_file_location("task9_initial_adverse_stop_audit_target", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class Task9EngineAuditTests(unittest.TestCase):
    def test_missing_pnl_is_unsettled_not_a_loss(self):
        self.assertEqual(MODULE.classify_pnl({})["status"], "UNSETTLED")
        self.assertEqual(MODULE.classify_pnl({"total_pnl_jpy": None})["status"], "UNSETTLED")
        self.assertEqual(MODULE.classify_pnl({"total_pnl_jpy": 0})["status"], "FLAT")
        self.assertEqual(MODULE.classify_pnl({"total_pnl_jpy": 1.25})["status"], "WIN")
        self.assertEqual(MODULE.classify_pnl({"total_pnl_jpy": -1.25})["status"], "LOSS")

    def test_explicit_jpy_pnl_wins_over_legacy_settlement_named_field(self):
        result = MODULE.classify_pnl({
            "total_pnl_jpy": -1.0,
            "modeled_realized_pnl_jpy_at_exit_fx": 150.0,
        })
        self.assertEqual(result["status"], "WIN")
        self.assertEqual(result["value"], 150.0)
        self.assertEqual(result["source"], "modeled_realized_pnl_jpy_at_exit_fx")

    def test_exit_audit_preserves_original_exit_and_pnl(self):
        original = {
            "position_id": 5,
            "candidate_id": "C000005",
            "entry_ts_ms": 100,
            "exit_ts_ms": 400,
            "exit_price": 98.0,
            "exit_reason_actual": "TIME_48H",
            "total_pnl_jpy": 12.5,
        }
        actual = {
            "exit_ts_ms": 200,
            "exit_price": 99.0,
            "exit_reason": "RESEARCH_INITIAL_ADVERSE_STOP_TEST",
            "total_pnl_jpy": -2.0,
        }
        audit = MODULE.build_exit_audit(original, actual, "TEST_STOP")
        self.assertEqual(audit["original_outcome"], "WIN")
        self.assertEqual(audit["original_exit_reason"], "TIME_48H")
        self.assertEqual(audit["original_exit_ts_ms"], 400)
        self.assertEqual(audit["actual_exit_reason"], "RESEARCH_INITIAL_ADVERSE_STOP_TEST")
        self.assertEqual(audit["actual_pnl_jpy"], -2.0)

    def test_rejected_candidate_cannot_become_cooldown_source(self):
        self.assertFalse(MODULE.is_filled_accepted_row({"accepted": False, "position_id": 10}))
        self.assertTrue(MODULE.is_filled_accepted_row({"accepted": True, "position_id": 10, "entry_ts_ms": 1}))
        self.assertFalse(MODULE.is_filled_accepted_row({"accepted": True, "position_id": 10}))

    def test_canonical_ledger_fill_does_not_require_decision_field(self):
        row = {
            "position_id": 10,
            "candidate_id": "C000010",
            "entry_ts_ms": 100,
            "exit_ts_ms": 200,
            "entry_price": 10.0,
            "exit_price": 10.1,
            "quantity": 1.0,
        }
        self.assertTrue(MODULE.is_filled_accepted_row(row))

    def test_structure_gate_uses_corrected_price_scale(self):
        bars = [
            (0, 100.0, 102.0, 100.0, 102.0, 1.0),
            (1, 102.0, 102.0, 99.0, 101.0, 1.0),
            (2, 101.0, 101.0, 98.0, 99.0, 1.0),
            (3, 99.0, 99.0, 97.0, 98.0, 1.0),
        ]
        self.assertFalse(MODULE.structure_confirmed(bars, 3, 100.0, "LONG", 3, 3))
        self.assertTrue(MODULE.structure_confirmed(bars, 3, 100.0, "LONG", 3, 3, price_scale=0.98))

    def test_oos_metrics_sort_by_actual_exit_and_report_crossing(self):
        rows = [
            {"position_id": 2, "entry_ts_ms": 50, "exit_ts_ms": 300, "total_pnl_jpy": -2.0},
            {"position_id": 1, "entry_ts_ms": 150, "exit_ts_ms": 200, "total_pnl_jpy": 1.0},
        ]
        result = MODULE._oos_metrics(rows, 10, boundary=100)
        self.assertEqual(result["trades"], 2)
        self.assertEqual(result["crossing_trades"], 1)
        self.assertEqual(result["net_pnl_jpy"], -1.0)

    def test_future_stop_cannot_reject_an_earlier_entry(self):
        rows = [
            {
                "position_id": 1,
                "candidate_id": "C1",
                "accepted": True,
                "entry_ts_ms": 100,
                "exit_ts_ms": 1000,
                "strategy_id": "V12",
                "symbol": "BTCUSDT",
                "side": "SHORT",
                "entry_price": 100.0,
            },
            {
                "position_id": 2,
                "candidate_id": "C2",
                "accepted": True,
                "entry_ts_ms": 200,
                "exit_ts_ms": 1100,
                "strategy_id": "V12",
                "symbol": "BTCUSDT",
                "side": "SHORT",
                "entry_price": 100.0,
            },
        ]
        overlay = {
            "id": "TEST",
            "strategy": "V12",
            "sides": ["SHORT"],
            "reentry_hours": 0,
        }
        observations = {
            "eligible": 0,
            "triggered": 0,
            "original_winner_triggered": 0,
            "original_loser_triggered": 0,
            "original_unsettled_triggered": 0,
            "reentry_rejected": 0,
            "unfilled_skipped": 0,
            "stop_decisions": [],
            "cooldown_decisions": [],
            "data_gap": 0,
            "entry_mismatch": 0,
            "atr_unavailable": 0,
            "internal_gap": 0,
            "structure_unconfirmed": 0,
            "invalid_input": 0,
            "by_reason": Counter(),
        }

        def fake_stop(row, *_args, **_kwargs):
            return dict(row, exit_ts_ms=300) if row["position_id"] == 1 else row

        with patch.object(MODULE, "_apply_initial_stop", side_effect=fake_stop):
            output = MODULE._transform_rows(rows, [overlay], object(), 10, observations)

        self.assertEqual([row["position_id"] for row in output], [1, 2])
        self.assertEqual(observations["reentry_rejected"], 0)

    def test_cooldown_uses_only_a_stop_at_or_before_entry(self):
        rows = [
            {
                "position_id": 1,
                "candidate_id": "C1",
                "accepted": True,
                "entry_ts_ms": 100,
                "exit_ts_ms": 1000,
                "strategy_id": "V12",
                "symbol": "BTCUSDT",
                "side": "SHORT",
                "entry_price": 100.0,
            },
            {
                "position_id": 2,
                "candidate_id": "C2",
                "accepted": True,
                "entry_ts_ms": 400,
                "exit_ts_ms": 1100,
                "strategy_id": "V12",
                "symbol": "BTCUSDT",
                "side": "SHORT",
                "entry_price": 100.0,
            },
        ]
        overlay = {
            "id": "TEST",
            "strategy": "V12",
            "sides": ["SHORT"],
            "reentry_hours": 1,
        }
        observations = {
            "eligible": 0,
            "triggered": 0,
            "original_winner_triggered": 0,
            "original_loser_triggered": 0,
            "original_unsettled_triggered": 0,
            "reentry_rejected": 0,
            "unfilled_skipped": 0,
            "stop_decisions": [],
            "cooldown_decisions": [],
            "data_gap": 0,
            "entry_mismatch": 0,
            "atr_unavailable": 0,
            "internal_gap": 0,
            "structure_unconfirmed": 0,
            "invalid_input": 0,
            "by_reason": Counter(),
        }

        def fake_stop(row, *_args, **_kwargs):
            return dict(row, exit_ts_ms=300) if row["position_id"] == 1 else row

        with patch.object(MODULE, "_apply_initial_stop", side_effect=fake_stop):
            output = MODULE._transform_rows(rows, [overlay], object(), 10, observations)

        self.assertEqual([row["position_id"] for row in output], [1])
        self.assertEqual(observations["reentry_rejected"], 1)

if __name__ == "__main__":
    unittest.main(verbosity=2)
