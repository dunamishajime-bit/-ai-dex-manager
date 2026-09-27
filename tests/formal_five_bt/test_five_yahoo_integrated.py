"""Independent five-sleeve synthetic time/capital tests; no network access."""
from datetime import datetime, timezone
from types import SimpleNamespace
import unittest

from research.formal_five_bt.five_yahoo_integrated import (
    simulate, stock_opportunities, START_MS, END_MS, HOUR, LABEL,
)
from research.formal_five_bt.ohlc_proxy import Candidate
from research.formal_five_bt.v52_yahoo import HourOpen, SYMBOLS, SOURCE, _ts

DAY=24*HOUR
CUTC=int(datetime(2025,8,11,14,tzinfo=timezone.utc).timestamp()*1000)
def crypto_c(ts,side="LONG",gross=1.,strategy="PENGU",sym="PENGUUSDT"):
    return Candidate(strategy,sym,ts,ts,side,gross,1,ts-1,None,None,None,
                    {"source_runtime_sha":"a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"})
def bar(ts,price=100,hi=101,lo=99):
    return SimpleNamespace(event_time_ms=ts,open=float(price),
                           high=float(hi),low=float(lo),close=float(price))
def yahoo_rows(symbol,day,price=100):
    return tuple(HourOpen(symbol,_ts(day,h,30),price,price,price,price,SOURCE)
                 for h in range(9,16))
def aster_rows(symbol,day,price=101):
    return tuple(HourOpen(symbol,_ts(day,h,0),price,price,price,price,"ASTER_NATIVE_STOCK_PERP_H1_OPEN")
                 for h in range(9,17))
def fx_data():
    return [SimpleNamespace(event_time_ms=START_MS+n*DAY,rate_jpy_per_usd=150)
            for n in range((END_MS-START_MS)//DAY+3)]
def deposit():
    return [SimpleNamespace(timestamp_ms=START_MS,amount_usdt=100,amount_jpy=15000)]

class IntegratedFiveAssumedFillTests(unittest.TestCase):
    def test_v52_all_pre_allocation_candidate_windows_allow_later_stock_priority(self):
        d=datetime.fromtimestamp(CUTC/1000,timezone.utc).date()
        yahoo={s:yahoo_rows(s,d) for s in SYMBOLS}
        perps={s:aster_rows(s,d,101 if s=="AMZN" else 100) for s in SYMBOLS}
        opp,stats=stock_opportunities(yahoo,perps,20)
        self.assertGreater(len(opp),1)
        self.assertEqual(stats["NYSE_sessions"],1)
        self.assertTrue(any(o["route"]=="V11_EQ" and o["symbol"]=="AMZN" for o in opp))
        self.assertTrue(any(o["route"]=="V50_POST_OPEN_BASIS" and o["symbol"]=="AMZN" for o in opp))
        self.assertTrue(all(o["gate_status"]=="PASS_ASSUMED_FILL" for o in opp))
        self.assertTrue(all(o["decision_ts"]<o["exit_ts"] for o in opp))
    def test_chronological_crypto_stock_shared_gross_and_ledger(self):
        d=datetime.fromtimestamp(CUTC/1000,timezone.utc).date()
        y={"AMZN":yahoo_rows("AMZN",d)}
        sec=lambda h,m: _ts(d,h,m)*1000
        c=crypto_c(CUTC)
        # Four basic consecutive H1 bars span entry hour and one next hour;
        # resolution is delayed to the first moment that prior H1 is complete.
        bars={"PENGUUSDT":{CUTC:bar(CUTC),CUTC+HOUR:bar(CUTC+HOUR)}}
        stock_due=[{
            "decision_ts":_ts(d,10,30),"exit_ts":_ts(d,11,30),"route":"V11_EQ",
            "symbol":"AMZN","side":"SHORT","source_reference_open":100.,
            "source_perp_open":101.,"entry_basis_bps":100,"window_ny":"10:30",
            "exit_reference_open":99.,"exit_reason":"MODELED_BASIS_CONVERGED",
            "gate_status":"PASS_ASSUMED_FILL"}]
        r=simulate([c],bars,{},stock_due,y,deposit(),fx_data(),"NORMAL")
        self.assertEqual(r["stock_entries_model"],1)
        self.assertEqual(r["crypto_entries_model"],1)
        self.assertEqual(r["closed_trades_model"],2)
        self.assertEqual(r["contribution_events"],1)
        self.assertLessEqual(r["gross_peaks_model"]["total"],4.25+.1)
        self.assertEqual(len(r["monthly_model"]),13)
        self.assertEqual(r["monthly_model"][0]["fx_source"],"ECB_DAILY_CROSS_NOT_FRED")
        self.assertFalse(r["historical_production_parity_verified"])
    def test_v52_stock_no_l2_only_at_eligible_gate_and_no_overlap(self):
        d=datetime.fromtimestamp(CUTC/1000,timezone.utc).date()
        y={"AMZN":yahoo_rows("AMZN",d)}
        first={
            "decision_ts":_ts(d,10,30),"exit_ts":_ts(d,15,30),"route":"V11_EQ",
            "symbol":"AMZN","side":"SHORT","source_reference_open":100.,
            "source_perp_open":101.,"entry_basis_bps":100,"window_ny":"10:30",
            "exit_reference_open":100.,"exit_reason":"MODELED_TIME_EXIT",
            "gate_status":"PASS_ASSUMED_FILL"}
        second=dict(first,decision_ts=_ts(d,11,30),exit_ts=_ts(d,14,30),
                    route="V50_POST_OPEN_BASIS",window_ny="11:30")
        r=simulate([],{}, {},[first,second],y,deposit(),fx_data(),"NORMAL")
        self.assertEqual(r["stock_entries_model"],1)
        self.assertEqual(r["reject_counts"].get("INTEGRATED_STOCK_SYMBOL_OWNED"),1)
        self.assertEqual(r["closed_trades_model"],1)
    def test_crypto_hourly_resolution_no_same_hour_future_bar(self):
        d=datetime.fromtimestamp(CUTC/1000,timezone.utc).date()
        c=crypto_c(CUTC,side="SHORT")
        b={CUTC:bar(CUTC,100,100,100),CUTC+HOUR:bar(CUTC+HOUR,100,100,100)}
        r=simulate([c],{"PENGUUSDT":b},{},[],{},deposit(),fx_data(),"NORMAL")
        self.assertEqual(r["closed_trades_model"],1)
        self.assertEqual(r["stock_entries_model"],0)
        self.assertGreater(r["fee_total_usdt_model"],0)
if __name__=="__main__":unittest.main()
