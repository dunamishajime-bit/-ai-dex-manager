import unittest

from scripts.research.raw_data.integrated_engine import (
    CapitalContract,
    PortfolioState,
    Position,
    preempt_fet,
    reserve_entry,
    run_integrated,
    settle_exit,
)


class RawIntegratedEngineTests(unittest.TestCase):
    def test_initial_plus_twelve_deposits_total_130000(self):
        result = run_integrated("NORMAL", {"bars": {}, "funding": {}, "stock_bars": {}}, CapitalContract())
        self.assertEqual(result["contributionCount"], 13)
        self.assertEqual(result["totalContributed"], 130_000.0)

    def test_shared_gross_reservation_includes_pending(self):
        state = PortfolioState(crypto_gross_cap=3.0, total_gross_cap=4.25)
        first = reserve_entry(state, {"positionId": "p1", "strategy": "V12", "assetClass": "crypto", "requestedGross": 2.0})
        second = reserve_entry(state, {"positionId": "p2", "strategy": "Q102", "assetClass": "crypto", "requestedGross": 1.1})
        self.assertTrue(first.accepted)
        self.assertFalse(second.accepted)
        self.assertEqual(second.reason, "CRYPTO_GROSS_CAP")
        self.assertEqual(state.pending_reservations, {"p1": 2.0})

    def test_pending_reservation_cannot_be_reserved_twice(self):
        state = PortfolioState()
        candidate = {"positionId": "same", "strategy": "V12", "assetClass": "crypto", "requestedGross": 1.0}
        self.assertTrue(reserve_entry(state, candidate).accepted)
        result = reserve_entry(state, candidate)
        self.assertFalse(result.accepted)
        self.assertEqual(result.reason, "PENDING_DUPLICATE")

    def test_fees_and_funding_apply_once(self):
        state = PortfolioState(cash=1000.0)
        position = Position("p", "V12", "BTCUSDT", "LONG", 1.0, 10.0, 10.0, 100.0)
        state.positions[position.position_id] = position
        settle_exit(state, position, {"exitPrice": 11.0, "qty": 10.0, "fee": 1.0, "funding": -0.5, "exitTs": 2})
        cash_after = state.cash
        settle_exit(state, position, {"exitPrice": 11.0, "qty": 10.0, "fee": 1.0, "funding": -0.5, "exitTs": 2})
        self.assertEqual(state.cash, cash_after)
        self.assertAlmostEqual(state.realized_pnl, 8.5)
        self.assertEqual(len(state.events), 1)

    def test_partial_fill_only_settles_filled_quantity(self):
        state = PortfolioState(cash=1000.0)
        position = Position("p", "V12", "BTCUSDT", "LONG", 1.0, 10.0, 10.0, 100.0)
        state.positions[position.position_id] = position
        settle_exit(state, position, {"exitPrice": 11.0, "qty": 5.0, "fee": 0.5, "funding": 0.0, "exitTs": 2})
        self.assertEqual(position.qty, 5.0)
        self.assertEqual(position.notional, 50.0)
        self.assertAlmostEqual(state.realized_pnl, 4.5)

    def test_fet_preemption_releases_gross_before_core_reservation(self):
        state = PortfolioState(crypto_gross_cap=3.0, total_gross_cap=4.25)
        fet = Position("fet", "FET_BRK48_RESIDUAL", "FETUSDT", "LONG", 2.25, 1.0, 1.0, 100.0, priority=3, preemptible=True)
        state.positions[fet.position_id] = fet
        candidate = {"positionId": "core", "strategy": "V12", "assetClass": "crypto", "requestedGross": 2.0, "priority": 1}
        self.assertFalse(reserve_entry(state, candidate).accepted)
        self.assertTrue(preempt_fet(state, candidate))
        self.assertTrue(reserve_entry(state, candidate).accepted)
        self.assertEqual(state.preemptions[0]["releasedGross"], 2.25)

    def test_rejected_entry_has_no_pnl_or_trade_event(self):
        state = PortfolioState(crypto_gross_cap=1.0, total_gross_cap=1.0)
        reserve_entry(state, {"positionId": "p1", "strategy": "V12", "assetClass": "crypto", "requestedGross": 1.0})
        result = reserve_entry(state, {"positionId": "p2", "strategy": "PENGU", "assetClass": "crypto", "requestedGross": 1.0})
        self.assertFalse(result.accepted)
        self.assertEqual(state.realized_pnl, 0.0)
        self.assertEqual(state.events, [])

    def test_normal_and_severe_runs_are_independent(self):
        bundle = {"bars": {}, "funding": {}, "stock_bars": {}}
        normal = run_integrated("NORMAL", bundle, CapitalContract())
        severe = run_integrated("SEVERE", bundle, CapitalContract())
        self.assertEqual(normal["mode"], "NORMAL")
        self.assertEqual(severe["mode"], "SEVERE")
        self.assertEqual(normal["totalContributed"], severe["totalContributed"])
        self.assertIsNot(normal["events"], severe["events"])


if __name__ == "__main__":
    unittest.main()
