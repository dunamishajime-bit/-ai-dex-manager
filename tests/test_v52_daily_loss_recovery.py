import unittest
from datetime import datetime, timezone

from scripts.disdex_v52_daily_loss import update_v52_strategy_daily_latch


class V52DailyLossRecoveryTests(unittest.TestCase):
    def test_data_failure_latch_is_recomputed_after_data_recovers(self):
        now_ms = int(datetime(2025, 8, 31, tzinfo=timezone.utc).timestamp() * 1000)
        previous = {
            "latchName": "v52StrategyDailyLossLatch",
            "utcDay": "2025-08-31",
            "strategyStartCapitalUsd": 1000.0,
            "tripped": True,
            "failClosed": True,
            "tripReason": "V52 PnL API failure: permission denied",
        }

        recovered = update_v52_strategy_daily_latch(
            previous=previous,
            trades=[],
            unrealized_pnl=0.0,
            strategy_capital_usd=1000.0,
            now_ms=now_ms,
            maximum_daily_loss_pct=3.5,
            data_available=True,
        )

        self.assertFalse(recovered["tripped"])
        self.assertFalse(recovered["failClosed"])
        self.assertEqual(recovered["resetReason"], "FAIL_CLOSED_DATA_RECOVERED")

    def test_real_daily_loss_latch_remains_sticky(self):
        now_ms = int(datetime(2025, 8, 31, tzinfo=timezone.utc).timestamp() * 1000)
        previous = {
            "latchName": "v52StrategyDailyLossLatch",
            "utcDay": "2025-08-31",
            "strategyStartCapitalUsd": 1000.0,
            "tripped": True,
            "failClosed": False,
            "tripReason": "V52 strategy daily loss limit reached",
        }

        still_tripped = update_v52_strategy_daily_latch(
            previous=previous,
            trades=[],
            unrealized_pnl=0.0,
            strategy_capital_usd=1000.0,
            now_ms=now_ms,
            maximum_daily_loss_pct=3.5,
            data_available=True,
        )

        self.assertTrue(still_tripped["tripped"])
        self.assertFalse(still_tripped["failClosed"])


if __name__ == "__main__":
    unittest.main()
