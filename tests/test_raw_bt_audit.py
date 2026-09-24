import unittest

from scripts.research.raw_data.audit_results import (
    build_audit_report,
    drawdown_intervals,
    monthly_equity,
    result_hash,
)


class RawBtAuditTests(unittest.TestCase):
    def test_extreme_return_is_attributed_to_trade(self):
        report = build_audit_report({"trades": [{"positionId": "p", "logic": "V12", "accountReturn": 2.5, "pnl": 250.0}]})
        self.assertEqual(report["extremeReturns"][0]["positionId"], "p")
        self.assertEqual(report["largestTradeContribution"], 250.0)

    def test_drawdown_peak_trough_and_recovery(self):
        points = [{"ts": 1, "equity": 100}, {"ts": 2, "equity": 80}, {"ts": 3, "equity": 110}]
        intervals = drawdown_intervals(points)
        self.assertEqual(intervals[0]["peakTs"], 1)
        self.assertEqual(intervals[0]["troughTs"], 2)
        self.assertEqual(intervals[0]["recoveryTs"], 3)
        self.assertAlmostEqual(intervals[0]["drawdownPct"], -20.0)

    def test_monthly_equity_is_deterministic(self):
        points = [{"ts": "2025-08-31T00:00:00Z", "equity": 100}, {"ts": "2025-09-30T00:00:00Z", "equity": 125}]
        self.assertEqual(monthly_equity(points), {"2025-08": 100, "2025-09": 125})

    def test_result_hash_is_stable_and_order_independent_for_keys(self):
        left = {"b": 2, "a": 1}
        right = {"a": 1, "b": 2}
        self.assertEqual(result_hash(left), result_hash(right))


if __name__ == "__main__":
    unittest.main()
