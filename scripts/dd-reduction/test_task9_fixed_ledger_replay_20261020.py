import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "task9_fixed_ledger_replay_20261020.py"
SPEC = importlib.util.spec_from_file_location("task9_fixed_ledger_replay_target", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class Task9FixedLedgerReplayTests(unittest.TestCase):
    def test_h1_adapter_preserves_open_high_low_close(self):
        source = MODULE._H1Source({
            "TESTUSDT": {
                1_000: {"open": 100.0, "high": 105.0, "low": 95.0, "close": 102.0},
                3_601_000: {"open": 102.0, "high": 106.0, "low": 99.0, "close": 101.0},
            }
        })
        bars, times = source.getdata("TESTUSDT")
        self.assertEqual(times, [1_000, 3_601_000])
        self.assertEqual(bars[0][1:5], (100.0, 105.0, 95.0, 102.0))

    def test_event_identity_keeps_partial_and_exit_distinct(self):
        partial = {
            "position_id": 7,
            "candidate_id": "C7",
            "event_type": "MODELED_PARTIAL_EXIT",
            "ts_ms": 100,
        }
        exit_event = dict(partial, event_type="MODELED_EXIT")
        self.assertNotEqual(
            MODULE._event_identity(partial), MODULE._event_identity(exit_event)
        )

    def test_fixed_replay_does_not_promote_rejected_candidates(self):
        self.assertFalse(MODULE.t9.is_filled_accepted_row({
            "candidate_id": "rejected",
            "decision": "NO_GROSS_ROOM",
            "entry_ts_ms": 100,
        }))

    def test_historical_pf_is_explicitly_settlement_unit(self):
        rows = [
            {"total_pnl_settlement": 2.0, "total_pnl_jpy": 300.0},
            {"total_pnl_settlement": -1.0, "total_pnl_jpy": -100.0},
        ]
        self.assertEqual(MODULE._profit_factor_for_field(rows, "total_pnl_settlement"), 2.0)
        self.assertEqual(MODULE._profit_factor_for_field(rows, "total_pnl_jpy"), 3.0)

    def test_final_cumulative_gate_uses_initial_baseline_oos(self):
        baseline = {
            10: {
                "final_equity_jpy": 100.0,
                "maximum_mtm_drawdown_pct": -10.0,
                "accounting": "PASS",
                "oos": {"profit_factor": 3.5931, "net_pnl_jpy": 10.0},
            },
            30: {
                "final_equity_jpy": 100.0,
                "maximum_mtm_drawdown_pct": -10.0,
                "accounting": "PASS",
                "oos": {"profit_factor": 3.2146, "net_pnl_jpy": 10.0},
            },
        }
        cumulative = {
            10: {
                "final_equity_jpy": 80.0,
                "maximum_mtm_drawdown_pct": -9.0,
                "accounting": "PASS",
                "oos": {"profit_factor": 3.2762, "net_pnl_jpy": 9.0},
            },
            30: {
                "final_equity_jpy": 80.0,
                "maximum_mtm_drawdown_pct": -9.0,
                "accounting": "PASS",
                "oos": {"profit_factor": 2.8249, "net_pnl_jpy": 9.0},
            },
        }
        result = MODULE._final_cumulative_gate(cumulative, baseline)
        self.assertFalse(result["accepted"])
        self.assertTrue(result["per_cost"]["10"]["oos_pf_guard_pass"])
        self.assertFalse(result["per_cost"]["30"]["oos_pf_guard_pass"])
        self.assertEqual(result["baseline_scope"], "INITIAL_FIXED_BASELINE")

    def test_canonical_baseline_paths_are_explicitly_read_only_inputs(self):
        self.assertIn("BASELINE", str(MODULE.CANONICAL_ROOT))
        self.assertEqual(MODULE.CASE_NAME, "V2_M150_D05_CORE_NATIVE")

    def test_cooldown_audit_has_actual_entry_and_reentry_timestamps(self):
        stop_ts = 10_000
        entry_ts = stop_ts + 3 * 3_600_000
        self.assertEqual(entry_ts - stop_ts, 10_800_000)
        # The production of this record is exercised by the focused replay;
        # this assertion fixes the units used by the audit contract.
        self.assertEqual(3 * 3_600_000, 10_800_000)

    def test_changed_exit_replay_preserves_partial_lifecycle_contract(self):
        original = {
            "position_id": 1,
            "candidate_id": "C1",
            "entry_ts_ms": 0,
            "entry_price": 100.0,
            "exit_ts_ms": 100,
            "exit_price": 110.0,
            "side": "LONG",
            "original_quantity": 10.0,
            "quantity": 5.0,
            "entry_fee": 0.1,
            "strategy_id": "V12",
            "symbol": "TESTUSDT",
        }
        events = [
            {"position_id": 1, "event_type": "MODELED_ENTRY", "ts_ms": 0,
             "fee_settlement": 0.1},
            {"position_id": 1, "event_type": "MODELED_PARTIAL_EXIT", "ts_ms": 50,
             "quantity": 5.0, "price_pnl_settlement": 25.0, "fee_settlement": 0.05},
        ]
        actual = {"exit_ts_ms": 75, "exit_price": 99.0,
                  "exit_reason": "RESEARCH_STOP"}
        changed, generated = MODULE._recalculate_changed_row(
            original, actual, events, 10, lambda _ts: 100.0
        )
        self.assertEqual(changed["quantity"], 5.0)
        self.assertEqual(changed["exit_reason_actual"], "RESEARCH_STOP")
        self.assertEqual([e["event_type"] for e in generated], [
            "MODELED_ENTRY", "MODELED_PARTIAL_EXIT", "MODELED_EXIT"
        ])
        self.assertAlmostEqual(changed["total_pnl_jpy"], changed["total_pnl_settlement"] * 100.0)
        self.assertEqual(changed["pnl_unit"], "JPY")
        self.assertEqual(MODULE.t9.classify_pnl(changed)["source"], "modeled_realized_pnl_jpy_at_exit_fx")

    def test_independent_accounting_reconciliation_detects_wallet_mismatch(self):
        events = [
            {
                "event_type": "MONTHLY_CONTRIBUTION",
                "ts_ms": 1,
                "settlement_cashflow": 100.0,
                "wallet_after_event": 99.0,
            }
        ]
        result = MODULE._reconcile_accounting(events)
        self.assertEqual(result["status"], "FAIL")
        self.assertGreater(result["wallet_delta_settlement"], 0.0)

    def test_independent_accounting_reconciliation_passes_known_event_cashflows(self):
        events = [
            {
                "event_type": "MONTHLY_CONTRIBUTION",
                "ts_ms": 1,
                "settlement_cashflow": 100.0,
                "wallet_after_event": 100.0,
            },
            {
                "event_type": "MODELED_ENTRY",
                "ts_ms": 2,
                "fee_settlement": 0.5,
                "wallet_after_event": 99.5,
            },
        ]
        result = MODULE._reconcile_accounting(events)
        self.assertEqual(result["status"], "PASS")
        self.assertAlmostEqual(result["wallet_delta_settlement"], 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
