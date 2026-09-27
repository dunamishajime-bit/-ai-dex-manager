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

    def test_invalid_assumed_cost_or_gross_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "INVALID_RESEARCH"):
                ledger.replay_v52_research(root, root, root, round_trip_cost_bps=-1)
            with self.assertRaisesRegex(ValueError, "INVALID_RESEARCH"):
                ledger.replay_v52_research(root, root, root, slot_gross=4)


if __name__ == "__main__":
    unittest.main()
