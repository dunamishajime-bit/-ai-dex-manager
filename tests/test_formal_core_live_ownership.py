"""Exercise real allocation, not a post-hoc removal of conflicting fills."""
import unittest
from pathlib import Path

from scripts.research.formal_core_live_ownership import load_ownership_engine


class OwnershipReplayTest(unittest.TestCase):
    def setUp(self):
        self.engine = load_ownership_engine()
        self.t = self.engine.PERIOD_START_MS
        self.h = self.engine.HOUR
        times = list(range(self.t, self.engine.PERIOD_END_MS + self.h, self.h))
        self.market = {'DOGEUSDT': {'times': times, 'rows': [
            {'event_time_ms': t, 'open': 100., 'close': 100.} for t in times]}}

    def candidate(self, strategy, entry, exit, side='LONG', index=1):
        return {'strategy_id': strategy, 'symbol': 'DOGEUSDT', 'side': side,
                'entry_ts_ms': self.t + entry*self.h, 'signal_ts_ms': self.t+(entry-1)*self.h,
                'exit_ts_ms': self.t + exit*self.h, 'entry_price': 100., 'exit_price': 100.,
                'exit_reason': 'HOLD', 'requested_gross': .5, 'rank': 1,
                'family': 'MR', 'status': 'MODELED_CLOSED_TRADE',
                '_model_candidate_id': f'C{index:06d}'}

    def replay(self, candidates):
        return self.engine._portfolio_scenario(candidates, Path('.'), self.market,
            round_trip_cost_bps=10., scenario_id='TEST')

    def test_opposite_owner_rejected_before_order_and_fee(self):
        result = self.replay([self.candidate('Q102', 1, 5, 'SHORT'),
                              self.candidate('V12', 2, 4, index=2)])
        self.assertEqual(result['closed_trades'], 1)
        decision = next(x for x in result['candidate_decision_rows_full'] if x['candidate_id']=='C000002')
        self.assertEqual(decision['reason'], 'V12:SYMBOL_OWNED_BY_Q102')
        self.assertFalse(any(x.get('candidate_id')=='C000002' for x in result['event_rows']))
        self.assertEqual(result['accounting_reconciliation']['status'], 'PASS')

    def test_same_side_owner_also_rejected(self):
        result=self.replay([self.candidate('V12',1,5), self.candidate('Q102',2,4,index=2)])
        self.assertEqual(result['closed_trades'],1)
        self.assertEqual(result['rejected_entries']['Q102:SYMBOL_OWNED_BY_V12'],1)

    def test_exit_at_entry_boundary_releases_ownership(self):
        result=self.replay([self.candidate('V12',1,3), self.candidate('Q102',3,5,index=2)])
        self.assertEqual(result['closed_trades'],2)

    def test_legitimate_rank3_handoff_releases_ownership_before_recheck(self):
        first=self.candidate('V12',1,6); first['rank']=3
        result=self.replay([first,self.candidate('Q102',2,4,index=2)])
        # Legitimate Rank3 handoff precedes ownership recheck; the owner is closed.
        self.assertEqual(result['closed_trades'],2)
        exits=[x for x in result['event_rows'] if x['event_type']=='MODELED_EXIT']
        self.assertEqual(exits[0]['exit_reason'],'RANK3_PREEMPT:Q102')

    def test_postfee_margin_guard_keeps_5x_base_reserve(self):
        market = dict(self.market)
        market['TSLAUSDT'] = {'times': self.market['DOGEUSDT']['times'], 'rows': [
            {'event_time_ms': t, 'open': 100., 'close': 100.}
            for t in self.market['DOGEUSDT']['times']
        ]}
        stock = self.candidate('V52', 1, 4, index=1)
        stock['symbol'] = 'TSLAUSDT'
        stock['requested_gross'] = 1.25
        core = self.candidate('Q102', 1, 4, index=2)
        core['requested_gross'] = 3.0

        def run(guard):
            engine = load_ownership_engine(postfee_margin_guard=guard)
            result = engine._portfolio_scenario(
                [stock.copy(), core.copy()], Path('.'), market,
                round_trip_cost_bps=10., scenario_id='TEST',
            )
            entries = [row for row in result['event_rows'] if row['event_type'] == 'MODELED_ENTRY']
            self.assertEqual(len(entries), 2)
            total_notional = sum(float(row['notional_settlement']) for row in entries)
            final_wallet = float(entries[-1]['wallet_after_event'])
            return total_notional / final_wallet, entries

        legacy_gross, legacy_entries = run(False)
        guarded_gross, guarded_entries = run(True)
        self.assertGreater(legacy_gross, 4.25)
        self.assertLessEqual(guarded_gross, 4.25 + 1e-9)
        self.assertLess(
            float(guarded_entries[-1]['accepted_gross']),
            float(legacy_entries[-1]['accepted_gross']),
        )

    def test_unknown_engine_bytes_are_not_executable(self):
        with self.assertRaisesRegex(ValueError,'SOURCE_SHA_MISMATCH'):
            load_ownership_engine(source_bytes=b'print("untrusted")')

    def test_postfee_guard_also_preserves_crypto_sleeve_cap(self):
        market = dict(self.market)
        market['BTCUSDT'] = {'times': self.market['DOGEUSDT']['times'],
                            'rows': self.market['DOGEUSDT']['rows']}
        base = self.candidate('V12', 1, 4)
        base['symbol'] = 'BTCUSDT'
        base['requested_gross'] = 1.0
        next_entry = self.candidate('Q102', 1, 4, index=2)
        next_entry['requested_gross'] = 3.0
        engine = load_ownership_engine(postfee_margin_guard=True)
        result = engine._portfolio_scenario([base, next_entry], Path('.'), market,
                                            round_trip_cost_bps=10., scenario_id='TEST')
        entries = [r for r in result['event_rows'] if r['event_type'] == 'MODELED_ENTRY']
        self.assertEqual(len(entries), 2)
        post_fee_wallet = float(entries[-1]['wallet_after_event'])
        marked_notional = sum(float(r['notional_settlement']) for r in entries)
        self.assertLessEqual(marked_notional / post_fee_wallet, 3.0 + 1e-9)

    def test_postfee_guard_never_partially_allocates_fixed_one_x_idle(self):
        entry = self.candidate('IDLE', 1, 4)
        entry.update(requested_gross=1.0, overlay_source_current=True,
                     route_selected=True, generic_accepted=True)
        engine = load_ownership_engine(postfee_margin_guard=True)
        result = engine._portfolio_scenario([entry], Path('.'), self.market,
                                            round_trip_cost_bps=10., scenario_id='TEST')
        entries = [r for r in result['event_rows'] if r['event_type'] == 'MODELED_ENTRY']
        self.assertTrue(not entries or abs(float(entries[0]['accepted_gross']) - 1.0) < 1e-9,
                        'fixed 1x intent must not be silently reduced by a later fee-room hook')


if __name__ == '__main__':
    unittest.main()
