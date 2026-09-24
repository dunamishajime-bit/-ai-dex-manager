import unittest

from scripts.research.raw_data.integrated_engine import (
    CapitalContract, PortfolioState, Position, preempt_fet, run_replay,
)
from scripts.research.raw_data.models import Bar, Funding

T = 1_700_000_000_000
H = 3_600_000


class ReplayAccountingRegressionTests(unittest.TestCase):
    def test_preemption_requires_price_and_accounts_net_cash(self):
        state = PortfolioState(cash=1000.0)
        state.positions["fet"] = Position(
            "fet", "FET_BRK48_RESIDUAL", "FETUSDT", "LONG", 2.25,
            100.0, 10.0, 1000.0, priority=3, preemptible=True, entry_ts=T,
        )
        candidate = {"requestedGross": 2.0, "priority": 1, "assetClass": "crypto"}
        self.assertFalse(preempt_fet(state, candidate))
        self.assertIn("fet", state.positions)
        bar = Bar("FETUSDT", T + H, 90.0, 94.0, 88.0, 92.0, 100.0)
        self.assertTrue(preempt_fet(
            state, candidate, fill_bars={"FETUSDT": bar}, ts_ms=T + H,
            fee_rate=.001, funding=[Funding("FETUSDT", T + H, .002)],
        ))
        self.assertAlmostEqual(state.cash, 897.1)
        self.assertAlmostEqual(state.realized_pnl, -102.9)
        self.assertAlmostEqual(state.fees, .9)
        self.assertAlmostEqual(state.funding, -2.0)
        self.assertEqual(state.events[-1]["exitReason"], "CORE_PREEMPTION")
        self.assertEqual(state.preemptions[0]["releasedGross"], 2.25)
        self.assertEqual(state.positions, {})

    def test_unpriced_and_unaffordable_preemption_leave_fet_open(self):
        state = PortfolioState(cash=1000)
        state.positions["fet"] = Position(
            "fet", "FET_BRK48_RESIDUAL", "FETUSDT", "LONG", 2.25,
            100, 10, 1000, priority=3, preemptible=True,
        )
        bar = Bar("FETUSDT", T, 90, 94, 88, 92, 100)
        self.assertFalse(preempt_fet(
            state, {"requestedGross": 4.0, "priority": 1, "assetClass": "crypto"},
            fill_bars={"FETUSDT": bar}, ts_ms=T,
        ))
        self.assertFalse(preempt_fet(
            state, {"requestedGross": 2.0, "priority": 1, "assetClass": "crypto"},
            fill_bars={}, ts_ms=T,
        ))
        self.assertEqual(list(state.positions), ["fet"])
        self.assertEqual(state.events, [])

    def test_q102_one_slot_is_enforced_in_portfolio_not_just_candidate(self):
        bars = {"BTCUSDT": [
            Bar("BTCUSDT", T, 100, 101, 99, 100, 10),
            Bar("BTCUSDT", T + H, 101, 102, 100, 101, 10),
            Bar("BTCUSDT", T + 2 * H, 102, 103, 101, 102, 10),
        ]}
        candidates = [{
            "positionId": "q:" + str(i), "strategy": "QUALITY102_CAUSAL_V1",
            "symbol": "BTCUSDT", "side": "LONG", "signalTs": T,
            "entryTs": T + H, "requestedGross": 1.0,
            "maximumPositions": 1, "maxHoldHours": 24,
        } for i in range(2)]
        result = run_replay(
            "NORMAL", {"bars": bars}, candidates,
            CapitalContract(10000, 0, 0, T), fee_rate=0,
        )
        self.assertEqual(result["acceptedEntryCount"], 1)
        self.assertTrue(any(event.get("reason") == "STRATEGY_POSITION_CAP"
                            for event in result["events"]))

    def test_fet_floor_arms_only_after_bar_close_and_fills_next_bar(self):
        bars = {"FETUSDT": [
            Bar("FETUSDT", T, 100, 100, 100, 100, 100),
            Bar("FETUSDT", T + H, 100, 106, 99, 105, 100),
            Bar("FETUSDT", T + 2 * H, 106, 108, 100, 101, 100),
        ]}
        candidate = {
            "positionId": "fet", "strategy": "FET_BRK48_RESIDUAL",
            "symbol": "FETUSDT", "side": "LONG", "signalTs": T,
            "entryTs": T + H, "requestedGross": 1.0,
            "hardStopPct": .05, "maxHoldHours": 24,
            "profitFloorTriggerPct": .05, "profitFloorStopPct": .005,
        }
        result = run_replay(
            "NORMAL", {"bars": bars}, [candidate],
            CapitalContract(10000, 0, 0, T), fee_rate=0,
        )
        armed = [e for e in result["events"] if e["type"] == "PROFIT_FLOOR_ARMED"]
        exits = [e for e in result["events"] if e["type"] == "EXIT"]
        self.assertEqual(len(armed), 1)
        self.assertEqual(armed[0]["ts_ms"], T + 2 * H)
        self.assertEqual(exits[0]["exitReason"], "PROFIT_FLOOR")
        self.assertEqual(exits[0]["exitTs"], T + 2 * H)

    def test_research_stress_changes_fill_costs(self):
        bars = {"BTCUSDT": [
            Bar("BTCUSDT", T, 100, 100, 100, 100, 10),
            Bar("BTCUSDT", T + H, 100, 101, 99, 100, 10),
            Bar("BTCUSDT", T + 2 * H, 110, 120, 109, 119, 10),
        ]}
        candidate = {
            "positionId": "v12", "strategy": "V12", "symbol": "BTCUSDT",
            "side": "LONG", "signalTs": T, "entryTs": T + H,
            "requestedGross": 1, "maxHoldHours": 1,
        }
        capital = CapitalContract(10000, 0, 0, T)
        normal = run_replay(
            "NORMAL", {"bars": bars}, [candidate], capital,
            fee_rate=.0006, slippage_bps=2,
        )
        severe = run_replay(
            "SEVERE", {"bars": bars}, [candidate], capital,
            fee_rate=.0012, slippage_bps=12,
        )
        self.assertGreater(normal["finalEquity"], severe["finalEquity"])
        self.assertGreater(severe["fees"], normal["fees"])
        self.assertNotEqual(normal["events"], severe["events"])

    def test_invalid_ohlc_and_duplicate_raw_cannot_be_silently_skipped(self):
        invalid = [Bar("BTCUSDT", T, 100, 99, 90, 95, 10)]
        with self.assertRaisesRegex(ValueError, "INVALID_REPLAY_OHLC"):
            run_replay("NORMAL", {"bars": {"BTCUSDT": invalid}}, [], CapitalContract(0, 0, 0, T))
        duplicate = [Bar("BTCUSDT", T, 100, 100, 100, 100, 10)] * 2
        with self.assertRaisesRegex(ValueError, "NONMONOTONIC_OR_DUPLICATE_REPLAY_BAR"):
            run_replay("NORMAL", {"bars": {"BTCUSDT": duplicate}}, [], CapitalContract(0, 0, 0, T))


if __name__ == "__main__":
    unittest.main()
