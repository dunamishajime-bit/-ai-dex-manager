"""FET research feature audit tests: past-only, complete bars, stable labels."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from research.formal_five_bt.fet_entry_audit import (
    analyze_fet, asof_bars, fet_entry_features,
)

HOUR = 3_600_000
START = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
ENTRY = START + 74 * HOUR


def market_history(price: float, count: int = 75):
    return {
        START + n * HOUR: {
            "event_time_ms": START + n * HOUR,
            "open": price * (1 + n / 1_000),
            "high": price * (1 + n / 1_000) * 1.01,
            "low": price * (1 + n / 1_000) * 0.99,
            "close": price * (1 + n / 1_000),
            "base_volume": 1_000 + n,
        }
        for n in range(count)
    }


class FetPreEntryAuditTests(unittest.TestCase):
    def test_current_and_future_candles_cannot_change_features(self):
        fet = market_history(0.20)
        btc = market_history(90_000)
        original = fet_entry_features(fet, btc, ENTRY)
        fet[ENTRY] = {
            "event_time_ms": ENTRY, "open": 0.01, "high": 2,
            "low": 0.01, "close": 1.0, "base_volume": 1e10,
        }
        btc[ENTRY] = {
            "event_time_ms": ENTRY, "open": 1.0, "high": 1e9,
            "low": 1.0, "close": 1e9, "base_volume": 1e9,
        }
        self.assertEqual(fet_entry_features(fet, btc, ENTRY), original)
        self.assertEqual(len(asof_bars(fet, ENTRY, 73, "FETUSDT")), 73)

    def test_missing_hourly_history_fails_feature_availability(self):
        fet = market_history(0.20)
        btc = market_history(90_000)
        del fet[ENTRY - 5 * HOUR]
        with self.assertRaisesRegex(ValueError, "MISSING_CONTIGUOUS_PRE_ENTRY_H1"):
            fet_entry_features(fet, btc, ENTRY)

    def test_join_accepted_vs_rejected_and_hard_stop_label(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / "data/normalized/aster/klines"
            data.mkdir(parents=True)
            for symbol, history in (
                ("FETUSDT", market_history(0.2)),
                ("BTCUSDT", market_history(90_000)),
            ):
                (data / f"{symbol}.jsonl").write_text(
                    "".join(json.dumps(row) + "\n" for row in history.values()))
            decisions = root / "decisions.jsonl"
            rows = [
                {"candidate_id": "C1", "strategy_id": "FET",
                 "entry_ts_ms": ENTRY, "decision": "ACCEPTED_MODELED_ENTRY",
                 "reason": "GROSS_ALLOCATED", "requested_gross": 2.25},
                {"candidate_id": "C2", "strategy_id": "FET",
                 "entry_ts_ms": ENTRY, "decision": "REJECTED_PORTFOLIO",
                 "reason": "FET:SLOT_OCCUPIED", "requested_gross": 2.25},
            ]
            decisions.write_text("".join(json.dumps(row) + "\n" for row in rows))
            trades = root / "trades.jsonl"
            trades.write_text(json.dumps({
                "candidate_id": "C1", "strategy_id": "FET",
                "modeled_realized_pnl_jpy_at_exit_fx": -50.0,
                "exit_reason_actual": "FET_HARD_STOP", "accepted_gross": 2.25,
                "exit_ts_ms": ENTRY + HOUR,
            }) + "\n")
            out = analyze_fet(root / "data", decisions, trades, root / "out")
            self.assertEqual(out["candidate_counts"], {"HARD_STOP": 1, "REJECTED": 1})
            self.assertEqual(out["group_stats"]["HARD_STOP"]["missing_feature_count"], 0)
            self.assertTrue((root / "out/fet-preentry-feature-audit.jsonl").is_file())


if __name__ == "__main__":
    unittest.main()
