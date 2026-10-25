import unittest

from scripts import research_formal_dynamic_score_bt as bt


class FormalDynamicScoreBacktestTests(unittest.TestCase):
    def test_fet_score_uses_completed_h1_72h_return_and_not_trade_outcome(self):
        entry_ts = 10 * bt.HOUR_MS
        market_rows = [
            {"event_time_ms": entry_ts - 73 * bt.HOUR_MS, "close": 100.0},
            {"event_time_ms": entry_ts - bt.HOUR_MS, "close": 110.0},
        ]
        candidate = {
            "strategy_id": "FET",
            "symbol": "FETUSDT",
            "entry_ts_ms": entry_ts,
            "unit_price_return": -0.99,
        }
        signal = {"signal": {"entryTs": entry_ts, "volumeRatio": 2.0}}

        score = bt.market_fit_for_candidate(candidate, [signal], market_rows)

        self.assertAlmostEqual(score["value"], 70.0)
        self.assertEqual(score["source"], "FET_COMPLETED_BREAKOUT_VOLUME_RETURN_V1")
        self.assertAlmostEqual(score["return72h"], 0.10)

    def test_rolling_prior_excludes_current_and_future_outcomes(self):
        rows = [
            {
                "strategy_id": "V12",
                "signal_ts_ms": 1_000,
                "exit_ts_ms": 900,
                "unit_price_return": 0.10,
                "funding_return_per_gross": 0.0,
            },
            {
                "strategy_id": "V12",
                "signal_ts_ms": 2_000,
                "exit_ts_ms": 3_000,
                "unit_price_return": 0.50,
                "funding_return_per_gross": 0.0,
            },
            {
                "strategy_id": "V12",
                "signal_ts_ms": 2_500,
                "exit_ts_ms": 2_400,
                "unit_price_return": -0.20,
                "funding_return_per_gross": 0.0,
            },
        ]

        table = bt.build_rolling_prior_table(rows, round_trip_cost_bps=10.0)

        self.assertEqual(table["rows"]["V12:2000"]["metrics"]["tradeCount"], 1)
        self.assertAlmostEqual(table["rows"]["V12:2000"]["metrics"]["returnPct"], 9.9)
        self.assertEqual(table["rows"]["V12:2500"]["metrics"]["tradeCount"], 1)
        self.assertIn("V12:1000", table["rows"]["V12:2000"]["priorIds"])
        self.assertNotIn("V12:2000", table["rows"]["V12:2000"]["priorIds"])

    def test_dynamic_allocation_keeps_pengu_at_point_seventy_five_cap(self):
        result = bt.allocate_dynamic_candidates(
            [
                {
                    "id": "v12",
                    "strategy_id": "V12",
                    "asset_class": "CRYPTO",
                    "marketFitScore": 60.0,
                    "targetGross": 2.0,
                    "minGross": 0.1,
                    "maxGross": 2.0,
                },
                {
                    "id": "pengu",
                    "strategy_id": "PENGU",
                    "asset_class": "CRYPTO",
                    "marketFitScore": 59.0,
                    "targetGross": 2.0,
                    "minGross": 0.1,
                    "maxGross": 2.0,
                },
            ],
            crypto_available=3.0,
            stock_available=4.0,
            total_available=4.25,
            equity_usd=100.0,
        )

        pengu = next(row for row in result["allocations"] if row["id"] == "pengu")
        self.assertLessEqual(pengu["allocatedGross"], 0.75 + 1e-12)
        self.assertLessEqual(result["totals"]["cryptoGross"], 3.0 + 1e-12)
        self.assertLessEqual(result["totals"]["totalGross"], 4.25 + 1e-12)

    def test_dynamic_allocation_respects_strategy_aggregate_room(self):
        result = bt.allocate_dynamic_candidates(
            [
                {
                    "id": "v12-a",
                    "strategy_id": "V12",
                    "asset_class": "CRYPTO",
                    "marketFitScore": 80.0,
                    "targetGross": 1.0,
                    "minGross": 0.1,
                    "maxGross": 1.0,
                },
                {
                    "id": "v12-b",
                    "strategy_id": "V12",
                    "asset_class": "CRYPTO",
                    "marketFitScore": 70.0,
                    "targetGross": 1.0,
                    "minGross": 0.1,
                    "maxGross": 1.0,
                },
            ],
            crypto_available=3.0,
            stock_available=0.0,
            total_available=4.25,
            equity_usd=100.0,
            strategy_available={"V12": 1.25},
        )

        self.assertLessEqual(
            sum(row["allocatedGross"] for row in result["allocations"]),
            1.25 + 1e-12,
        )

    def test_v12_rare_raw_score_is_causally_calibrated_without_future_or_peer_leakage(self):
        rows = [
            {"strategy_id": "V12", "signal_ts_ms": i * 1000,
             "marketFitScore": float(i), "marketFitScoreSource": "V12_COMPLETED_SIGNAL_SCORE_V1"}
            for i in range(1, 61)
        ]
        rows.append({"strategy_id": "V12", "signal_ts_ms": 60000, "marketFitScore": 0.2,
                     "marketFitScoreSource": "V12_COMPLETED_SIGNAL_SCORE_V1"})
        bt.normalize_v12_causal_score_percentiles(rows)
        self.assertEqual(rows[0]["marketFitScore"], 50.0)
        self.assertEqual(rows[0]["marketFitScoreSource"], "V12_COLD_START_NEUTRAL_RESEARCH_ONLY")
        self.assertEqual(rows[-2]["marketFitScoreHistoryCount"], 59)
        self.assertEqual(rows[-1]["marketFitScoreHistoryCount"], 59)
        self.assertLess(rows[-1]["marketFitScore"], rows[-2]["marketFitScore"])
        self.assertTrue(all(0 <= row["marketFitScore"] <= 100 for row in rows))

    def test_unregistered_strategy_cannot_bypass_gross_cap(self):
        rows = [{"id": "unknown", "strategy_id": "UNKNOWN", "asset_class": "CRYPTO",
                 "marketFitScore": 100.0, "minGross": 0.1, "maxGross": 20.0, "targetGross": 20.0}]
        result = bt.allocate_dynamic_candidates(
            rows, crypto_available=10, stock_available=0, total_available=10, equity_usd=100
        )
        self.assertEqual(result["allocations"], [])
        self.assertEqual(result["rejected"][0]["reason"], "UNREGISTERED_STRATEGY_CAP")

    def test_archived_eight_owner_core_priority_is_causal_and_conservative(self):
        active = {1: {"strategy_id": "V12", "symbol": "BTCUSDT"}}
        self.assertEqual(
            bt.archived_owner_exclusion("IDLE", active, []),
            "IDLE:CORE_SIGNAL_OR_POSITION")
        self.assertEqual(
            bt.archived_owner_exclusion("RESIDUAL", {}, [{"strategy_id": "Q102"}]),
            "RESIDUAL:CORE_SIGNAL_OR_POSITION")
        self.assertEqual(
            bt.archived_owner_exclusion("RESIDUAL", {}, [{"strategy_id": "IDLE"}]),
            "RESIDUAL:IDLE_PRIORITY")
        self.assertEqual(
            bt.archived_owner_exclusion("HYPE_LONG", active, []), None)
        self.assertEqual(
            bt.archived_owner_exclusion("IDLE", {}, []), None)

    def test_strategy_minimums_are_rechecked_at_admission_not_only_eligibility(self):
        rows = [
            {"id": "alpha", "strategy_id": "PENGU", "asset_class": "CRYPTO",
             "marketFitScore": 90, "minGross": 0.6, "targetGross": 0.75, "maxGross": 0.75},
            {"id": "beta", "strategy_id": "PENGU", "asset_class": "CRYPTO",
             "marketFitScore": 70, "minGross": 0.6, "targetGross": 0.75, "maxGross": 0.75},
            {"id": "gamma", "strategy_id": "FET", "asset_class": "CRYPTO",
             "marketFitScore": 60, "minGross": 0.2, "targetGross": 0.3, "maxGross": 0.3},
        ]
        result = bt.allocate_dynamic_candidates(
            rows, crypto_available=2, stock_available=0, total_available=2,
            equity_usd=1000, strategy_available={"PENGU": .75, "FET": .3},
        )
        admitted = result["allocations"]
        self.assertLessEqual(sum(x["allocatedGross"] for x in admitted if x["strategy_id"] == "PENGU"), .75 + 1e-10)
        self.assertTrue(any(x["strategy_id"] == "FET" for x in admitted))
        self.assertTrue(any(x["id"] == "beta" for x in result["rejected"]))

    def test_research_report_marks_bt_as_not_live(self):
        report = bt.render_research_report({
            "status": "COMPLETE_H1_PRICE_MODEL_NOT_L2_VERIFIED",
            "scenarios": [],
        })

        self.assertIn("LIVE=false", report)
        self.assertIn("DYNAMIC_SCORE", report)
        self.assertIn("H1", report)


if __name__ == "__main__":
    unittest.main()
