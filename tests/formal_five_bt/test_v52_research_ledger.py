"""Fixture-only V52 research ledger tests; no venue connectivity required."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import unittest

from research.formal_five_bt import v52_research_ledger as ledger
from research.formal_five_bt.v52_price_only_scan import PerpBar
from research.formal_five_bt.yahoo_v52 import YahooBar


def ms(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


ENTRY = ms("2026-06-15T15:30:00Z")
EXIT = ms("2026-06-15T16:30:00Z")
SHA = "a" * 64


def stock_data(*, missing_exit=False, exit_perp_price=100.6,
               exit_equity_price=100.5):
    yah = [YahooBar("NVDA", ms("2026-06-15T14:30:00Z"), ENTRY,
                    100, 101, 99, 100, 10, SHA)]
    if not missing_exit:
        yah.append(YahooBar("NVDA", ENTRY, EXIT, 100.5, 101, 100,
                            exit_equity_price, 10, SHA))
    perp = [PerpBar("NVDA", ms("2026-06-15T15:00:00Z"), 101, SHA),
            PerpBar("NVDA", ms("2026-06-15T16:00:00Z"), exit_perp_price, SHA)]
    return ({"NVDA": yah}, {"NVDA": perp})


def candidate():
    return {
        "symbol": "NVDAUSDT", "side": "SHORT",
        "decision_ts_ms": ENTRY, "window_ny": "11:30",
        "entry_basis_bps": 100.0, "aster_price_usd": 101,
        "yahoo_reference_usd": 100,
    }


class V52ResearchLedgerTests(unittest.TestCase):
    def run_case(self, *, missing_exit=False, perp_price=100.6, equity_price=100.5):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.mkdir(exist_ok=True)
            (root / "price-only-scan-manifest.json").write_text(json.dumps({
                "runtime_policy_sha256": "p" * 64,
                "period_end_exclusive": "2026-08-11",
            }))
            data = stock_data(missing_exit=missing_exit,
                              exit_perp_price=perp_price,
                              exit_equity_price=equity_price)
            policy = {
                "convergenceBps": 20,
                "basisStopMultiple": 1.75,
                "maximumHoldingHours": 3,
            }
            with (patch.object(ledger, "load_manifest", return_value={"runtime_sha":"test"}),
                  patch.object(ledger, "load_price_only_research",
                               return_value=([candidate()], {"model": "RESEARCH", "scan_sha256": SHA})),
                  patch.object(ledger, "verified_policy",
                               return_value=(policy, "p" * 64)),
                  patch.object(ledger, "_load_prices", return_value=data)):
                report = ledger.replay_v52_research(
                    root, root, root / "out")
            return report, [
                json.loads(line) for line in
                (root / "out" / "v52-model-ledger.jsonl").read_text().splitlines()
            ]

    def test_convergence_closes_at_first_checkpoint_without_actual_fill_claim(self):
        result, trades = self.run_case()
        self.assertEqual(result["status"], "RESEARCH_PRICE_MODEL_CLOSED_SAMPLE")
        self.assertEqual(result["selected_unallocated_candidates"], 1)
        self.assertEqual(result["modeled_closed_trades"], 1)
        self.assertEqual(result["verified_final_equity_jpy"], None)
        self.assertEqual(result["exit_reasons"]["BASIS_CONVERGED"], 1)
        self.assertFalse(trades[0]["exchange_fill_verified"])
        self.assertEqual(trades[0]["exit_ts_ms"], EXIT)
        self.assertIsNone(trades[0]["funding_usdt"])
        self.assertGreater(trades[0]["modeled_return_on_equity"], 0)

    def test_missing_completed_exit_bar_cannot_make_an_optimistic_fill(self):
        result, trades = self.run_case(missing_exit=True)
        self.assertEqual(result["status"], "NOT_VERIFIABLE_INCOMPLETE_PRICE_MODEL")
        self.assertEqual(result["unresolved_exit_trades"], 1)
        self.assertEqual(result["modeled_closed_trades"], 0)
        self.assertIsNone(result["price_model_closed_trade_mean_return"])
        self.assertIsNone(trades[0]["modeled_return_on_equity"])

    def test_stop_overrides_time_and_reports_price_only_loss(self):
        result, trades = self.run_case(perp_price=102.9, equity_price=100.5)
        self.assertEqual(result["exit_reasons"]["BASIS_STOP"], 1)
        self.assertLess(trades[0]["modeled_return_on_equity"], 0)

    def test_1330_entry_forces_flat_at_1530_not_1630(self):
        # At 13:30 New York a 3h timer would run beyond the production
        # 15:30 forced-flat guard. The model must not hold after that guard.
        entry = ms("2026-06-15T17:30:00Z")
        checkpoint1 = ms("2026-06-15T18:30:00Z")
        cutoff = ms("2026-06-15T19:30:00Z")
        self.assertEqual(ledger._forced_flat_ms(entry, {"maximumHoldingHours": 3}), cutoff)
        yahoo = [
            YahooBar("NVDA", entry - 3600000, entry,
                     100, 101, 99, 100, 10, SHA),
            YahooBar("NVDA", entry, checkpoint1,
                     100, 101, 99, 100, 10, SHA),
            YahooBar("NVDA", checkpoint1, cutoff,
                     100, 101, 99, 100, 10, SHA),
        ]
        perp = [
            PerpBar("NVDA", ms("2026-06-15T17:00:00Z"), 101, SHA),
            PerpBar("NVDA", ms("2026-06-15T18:00:00Z"), 101, SHA),
            PerpBar("NVDA", ms("2026-06-15T19:00:00Z"), 101, SHA),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "price-only-scan-manifest.json").write_text(json.dumps({
                "runtime_policy_sha256": "p" * 64,
                "period_end_exclusive": "2026-08-11",
            }))
            row = {**candidate(), "decision_ts_ms": entry}
            policy = {"convergenceBps": 20, "basisStopMultiple": 1.75,
                      "maximumHoldingHours": 3}
            with (patch.object(ledger, "load_manifest", return_value={"runtime_sha": "test"}),
                  patch.object(ledger, "load_price_only_research",
                               return_value=([row], {"model": "RESEARCH", "scan_sha256": SHA})),
                  patch.object(ledger, "verified_policy",
                               return_value=(policy, "p" * 64)),
                  patch.object(ledger, "_load_prices",
                               return_value=({"NVDA": yahoo}, {"NVDA": perp}))):
                result = ledger.replay_v52_research(root, root, root / "out")
            self.assertEqual(result["status"], "RESEARCH_PRICE_MODEL_CLOSED_SAMPLE")
            self.assertEqual(result["modeled_closed_trades"], 1)
            trade = json.loads((root / "out/v52-model-ledger.jsonl").read_text().splitlines()[0])
            self.assertEqual(trade["exit_ts_ms"], cutoff)
            self.assertEqual(trade["exit_reasons"] if "exit_reasons" in trade else trade["reason"],
                             "TIME_OR_SESSION_FLAT")

    def test_early_close_never_schedules_after_official_close(self):
        entry = ms("2025-11-28T16:30:00Z")  # 11:30 EST early-close session
        self.assertEqual(ledger._forced_flat_ms(entry, {"maximumHoldingHours": 3}),
                         ms("2025-11-28T18:00:00Z"))

    def test_unresolved_exit_skips_current_session_but_replays_next_session(self):
        first = ms("2026-06-15T15:30:00Z")
        same_day = ms("2026-06-15T17:30:00Z")
        next_day = ms("2026-06-16T15:30:00Z")
        next_exit = ms("2026-06-16T16:30:00Z")
        first_bar = YahooBar("NVDA", first - 3600000, first,
                             100, 101, 99, 100, 10, SHA)
        next_entry_bar = YahooBar("NVDA", next_day - 3600000, next_day,
                                  100, 101, 99, 100, 10, SHA)
        next_exit_bar = YahooBar("NVDA", next_day, next_exit,
                                 100, 101, 99, 100.5, 10, SHA)
        yahoo = {"NVDA": [first_bar, next_entry_bar, next_exit_bar]}
        perp = {"NVDA": [
            PerpBar("NVDA", ms("2026-06-15T15:00:00Z"), 101, SHA),
            PerpBar("NVDA", ms("2026-06-16T15:00:00Z"), 101, SHA),
            PerpBar("NVDA", ms("2026-06-16T16:00:00Z"), 100.6, SHA),
        ]}
        selected = [{**candidate(), "decision_ts_ms": ts}
                    for ts in (first, same_day, next_day)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "price-only-scan-manifest.json").write_text(json.dumps({
                "runtime_policy_sha256": "p" * 64,
                "period_end_exclusive": "2026-08-11",
            }))
            policy = {"convergenceBps": 20, "basisStopMultiple": 1.75,
                      "maximumHoldingHours": 3}
            with (patch.object(ledger, "load_manifest", return_value={"runtime_sha": "test"}),
                  patch.object(ledger, "load_price_only_research",
                               return_value=(selected, {"model": "RESEARCH", "scan_sha256": SHA})),
                  patch.object(ledger, "verified_policy",
                               return_value=(policy, "p" * 64)),
                  patch.object(ledger, "_load_prices",
                               return_value=(yahoo, perp))):
                result = ledger.replay_v52_research(root, root, root / "out")
            self.assertEqual(result["status"], "NOT_VERIFIABLE_INCOMPLETE_PRICE_MODEL")
            self.assertEqual(result["selected_unallocated_candidates"], 3)
            self.assertEqual(result["modeled_entries"], 2)
            self.assertEqual(result["modeled_closed_trades"], 1)
            self.assertEqual(result["unresolved_exit_trades"], 1)
            self.assertEqual(result["sessions_with_unresolved_exits"], ["2026-06-15"])
            self.assertEqual(result["skipped_reasons"]["PREVIOUS_EXIT_UNVERIFIED_SAME_SESSION"], 1)
            self.assertIsNone(result["price_model_closed_trade_mean_return"])
            trades = [json.loads(line) for line in
                      (root / "out/v52-model-ledger.jsonl").read_text().splitlines()]
            closed = [row for row in trades if row["status"] == "MODELED_CLOSED_TRADE"]
            self.assertEqual(closed[0]["entry_ts_ms"], next_day)
            self.assertEqual(closed[0]["exit_ts_ms"], next_exit)

    def test_invalid_assumed_cost_or_gross_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "INVALID_RESEARCH"):
                ledger.replay_v52_research(root, root, root, round_trip_cost_bps=-1)
            with self.assertRaisesRegex(ValueError, "INVALID_RESEARCH"):
                ledger.replay_v52_research(root, root, root, slot_gross=4)


if __name__ == "__main__":
    unittest.main()
