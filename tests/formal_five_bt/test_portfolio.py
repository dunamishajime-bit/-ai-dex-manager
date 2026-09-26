from datetime import date, datetime, timezone
import unittest

from research.formal_five_bt.market_data import FxRate
from research.formal_five_bt.portfolio import build_live_intent, monthly_deposit_events, plan_with_live_allocator
from research.formal_five_bt.strategies import RuntimeBridge


DAY = 86_400_000


class PortfolioAccountingTests(unittest.TestCase):
    def test_initial_capital_and_twelve_anniversary_deposits_are_separate_events(self):
        base = int(datetime(2025, 8, 9, tzinfo=timezone.utc).timestamp() * 1000)
        rates = tuple(
            FxRate("FRED", "DEXJPUS", "daily_reference", ts, ts, ts, f"{i:064x}", 150.0)
            for i, ts in enumerate(range(base, base + 400 * DAY, DAY), start=1)
        )
        events = monthly_deposit_events(rates, start_date=date(2025, 8, 10))
        self.assertEqual(len(events), 13)
        self.assertEqual(events[0].amount_jpy, 10_000)
        self.assertTrue(all(event.amount_jpy == 10_000 for event in events[1:]))
        self.assertEqual(events[-1].cumulative_jpy, 130_000)
        self.assertAlmostEqual(events[-1].cumulative_usdt, 130_000 / 150)
        self.assertEqual(events[1].timestamp_ms - events[0].timestamp_ms, 31 * DAY)

    def test_live_allocator_enforces_priority_caps_and_q102_not_ready(self):
        equity = 1_000.0
        now = 1_800_000_000_000
        intents = [
            build_live_intent(strategy="FET_RESIDUAL", symbol="FETUSDT", side="LONG", gross=2.25,
                              equity_usd=equity, signal_time_ms=now, idempotency_key="fet"),
            build_live_intent(strategy="QUALITY102_CAUSAL_V1", symbol="SUIUSDT", side="SHORT", gross=3.0,
                              equity_usd=equity, signal_time_ms=now, idempotency_key="q102"),
            build_live_intent(strategy="PENGU_DUAL_LS_V2", symbol="PENGUUSDT", side="SHORT", gross=1.0,
                              equity_usd=equity, signal_time_ms=now, idempotency_key="pengu"),
            build_live_intent(strategy="V12", symbol="BTCUSDT", side="LONG", gross=1.0,
                              equity_usd=equity, signal_time_ms=now, idempotency_key="v12"),
        ]
        with RuntimeBridge() as bridge:
            plan = plan_with_live_allocator(bridge, equity_usd=equity, now_ms=now,
                                            intents=intents, quality102_causal_ready=False)
        self.assertEqual(plan["status"], "planned")
        accepted = {row["idempotencyKey"]: row for row in plan["accepted"]}
        self.assertEqual(set(accepted), {"v12", "pengu", "fet"})
        self.assertAlmostEqual(accepted["fet"]["gross"], 1.0)
        rejected = {row["intent"]["idempotencyKey"]: row["reason"] for row in plan["rejected"]}
        self.assertEqual(rejected["q102"], "QUALITY102_CAUSAL_V1_NOT_READY")
        self.assertLessEqual(plan["totals"]["cryptoGross"], 3.0 + 1e-9)
        self.assertLessEqual(plan["totals"]["totalGross"], 4.25 + 1e-9)


if __name__ == "__main__":
    unittest.main()
