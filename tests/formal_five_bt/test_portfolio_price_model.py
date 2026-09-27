from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from research.formal_five_bt.portfolio_price_model import run_portfolio_model, _mark, _equity

HOUR = 3_600_000
START = int(datetime(2025, 8, 10, tzinfo=timezone.utc).timestamp() * 1000)


class PortfolioPriceModelTests(unittest.TestCase):
    def test_intrahour_mark_uses_prior_completed_bar_not_future_close(self):
        history = {
            "PENGUUSDT": {
                "times": [START, START + HOUR],
                "rows": [
                    {"event_time_ms": START, "open": 100, "close": 200},
                    {"event_time_ms": START + HOUR, "open": 101, "close": 999},
                ],
            }
        }
        self.assertEqual(_mark(history, "PENGUUSDT", START + HOUR), 101)
        self.assertEqual(_mark(history, "PENGUUSDT", START + HOUR + 1), 200)
        self.assertIsNone(_mark(history, "PENGUUSDT", START + 1))
        self.assertEqual(_mark(history, "PENGUUSDT", START + 2 * HOUR), 999)

    def test_missing_active_mark_blocks_equity_instead_of_dropping_open_loss(self):
        history = {
            "PENGUUSDT": {
                "times": [START],
                "rows": [{"event_time_ms": START, "open": 100, "close": 100}],
            }
        }
        active = {1: {"symbol": "PENGUUSDT", "side": "LONG",
                      "quantity": 10.0, "entry_price": 110.0}}
        with self.assertRaisesRegex(ValueError, "UNVERIFIED_ACTIVE_POSITION_MARK"):
            _equity(1000, active, history, START + 2 * HOUR)

    def test_v52_intrahour_cashflows_reconcile_to_final_equity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data, candidates, v52, output = (
                root / "data", root / "candidates", root / "v52", root / "output")
            stock = data / "normalized/aster_stock/klines/AMZNUSDT.jsonl"
            stock.parent.mkdir(parents=True)
            candles = []
            for hour, price in enumerate((100, 100, 120, 120, 120)):
                ts = START + hour * HOUR
                candles.append({
                    "event_time_ms": ts, "close_time_ms": ts + HOUR - 1,
                    "open": price, "high": price, "low": price,
                    "close": price, "base_volume": 1000,
                })
            stock.write_text("".join(json.dumps(row) + "\n" for row in candles))
            candidates.mkdir()
            (candidates / "crypto-price-model-candidates.jsonl").write_text("")
            v52.mkdir()
            entry_ts = START + HOUR + HOUR // 2
            exit_ts = START + 2 * HOUR + HOUR // 2
            trade = {
                "status": "MODELED_CLOSED_TRADE", "symbol": "AMZNUSDT",
                "side": "LONG", "entry_ts_ms": entry_ts,
                "exit_ts_ms": exit_ts, "aster_entry_price_usd": 100.0,
                "aster_exit_price_usd": 120.0,
                "gross_price_return": 0.2, "slot_gross": 2.0,
                "reason": "TIME_OR_SESSION_FLAT",
            }
            (v52 / "v52-model-ledger.jsonl").write_text(json.dumps(trade) + "\n")
            result = run_portfolio_model(data, candidates, output, v52_ledger_root=v52)
            for scenario in result["scenarios"]:
                self.assertEqual(scenario["strategy_trades"]["V52"], 1)
                self.assertEqual(scenario["accounting_reconciliation"]["status"], "PASS")
                self.assertGreater(scenario["accounting_reconciliation"]["intrahour_events"], 0)
                self.assertAlmostEqual(
                    scenario["final_equity_jpy"] - scenario["contributed_jpy"],
                    scenario["strategy_pnl_jpy"]["V52"],
                    delta=1e-5,
                )
                self.assertAlmostEqual(
                    scenario["accounting_reconciliation"]["equity_minus_wallet_nominal_jpy"],
                    0.0,
                    delta=1e-5,
                )

    def test_missing_hourly_open_mark_invalidates_dd_instead_of_omitting_risk(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data, candidates, output = root / "data", root / "candidates", root / "output"
            path = data / "normalized/aster/klines/PENGUUSDT.jsonl"
            path.parent.mkdir(parents=True)
            candles = []
            # An H1 gap at START+2h and +3h prevents any safe as-of
            # position mark at +3h; the exit at +4h remains modeled.
            for hour, price in ((0, 100), (1, 100), (4, 80)):
                ts = START + hour * HOUR
                candles.append({"event_time_ms": ts, "open": price,
                                "high": price, "low": price, "close": price,
                                "close_time_ms": ts + HOUR - 1})
            path.write_text("".join(json.dumps(row) + "\n" for row in candles))
            candidates.mkdir()
            candidate = {
                "strategy_id": "PENGU", "symbol": "PENGUUSDT", "side": "LONG",
                "entry_ts_ms": START + HOUR, "signal_ts_ms": START,
                "entry_price": 100, "requested_gross": 1.0,
                "entry_version": "LONG_V2_FINAL", "route": "BASE_V64_LONG",
                "status": "MODELED_CLOSED_TRADE", "exit_ts_ms": START + 4 * HOUR,
                "exit_price": 80, "exit_reason": "LONG_MAX_HOLD",
                "unit_price_return": -0.2,
            }
            (candidates / "crypto-price-model-candidates.jsonl").write_text(
                json.dumps(candidate) + "\n")
            result = run_portfolio_model(data, candidates, output)
            row = result["scenarios"][0]
            self.assertEqual(row["status"], "INCOMPLETE_MTM_H1_PRICE_MODEL")
            self.assertGreater(row["missing_active_position_mtm_hours"], 0)
            self.assertIsNone(row["maximum_mtm_drawdown"])
            self.assertEqual(result["status"], "INCOMPLETE_ALL_FIVE_PRICE_MODEL")

    def test_compounds_causal_trade_and_keeps_pengu_one_slot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / "data"
            candidates = root / "candidates"
            output = root / "output"
            kline = data / "normalized/aster/klines/PENGUUSDT.jsonl"
            kline.parent.mkdir(parents=True)
            rows = []
            for i, price in enumerate((100, 102, 110, 110, 110)):
                ts = START + i * HOUR
                rows.append({
                    "source": "aster", "exchange": "ASTER", "instrument": "PENGUUSDT",
                    "interval": "1h", "event_time_ms": ts, "close_time_ms": ts + HOUR - 1,
                    "open": price, "high": price * 1.01, "low": price * 0.99,
                    "close": price, "base_volume": 1_000, "quote_volume": 100_000,
                })
            kline.write_text("".join(json.dumps(row) + "\n" for row in rows))
            candidates.mkdir()
            trade = {
                "strategy_id": "PENGU", "symbol": "PENGUUSDT", "side": "LONG",
                "entry_ts_ms": START + HOUR, "signal_ts_ms": START,
                "entry_price": 102.0, "requested_gross": 1.0, "entry_version": "LONG_V2_FINAL",
                "route": "BASE_V64_LONG", "status": "MODELED_CLOSED_TRADE",
                "exit_ts_ms": START + 2 * HOUR, "exit_price": 110.0,
                "exit_reason": "LONG_MAX_HOLD", "unit_price_return": 110 / 102 - 1,
            }
            duplicate = dict(trade)
            duplicate["signal_ts_ms"] = START + 1
            (candidates / "crypto-price-model-candidates.jsonl").write_text(
                json.dumps(trade) + "\n" + json.dumps(duplicate) + "\n")
            result = run_portfolio_model(data, candidates, output)
            base, stress = result["scenarios"]
            self.assertEqual(base["contributed_jpy"], 130_000)
            self.assertEqual(base["closed_trades"], 1)
            self.assertEqual(base["strategy_trades"]["PENGU"], 1)
            self.assertEqual(base["rejected_entries"]["PENGU:SLOT_OCCUPIED"], 1)
            self.assertGreater(base["final_equity_jpy"], 130_000)
            self.assertGreater(base["final_equity_jpy"], stress["final_equity_jpy"])
            self.assertTrue((output / "PRICE_MODEL_BASE_10BPS/portfolio-trades.jsonl").is_file())


if __name__ == "__main__":
    unittest.main()
