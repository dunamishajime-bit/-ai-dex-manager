from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from research.formal_five_bt.portfolio_price_model import run_portfolio_model, _mark, _equity, _trade_outcome_aggregates, _research_risk_cap, RISK_VARIANTS

HOUR = 3_600_000
START = int(datetime(2025, 8, 10, tzinfo=timezone.utc).timestamp() * 1000)


class PortfolioPriceModelTests(unittest.TestCase):
    def test_allocated_trade_win_loss_breakdown_includes_fees_funding_and_exit_fx(self):
        def trade(strategy, pnl, exit_reason, *, route=None, side="LONG"):
            return {
                "strategy_id": strategy, "total_pnl_jpy": pnl,
                "price_pnl": pnl + 2, "funding_pnl": 0,
                "entry_fee": 1, "exit_fee": 1,
                "exit_ts_ms": START + HOUR, "exit_reason_actual": exit_reason,
                "route": route, "side": side,
            }

        rows = [
            trade("FET", 100, "FET_PROFIT_FLOOR_STOP"),
            trade("FET", -40, "CORE_PREEMPT:V12"),
            trade("PENGU", -25, "SHORT_HARD_STOP", route="SHORT_V20", side="SHORT"),
            trade("PENGU", 10, "LONG_MAX_HOLD", route="BASE_V64_LONG"),
        ]
        out = _trade_outcome_aggregates(rows, lambda ts: 150.0)
        fet = out["by_strategy"]["FET"]
        self.assertEqual((fet["trades"], fet["winning_trades"], fet["losing_trades"]), (2, 1, 1))
        self.assertEqual(fet["gross_win_jpy"], 15000.0)
        self.assertEqual(fet["gross_loss_abs_jpy"], 6000.0)
        self.assertEqual(fet["net_pnl_jpy"], 9000.0)
        self.assertEqual(fet["fees_jpy"], 600.0)
        self.assertEqual(out["fet_by_exit_reason"]["CORE_PREEMPT:V12"]["losing_trades"], 1)
        pengu = out["by_strategy"]["PENGU"]
        self.assertEqual((pengu["winning_trades"], pengu["losing_trades"]), (1, 1))
        self.assertEqual(pengu["gross_win_jpy"], 1500.0)
        self.assertEqual(pengu["gross_loss_abs_jpy"], 3750.0)
        self.assertEqual(pengu["net_pnl_jpy"], -2250.0)
        self.assertEqual(out["pengu_by_route"]["SHORT_V20"]["losing_trades"], 1)
        self.assertEqual(out["pengu_by_side"]["SHORT"]["losing_trades"], 1)
        self.assertNotIn("trade_rows", str(out))

    def test_risk_variants_apply_by_route_and_family_at_decision_time(self):
        policies = dict(RISK_VARIANTS)
        self.assertEqual(_research_risk_cap(
            {"strategy_id": "FET"}, policies["FET_CAP_1P00"]), 1.0)
        self.assertEqual(_research_risk_cap(
            {"strategy_id": "PENGU", "route": "SHORT_V20"},
            policies["PENGU_SHORT_CAP_0P50"]), 0.5)
        self.assertEqual(_research_risk_cap(
            {"strategy_id": "PENGU", "route": "RECOVERY_V8"},
            policies["PENGU_SHORT_CAP_0P50"]), 1.0)
        self.assertEqual(_research_risk_cap(
            {"strategy_id": "PENGU", "route": "SHORT_V20"},
            policies["PENGU_SHORT_OFF"]), 0.0)
        self.assertEqual(_research_risk_cap(
            {"strategy_id": "Q102", "family": "BRK"},
            policies["Q102_BRK_CAP_1P00_MR_0P50"]), 1.0)
        self.assertEqual(_research_risk_cap(
            {"strategy_id": "Q102", "family": "MR"},
            policies["Q102_BRK_CAP_1P00_MR_0P50"]), 0.5)
        self.assertEqual(_research_risk_cap(
            {"strategy_id": "Q102", "family": "HIGH_VOL"},
            policies["Q102_BRK_CAP_1P00_MR_0P50"]), 3.0)
        self.assertEqual(_research_risk_cap(
            {"strategy_id": "V12"}, policies["COMBINED_FET1_SHORT0P5_Q102_BRK1_MR0P5"]), 2.0)

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
            (v52 / "v52-model-summary.json").write_text(json.dumps({
                "status": "RESEARCH_PRICE_MODEL_CLOSED_SAMPLE",
                "unresolved_exit_trades": 0,
            }) + "\n")
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

    def test_official_fx_cross_conversion_reconciles_usd_wallet_and_jpy_equity(self):
        from datetime import timedelta
        import hashlib

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data, candidates, fx, output = (
                root / "data", root / "candidates", root / "fx", root / "output")
            stock = data / "normalized/aster_stock/klines/AMZNUSDT.jsonl"
            stock.parent.mkdir(parents=True)
            prices = (100, 100, 120, 120, 120)
            rows = []
            for hour, price in enumerate(prices):
                ts = START + hour * HOUR
                rows.append({"event_time_ms": ts, "close_time_ms": ts + HOUR - 1,
                             "open": price, "high": price, "low": price, "close": price})
            stock.write_text("".join(json.dumps(row) + "\n" for row in rows))
            candidates.mkdir()
            (candidates / "crypto-price-model-candidates.jsonl").write_text(
                json.dumps({"status": "MODELED_CLOSED_TRADE", "strategy_id": "V52",
                            "symbol": "AMZNUSDT", "side": "LONG",
                            "entry_ts_ms": START + HOUR + HOUR // 2,
                            "signal_ts_ms": START + HOUR + HOUR // 2,
                            "entry_price": 100.0, "requested_gross": 2.0,
                            "exit_ts_ms": START + 2 * HOUR + HOUR // 2,
                            "exit_price": 120.0, "exit_reason": "TIME_OR_SESSION_FLAT",
                            "unit_price_return": 0.2}) + "\n")
            fx_file = fx / "normalized/ecb/usdjpy-cross.jsonl"
            fx_file.parent.mkdir(parents=True)
            start_day = datetime(2025, 8, 1, tzinfo=timezone.utc)
            ecb_rows = []
            for i in range(400):
                day = start_day + timedelta(days=i)
                ecb_rows.append({
                    "source": "ECB_CROSS_EUR", "instrument": "USDJPY",
                    "event_time_ms": int(day.timestamp() * 1000),
                    "source_time_ms": int(day.timestamp() * 1000),
                    "rate_jpy_per_usd": 150.0,
                })
            body = "".join(json.dumps(row) + "\n" for row in ecb_rows).encode()
            fx_file.write_bytes(body)
            (fx / "ecb-fx-cross-manifest.json").write_text(json.dumps({
                "status": "ACQUIRED_ECB_REFERENCE_CROSS_NOT_FRED_PARITY",
                "normalized_path": "normalized/ecb/usdjpy-cross.jsonl",
                "normalized_sha256": hashlib.sha256(body).hexdigest(),
                "observation_count": len(ecb_rows),
            }))
            report = run_portfolio_model(data, candidates, output, ecb_fx_root=fx)
            row = report["scenarios"][0]
            self.assertEqual(row["settlement_currency"], "USD")
            self.assertEqual(row["fx_reference"], "ECB_USDJPY_EUR_CROSS_NEXT_DAY")
            self.assertEqual(row["accounting_reconciliation"]["status"], "PASS")
            self.assertAlmostEqual(
                row["final_equity_jpy"], row["contributed_jpy"]
                + row["strategy_pnl_jpy"]["V52"], delta=1e-5)
            self.assertAlmostEqual(row["fx_cash_translation_pnl_jpy"], 0.0, delta=1e-5)

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
            aster_taker, base, stress = result["scenarios"]
            self.assertEqual(base["contributed_jpy"], 130_000)
            self.assertEqual(base["closed_trades"], 1)
            self.assertEqual(base["strategy_trades"]["PENGU"], 1)
            self.assertEqual(base["rejected_entries"]["PENGU:SLOT_OCCUPIED"], 1)
            self.assertGreater(base["final_equity_jpy"], 130_000)
            self.assertGreater(aster_taker["final_equity_jpy"], base["final_equity_jpy"])
            self.assertGreater(base["final_equity_jpy"], stress["final_equity_jpy"])
            self.assertTrue((output / "PRICE_MODEL_BASE_10BPS/portfolio-trades.jsonl").is_file())


if __name__ == "__main__":
    unittest.main()
