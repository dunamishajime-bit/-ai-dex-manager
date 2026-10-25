import importlib.util
import sys
import types
import unittest
from pathlib import Path


def load_simulator():
    module_name = "research_v12_v52_pengu_v2_combined_bt_under_test"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing

    legacy_name = "research_lab_v96_v52_dual_slot_one_year_bt"
    fake_legacy = types.ModuleType(legacy_name)

    def cost_adjusted_unit_trade_value(trade, cost_bps):
        return trade.get("netUnitReturn", 0.0) - cost_bps / 10_000.0

    fake_legacy.stock = types.SimpleNamespace(
        SCENARIOS={"NORMAL": 10.0, "SEVERE": 20.0},
        unit_trade_value=cost_adjusted_unit_trade_value,
    )
    fake_legacy.base = types.SimpleNamespace()
    fake_legacy.build_stock = lambda _cache_root: ([], [], [], {})
    prior_legacy = sys.modules.get(legacy_name)
    sys.modules[legacy_name] = fake_legacy
    try:
        path = Path(__file__).resolve().parents[1] / "scripts" / "research_v12_v52_pengu_v2_combined_bt.py"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load simulator module: {path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if prior_legacy is None:
            sys.modules.pop(legacy_name, None)
        else:
            sys.modules[legacy_name] = prior_legacy


SIM = load_simulator()
TS = SIM.START_MS + 3_600_000


def crypto_trade(kind, symbol, score, requested, exit_offset=3_600_000, **extra):
    trade = {
        "entryTs": TS,
        "exitTs": TS + exit_offset,
        "symbol": symbol,
        "requestedGross": requested,
        "marketFitScore": score,
        "netUnitReturn": 0.01,
        "exitReason": "synthetic",
    }
    trade.update(extra)
    return trade


def stock_trade(strategy, symbol, score, entry_ts=TS, exit_offset=3_600_000, **extra):
    trade = {
        "strategy": strategy,
        "symbol": symbol,
        "entryTs": entry_ts,
        "exitTs": entry_ts + exit_offset,
        "marketFitScore": score,
        "netUnitReturn": 0.01,
        "exitReason": "synthetic",
    }
    trade.update(extra)
    return trade


class DynamicScoreBacktestTests(unittest.TestCase):
    def test_same_timestamp_dynamic_routing_uses_score_not_fixed_priority(self):
        v12 = crypto_trade("V12", "ETHUSDT", 50, 1.5, minGross=0.25, targetGross=1.5, maxGross=1.5)
        pengu = crypto_trade("PENGU", "PENGUUSDT", 45, 0.75, minGross=0.25, targetGross=0.75, maxGross=0.75)
        v11 = stock_trade(
            "V11_EQ",
            "AAPL",
            90,
            minGross=0.5,
            targetGross=1.0,
            maxGross=1.0,
            signalTs=TS,
            marketFitScoreSource="signal_time:test_fixture",
        )
        v50 = stock_trade("V50_POST_OPEN_BASIS", "MSFT", None, minGross=0.25, targetGross=1.0, maxGross=1.0)

        dynamic = SIM.simulate([v12], [pengu], [v11], [v50], 1.0, 0.0, "DYNAMIC_SCORE")
        compatibility = SIM.simulate([v12], [pengu], [v11], [v50], 1.0, 0.0, "CRYPTO_FIRST")

        self.assertEqual(dynamic["dynamicScoreDiagnostics"]["perSleeve"]["STOCK"]["accepted"], 2)
        self.assertGreaterEqual(compatibility["routingDiagnostics"]["STOCK_CAPACITY_BLOCKED"], 1)
        fallback = next(row for row in dynamic["dynamicScoreDiagnostics"]["candidates"] if row["id"] == "V50_POST_OPEN_BASIS:MSFT")
        self.assertEqual(fallback["marketFitScore"], 0.0)
        self.assertEqual(fallback["scoreSource"], SIM.NEUTRAL_MARKET_FIT_SOURCE)
        self.assertEqual(fallback["signalTs"], None)
        causal = next(row for row in dynamic["dynamicScoreDiagnostics"]["candidates"] if row["id"] == "V11_EQ:AAPL")
        self.assertEqual(causal["signalTs"], TS)
        self.assertEqual(causal["scoreSource"], "signal_time:test_fixture")
        self.assertEqual(dynamic["routingDiagnostics"]["DYNAMIC_SCORE_CANDIDATES"], 4)
        self.assertIn("missingFieldBlocker", dynamic["dynamicScoreDiagnostics"]["marketFit"])
        self.assertLessEqual(dynamic["observedMaximumCryptoGross"], SIM.CRYPTO_GROSS_CAP + 1e-9)
        self.assertLessEqual(dynamic["observedMaximumStockGross"], SIM.STOCK_GROSS_CAP + 1e-9)
        self.assertLessEqual(dynamic["observedMaximumTotalGross"], SIM.TOTAL_GROSS_CAP + 1e-9)

    def test_capped_prior_bonus_is_applied_after_market_fit(self):
        strong_prior = {
            "returnPct": 80,
            "profitFactor": 3,
            "winRatePct": 80,
            "maxDrawdownPct": 0,
            "tradeCount": 100,
            "observationDays": 180,
        }
        high_fit = crypto_trade("V12", "ETHUSDT", 60, 0.5, btPrior=None)
        near_tie = crypto_trade("PENGU", "PENGUUSDT", 45, 0.5, btPrior=strong_prior)
        result = SIM.simulate([high_fit], [near_tie], [], [], 1.0, 0.0, "DYNAMIC_SCORE")
        rows = {row["id"]: row for row in result["dynamicScoreDiagnostics"]["candidates"]}

        self.assertEqual(rows["PENGU_DUAL_LS_V2:PENGUUSDT"].get("btPriorBonus"), 10.0)
        self.assertLess(rows["PENGU_DUAL_LS_V2:PENGUUSDT"]["finalScore"], rows["V12:ETHUSDT"]["finalScore"])
        self.assertEqual(SIM.calculate_bt_prior_bonus(strong_prior, 4), 4.0)
        self.assertLess(
            SIM.calculate_bt_prior_bonus({**strong_prior, "tradeCount": 10}),
            SIM.calculate_bt_prior_bonus(strong_prior),
        )

    def test_missing_or_nonfinite_prior_drawdown_contributes_zero(self):
        valid_bonus = SIM.calculate_bt_prior_bonus({
            "returnPct": 80,
            "profitFactor": 3,
            "winRatePct": 80,
            "maxDrawdownPct": 0,
            "tradeCount": 100,
            "observationDays": 180,
        })
        missing_drawdown = SIM.calculate_bt_prior_bonus({
            "returnPct": 80,
            "profitFactor": 3,
            "winRatePct": 80,
            "tradeCount": 100,
            "observationDays": 180,
        })
        nonfinite_drawdown = SIM.calculate_bt_prior_bonus({
            "returnPct": 80,
            "profitFactor": 3,
            "winRatePct": 80,
            "maxDrawdownPct": float("nan"),
            "tradeCount": 100,
            "observationDays": 180,
        })

        expected_without_drawdown = 10.0 * (
            0.30 * 1.0
            + 0.25 * 1.0
            + 0.20 * 1.0
        )
        self.assertGreater(valid_bonus, expected_without_drawdown)
        self.assertAlmostEqual(missing_drawdown, expected_without_drawdown)
        self.assertAlmostEqual(nonfinite_drawdown, expected_without_drawdown)

    def test_pengu_hard_cap_clamps_oversized_input_bounds(self):
        pengu = crypto_trade(
            "PENGU",
            "PENGUUSDT",
            80,
            0.75,
            minGross=0.25,
            targetGross=9.0,
            maxGross=9.0,
        )
        result = SIM.simulate([], [pengu], [], [], 1.0, 0.0, "DYNAMIC_SCORE")
        candidate = next(row for row in result["dynamicScoreDiagnostics"]["candidates"] if row["strategy"] == "PENGU_DUAL_LS_V2")
        allocation = next(row for row in result["dynamicScoreDiagnostics"]["allocations"] if row["strategy"] == "PENGU_DUAL_LS_V2")

        for row in (candidate, allocation):
            self.assertAlmostEqual(row["minGross"], 0.25)
            self.assertAlmostEqual(row["targetGross"], SIM.PENGU_MAX_GROSS)
            self.assertAlmostEqual(row["maxGross"], SIM.PENGU_MAX_GROSS)
        self.assertLessEqual(result["observedMaximumPenguGross"], SIM.PENGU_MAX_GROSS + 1e-9)

    def test_dynamic_stock_realization_retains_cost_adjusted_unit_return(self):
        trade = stock_trade("V11_EQ", "AAPL", 80, netUnitReturn=0.04)
        dynamic = SIM.simulate([], [], [trade], [], 1.0, 50.0, "DYNAMIC_SCORE")
        compatibility = SIM.simulate([], [], [trade], [], 1.0, 50.0, "STOCK_FIRST")

        expected_return = 0.04 - 50.0 / 10_000.0
        self.assertAlmostEqual(dynamic["endingEquity"], 1.0 + expected_return)
        self.assertAlmostEqual(dynamic["endingEquity"], compatibility["endingEquity"])

    def test_custom_prior_table_metadata_reaches_dynamic_diagnostics(self):
        custom_table = {
            "version": "review-round-1/v7",
            "trainingPeriod": {"start": "2024-01-01", "end": "2025-01-01"},
            "sourceShas": {"ledger": "abc123", "features": "def456"},
            "strategies": {},
        }
        result = SIM.simulate(
            [crypto_trade("V12", "ETHUSDT", 80, 0.5)],
            [],
            [],
            [],
            1.0,
            0.0,
            "DYNAMIC_SCORE",
            prior_table=custom_table,
        )

        self.assertEqual(result["dynamicScoreDiagnostics"]["btPrior"], {
            "version": custom_table["version"],
            "trainingPeriod": custom_table["trainingPeriod"],
            "sourceShas": custom_table["sourceShas"],
        })

    def test_partial_gross_respects_min_target_max_and_residual_pools(self):
        v12 = crypto_trade("V12", "ETHUSDT", 80, 1.5, minGross=0.25, targetGross=1.0, maxGross=1.0)
        pengu = crypto_trade("PENGU", "PENGUUSDT", 70, 0.75, minGross=0.25, targetGross=0.75, maxGross=0.75)
        v11 = stock_trade("V11_EQ", "AAPL", 60, minGross=0.5, targetGross=1.0, maxGross=1.0)
        result = SIM.simulate([v12], [pengu], [v11], [], 1.0, 0.0, "DYNAMIC_SCORE")

        for row in result["dynamicScoreDiagnostics"]["allocations"]:
            self.assertGreaterEqual(row["allocatedGross"], row["minGross"] - 1e-9)
            self.assertLessEqual(row["allocatedGross"], row["targetGross"] + 1e-9)
            self.assertLessEqual(row["allocatedGross"], row["maxGross"] + 1e-9)
        self.assertLessEqual(result["dynamicScoreDiagnostics"]["residual"]["totalGross"], SIM.TOTAL_GROSS_CAP)
        self.assertLessEqual(result["dynamicScoreDiagnostics"]["perSleeve"]["CRYPTO"]["allocatedGross"], SIM.CRYPTO_GROSS_CAP + 1e-9)
        self.assertLessEqual(result["dynamicScoreDiagnostics"]["perSleeve"]["STOCK"]["allocatedGross"], SIM.STOCK_GROSS_CAP + 1e-9)

    def test_invalid_minimum_notional_is_rejected(self):
        result = SIM.allocate_dynamic_gross(
            [{
                "id": "invalid-notional",
                "strategy": "V12",
                "symbol": "ETHUSDT",
                "assetClass": "CRYPTO",
                "marketFitScore": 10,
                "targetGross": 0.5,
                "minGross": 0.1,
                "maxGross": 0.5,
                "minNotionalUsd": "not-a-number",
            }],
            crypto_gross_available=1.0,
            stock_gross_available=0.0,
            total_gross_available=1.0,
            equity_usd=1_000.0,
        )
        self.assertEqual(result["rejected"], [{"id": "invalid-notional", "reason": "MIN_NOTIONAL_NOT_MET"}])

    def test_minimum_notional_rejects_strings_booleans_and_nonfinite_numbers(self):
        for invalid_value in ("100", True, float("nan"), float("inf")):
            with self.subTest(invalid_value=invalid_value):
                result = SIM.allocate_dynamic_gross(
                    [{
                        "id": f"invalid-notional-{type(invalid_value).__name__}",
                        "strategy": "V12",
                        "symbol": "ETHUSDT",
                        "assetClass": "CRYPTO",
                        "marketFitScore": 10,
                        "targetGross": 0.5,
                        "minGross": 0.1,
                        "maxGross": 0.5,
                        "minNotionalUsd": invalid_value,
                    }],
                    crypto_gross_available=1.0,
                    stock_gross_available=0.0,
                    total_gross_available=1.0,
                    equity_usd=1_000.0,
                )
                self.assertEqual(result["allocations"], [])
                self.assertEqual(result["rejected"][0]["reason"], "MIN_NOTIONAL_NOT_MET")

    def test_daily_loss_latch_remains_active(self):
        first_loss = crypto_trade("V12", "ETHUSDT", 80, 1.0, exit_offset=3_600_000, netUnitReturn=-0.20)
        after_latch = crypto_trade("V12", "BTCUSDT", 80, 1.0, exit_offset=3_600_000, entryTs=TS + 7_200_000)
        result = SIM.simulate([first_loss, after_latch], [], [], [], 1.0, 0.0, "DYNAMIC_SCORE")
        diagnostics = result["routingDiagnostics"]

        self.assertGreaterEqual(diagnostics["CRYPTO_DAILY_LOSS_LATCHES"], 1)
        self.assertGreaterEqual(diagnostics["V12_ENTRY_DAILY_LOSS_BLOCKED"], 1)

    def test_slot_limit_remains_active(self):
        slot_first = crypto_trade("PENGU", "PENGUUSDT", 80, 0.75, exit_offset=10_800_000)
        slot_second = crypto_trade("PENGU", "PENGUUSDT", 80, 0.75, entryTs=TS + 3_600_000, exit_offset=3_600_000)
        result = SIM.simulate([], [slot_first, slot_second], [], [], 1.0, 0.0, "DYNAMIC_SCORE")
        self.assertGreaterEqual(result["routingDiagnostics"]["PENGU_SLOT_OCCUPIED"], 1)

    def test_same_symbol_block_and_gross_caps_remain_active(self):
        stock_first = stock_trade("V11_EQ", "AAPL", 80, exit_offset=10_800_000)
        stock_same_symbol = stock_trade("V50_POST_OPEN_BASIS", "AAPL", 80, entry_ts=TS + 3_600_000)

        result = SIM.simulate(
            [],
            [],
            [stock_first],
            [stock_same_symbol],
            1.0,
            0.0,
            "DYNAMIC_SCORE",
        )
        diagnostics = result["routingDiagnostics"]

        self.assertGreaterEqual(diagnostics["SAME_STOCK_SYMBOL_BLOCKED"], 1)
        self.assertLessEqual(result["observedMaximumCryptoGross"], SIM.CRYPTO_GROSS_CAP + 1e-9)
        self.assertLessEqual(result["observedMaximumStockGross"], SIM.STOCK_GROSS_CAP + 1e-9)
        self.assertLessEqual(result["observedMaximumTotalGross"], SIM.TOTAL_GROSS_CAP + 1e-9)


if __name__ == "__main__":
    unittest.main()
