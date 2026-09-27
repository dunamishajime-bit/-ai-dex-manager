import unittest
from dataclasses import replace
from datetime import datetime,timezone
from types import SimpleNamespace
from research.formal_five_bt.ohlc_proxy import Candidate,to_candidate,model_protection,simulate,HOUR

START=int(datetime(2025,8,10,tzinfo=timezone.utc).timestamp()*1000)
def bar(ts,open_,high,low,close):
    return SimpleNamespace(event_time_ms=ts,open=open_,high=high,low=low,close=close)

def candidate(ts,side="LONG",strategy="PENGU",symbol="PENGUUSDT",gross=1.0,hold=1,rank=None,family=None):
    return Candidate(strategy,symbol,ts,ts,side,gross,hold,ts-1,rank,family,None,
                     {"source_runtime_sha":"a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"})

def deposits():
    return [SimpleNamespace(timestamp_ms=START,amount_usdt=100)]

class ProxyResearchTests(unittest.TestCase):
    def test_scan_candidate_rejects_unknown_side_and_uses_future_open_without_lookahead(self):
        good={"status":"SIGNAL","symbol":"PENGUUSDT","decision_ts_ms":START+1,
              "side":-1,"data_cutoff_ms":START-1,"source_runtime_sha":"a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"}
        c=to_candidate("PENGU",good)
        self.assertEqual(c.side,"SHORT")
        self.assertEqual(c.enter_ms,START+HOUR)
        self.assertIsNone(to_candidate("PENGU",{**good,"data_cutoff_ms":START+10}))
        self.assertIsNone(to_candidate("Q102",{**good,"item":{"selected":True,"side":"WAIT","requestedGross":1}}))
    def test_short_stop_resolves_in_adverse_direction_and_costs_are_scenario_specific(self):
        c=candidate(START,side="SHORT")
        data={c.symbol:{
            START:bar(START,100,100,100,100),
            START+HOUR:bar(START+HOUR,100,111,99,110),
        }}
        n=simulate([c],data,{c.symbol:{}},deposits(),"NORMAL")
        s=simulate([c],data,{c.symbol:{}},deposits(),"SEVERE")
        self.assertEqual(n["closed_proxy_trades"],1)
        self.assertEqual(n["losses"],1)
        self.assertGreater(n["final_nav_usdt_proxy"],s["final_nav_usdt_proxy"])
        self.assertLess(n["strategy_proxy_net_pnl_usdt"]["PENGU"],0)
    def test_symbol_and_sleeve_competition_not_double_counted(self):
        c=candidate(START,side="LONG")
        q=candidate(START,side="LONG",strategy="Q102",family="MR",gross=2)
        b={START:bar(START,100,102,99,101),START+HOUR:bar(START+HOUR,100,102,99,101),
           START+2*HOUR:bar(START+2*HOUR,100,102,99,101)}
        r=simulate([c,q],{c.symbol:b},{c.symbol:{}},deposits(),"NORMAL")
        self.assertEqual(r["closed_proxy_trades"],1)
        self.assertEqual(r["rejection_reasons"]["SYMBOL_OWNED"],1)
    def test_unverified_outcome_bars_cannot_generate_modeled_fill(self):
        c=candidate(START,hold=4)
        b={START:bar(START,100,101,99,100),START+HOUR:bar(START+HOUR,100,101,99,100)}
        r=simulate([c],{c.symbol:b},{c.symbol:{}},deposits(),"NORMAL")
        self.assertEqual(r["closed_proxy_trades"],0)
        self.assertEqual(r["rejection_reasons"]["FUTURE_OUTCOME_COVERAGE_INCOMPLETE"],1)
    def test_fet_profit_floor_does_not_lookahead_into_its_activation_hour(self):
        c=candidate(START,strategy="FET",symbol="FETUSDT",hold=3)
        note=model_protection(c,100,{})[2]
        self.assertIn("FET",note)
        b={START:bar(START,100,100,100,100),
           START+HOUR:bar(START+HOUR,100,106,99,105),
           START+2*HOUR:bar(START+2*HOUR,105,106,100,103),
           START+3*HOUR:bar(START+3*HOUR,103,104,101,103)}
        r=simulate([c],{c.symbol:b},{c.symbol:{}},deposits(),"NORMAL")
        self.assertEqual(r["closed_proxy_trades"],1)
        self.assertEqual(r["wins"],1)
if __name__=="__main__":unittest.main()
