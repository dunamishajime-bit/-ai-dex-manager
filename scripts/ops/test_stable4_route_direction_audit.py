import unittest
from stable4_route_direction_audit import evaluate_trade, aggregate, summarize_decisions

BASE = {
    "trade_id": "one", "strategy": "Q102", "route": "MR48",
    "symbol": "AVAXUSDT", "side": "LONG",
    "entry_utc": "2025-11-01T00:00:00Z",
    "exit_utc": "2025-11-02T00:00:00Z",
    "model_entry_price": "100",
    "model_exit_price": "110",
    "notional_jpy": "1000",
    "gross_x": "1.0", "net_pnl_jpy": "80",
}


class ResearchDirectionTests(unittest.TestCase):
    def test_long_correct_direction(self):
        x = evaluate_trade(BASE)
        self.assertEqual(x["priceDirection"], "correct")
        self.assertTrue(x["netWin"])
        self.assertAlmostEqual(x["netReturnPctOfNotional"], 8.0)
        self.assertEqual(x["period"], "earlier")

    def test_short_wrong_direction(self):
        x = evaluate_trade({**BASE, "side": "SHORT",
                            "entry_utc": "2026-06-01T00:00:00Z",
                            "exit_utc": "2026-06-01T01:00:00Z",
                            "net_pnl_jpy": "-100"})
        self.assertEqual(x["priceDirection"], "wrong")
        self.assertFalse(x["netWin"])
        self.assertEqual(x["period"], "later")

    def test_correct_direction_can_still_lose_after_cost(self):
        x = evaluate_trade({**BASE, "net_pnl_jpy": "-5"})
        self.assertEqual(x["priceDirection"], "correct")
        self.assertFalse(x["netWin"])
        self.assertEqual(aggregate([x])["correctDirectionButNetLossCount"], 1)

    def test_strict_nonfinite_or_invalid_prices(self):
        for v in ("0", "-1", "nan", "inf", "bad"):
            with self.subTest(value=v), self.assertRaises(ValueError):
                evaluate_trade({**BASE, "model_exit_price": v})

    def test_flat_is_not_wrong_or_correct(self):
        x = evaluate_trade({**BASE, "model_exit_price": "100"})
        self.assertEqual(x["priceDirection"], "flat")
        self.assertEqual(aggregate([x])["flatPriceDirectionCount"], 1)

    def test_normalized_return_and_aggregate(self):
        a = evaluate_trade(BASE)
        b = evaluate_trade({**BASE, "trade_id": "two",
                            "net_pnl_jpy": "-30", "model_exit_price": "90"})
        x = aggregate([a, b])
        self.assertEqual(x["n"], 2)
        self.assertEqual(x["netWinPct"], 50.0)
        self.assertEqual(x["wrongPriceDirectionPct"], 50.0)
        self.assertAlmostEqual(x["meanNetReturnPctOfNotional"], 2.5)

    def test_zero_rows_has_no_invented_win_rate(self):
        self.assertEqual(aggregate([])["netWinPct"], None)

    def test_v4_latched_dd_policy_blocks_not_missing_source(self):
        row = {"signal_id": "one", "strategy": "V4",
               "utc": "2026-04-05T00:00:00Z", "decision": "BLOCK",
               "reason": "V4_MAX_DRAWDOWN_21PCT_HOLD",
               "requested_gross": "0.75"}
        report = summarize_decisions([row])
        self.assertEqual(report["v4AfterMarchCandidates"], 1)
        self.assertEqual(report["v4AfterMarchDdHoldBlocks"], 1)
        self.assertIs(report["sourceCandidateAbsenceProven"], False)
        self.assertIs(report["v4DrawdownOwnerAndResetSemanticsCertified"], False)

    def test_duplicate_decision_is_rejected(self):
        row = {"signal_id": "same", "strategy": "V4",
               "utc": "2026-04-05T00:00:00Z", "decision": "BLOCK",
               "reason": "V4_MAX_DRAWDOWN_21PCT_HOLD",
               "requested_gross": "0.75"}
        with self.assertRaisesRegex(ValueError, "DUPLICATE_DECISION"):
            summarize_decisions([row, row])
    def test_entry_after_exit_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "TRADE_TIME"):
            evaluate_trade({**BASE, "entry_utc": "2026-01-02T00:00:00Z",
                            "exit_utc": "2026-01-01T00:00:00Z"})


if __name__ == "__main__":
    unittest.main()