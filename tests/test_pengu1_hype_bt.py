import tempfile
import unittest
from pathlib import Path
from scripts.research.formal_core_live_ownership import load_ownership_engine

H=3600000
T=1754784000000

class IntegratedSizingTest(unittest.TestCase):
    def scenario(self, candidates, extended=True):
        if extended:
            from scripts.research.pengu1_hype_engine import load_extended_engine
            m=load_extended_engine()
        else:m=load_ownership_engine()
        m.PERIOD_START_MS=T;m.PERIOD_END_MS=T+8*H
        m._monthly_deposits=lambda:{T:10000.}
        market={symbol:{'times':[T+i*H for i in range(9)],'rows':[{'event_time_ms':T+i*H,'open':100.,'close':100.} for i in range(9)]} for symbol in {c['symbol'] for c in candidates}}
        with tempfile.TemporaryDirectory() as d:
            return m._portfolio_scenario(candidates,Path(d),market,round_trip_cost_bps=0,scenario_id='TEST')

    def c(self,strategy,symbol,gross,offset=0,rank=None):
        return {'strategy_id':strategy,'symbol':symbol,'side':'LONG','requested_gross':gross,'status':'MODELED_CLOSED_TRADE','entry_ts_ms':T+offset*H,'signal_ts_ms':T+(offset-1)*H,'entry_price':100.,'exit_ts_ms':T+6*H,'exit_price':110.,'exit_reason':'TIME_EXIT','rank':rank,'_model_candidate_id':f'{strategy}-{offset}','route':'RECOVERY_V8' if strategy=='PENGU' else 'HYPE_TREND_LONG'}

    def test_pengus_half_lot_becomes_full_one_without_changing_original(self):
        c=self.c('PENGU','PENGUUSDT',.5)
        original=self.scenario([c.copy()],False)
        self.assertEqual(original['trade_rows'][0]['accepted_gross'],.5)
        fixed=self.scenario([c.copy()])
        self.assertEqual(fixed['trade_rows'][0]['accepted_gross'],1.)
        self.assertEqual(fixed['final_equity_jpy'],11000.)

    def test_hype_one_slot_and_source_scoped_gross(self):
        result=self.scenario([self.c('HYPE_LONG','HYPEUSDT',1.5),self.c('HYPE_LONG','HYPEUSDT',1.5,1)])
        self.assertEqual(len(result['trade_rows']),1)
        self.assertEqual(result['trade_rows'][0]['accepted_gross'],1.5)
        self.assertEqual(result['rejected_entries']['HYPE_LONG:SLOT_OCCUPIED'],1)

    def test_hype_half_reduction_frees_core_capacity_and_reconciles(self):
        result=self.scenario([self.c('HYPE_LONG','HYPEUSDT',1.5),self.c('PENGU','PENGUUSDT',.5,1),self.c('V12','ETHUSDT',1.,2,1)])
        self.assertEqual(len(result['trade_rows']),3)
        reductions=[e for e in result['event_rows'] if e['event_type']=='HYPE_PRIORITY_PARTIAL_EXIT']
        self.assertEqual(len(reductions),1)
        self.assertAlmostEqual(reductions[0]['quantity'],50.)
        self.assertLessEqual(reductions[0]['fraction'],.5)
        self.assertEqual(result['accounting_reconciliation']['status'],'PASS')

    def test_hype_source_gap_does_not_manufacture_closed_exit(self):
        from scripts.research.pengu1_hype_engine import hype_lifecycle
        candle={T:{'open':100.,'high':101.,'low':99.}}
        result=hype_lifecycle(candle,T,5.,6.,T+168*H)
        self.assertEqual(result['status'],'UNRESOLVED_HYPE_EXIT')

    def test_hype_same_hour_stop_wins_over_takeprofit(self):
        from scripts.research.pengu1_hype_engine import hype_lifecycle
        candle={T:{'open':100.,'high':110.,'low':90.}}
        result=hype_lifecycle(candle,T,5.,6.,T+168*H)
        self.assertEqual(result['exit_price'],95.)
        self.assertEqual(result['exit_reason'],'HYPE_HARD_STOP')

    def test_hype_gap_above_tp_fills_before_later_low(self):
        from scripts.research.pengu1_hype_engine import hype_lifecycle
        candles={T:{'open':100.,'high':101.,'low':99.},T+H:{'open':110.,'high':115.,'low':90.}}
        result=hype_lifecycle(candles,T,5.,6.,T+168*H)
        self.assertEqual(result['exit_price'],110.)
        self.assertEqual(result['exit_reason'],'HYPE_GAP_TP')

if __name__=='__main__':unittest.main()
