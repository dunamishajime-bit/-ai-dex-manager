#!/usr/bin/env python3
"""Causal and stop-ordering guards for user-adopted HYPE entry + research exits."""
import collections, importlib.util, pathlib, unittest
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("hype_gated_protection_tested",HERE/"run-hype-gated-protection-20261022.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
M5=300000
class Stub:
    def __init__(self,data):self.data=data
    def getdata(self,symbol):
        bars=self.data[symbol]
        return bars,[int(r[0]) for r in bars]

def obs():
    o=collections.defaultdict(int);o["by_reason"]=collections.Counter();o["stop_decisions"]=[]
    return o

def bar(i,op,high,low,close):
    return (i*M5,float(op),float(high),float(low),float(close),10.)

class HypeGateAndExitTests(unittest.TestCase):
    def setUp(self):
        m.entry.ACTIVE["lookups"].clear()
        m.entry.ACTIVE["missing"].clear()

    def test_gate_consumes_only_completed_m5(self):
        btc=[bar(i,100,100,100,100) for i in range(40)]
        hype=[bar(i,100,100,100,100) for i in range(40)]
        hype[37]=bar(37,100,103,100,103)
        # Bar at entry timestamp is not completed and may not be consulted.
        hype[38]=bar(38,100,999,1,999)
        s=Stub({"BTCUSDT":btc,"HYPEUSDT":hype})
        row={"strategy_id":"HYPE_LONG","entry_ts_ms":38*M5,"candidate_id":"test"}
        self.assertTrue(m.entry.gate_hype(row,m.GATE,s))
        f=m.entry.pre_entry_features(s,38*M5)
        self.assertGreaterEqual(f["REL3hPct"],2)
        self.assertLess(f["REL3hPct"],4)

    def test_gate_rejects_strong_btc(self):
        btc=[bar(i,100,100,100,100) for i in range(40)]
        btc[37]=bar(37,101,101,101,101)
        hype=[bar(i,100,100,100,100) for i in range(40)]
        hype[37]=bar(37,103.1,103.1,103.1,103.1)
        s=Stub({"BTCUSDT":btc,"HYPEUSDT":hype})
        row={"strategy_id":"HYPE_LONG","entry_ts_ms":38*M5,"candidate_id":"test"}
        self.assertFalse(m.entry.gate_hype(row,m.GATE,s))

    def test_gate_fail_closed_missing_window(self):
        s=Stub({"BTCUSDT":[bar(i,100,100,100,100) for i in range(12)],
                "HYPEUSDT":[bar(i,100,100,100,100) for i in range(12)]})
        row={"strategy_id":"HYPE_LONG","entry_ts_ms":12*M5,"candidate_id":"test"}
        self.assertFalse(m.entry.gate_hype(row,m.GATE,s))

    def test_profit_guard_arms_after_close_not_same_bar_low(self):
        series=[
            bar(0,100,104,95,103.5),
            bar(1,103.3,104,102,103),
            bar(2,103,103.1,100.9,101.1),
            bar(3,101,102,100,101),
            bar(4,101,102,100,101),
        ]
        row={"strategy_id":"HYPE_LONG","side":"LONG","symbol":"HYPEUSDT",
             "entry_price":100.,"entry_ts_ms":0,"exit_ts_ms":5*M5}
        updated=m.apply(row,m.RULES["PROFIT_3P0_FLOOR1P0"],
                        Stub({"HYPEUSDT":series}),10,obs(),original_row=row)
        self.assertEqual(updated["exit_ts_ms"],3*M5)
        self.assertGreater(updated["exit_price"],100)
        self.assertIn("RESEARCH_",updated["exit_reason"])

    def test_initial_stop_not_immediately_armed_at_1h(self):
        series=[bar(i,100,100,98.5 if i==10 else 99.2,99.7) for i in range(20)]
        row={"strategy_id":"HYPE_LONG","side":"LONG","symbol":"HYPEUSDT",
             "entry_price":100.,"entry_ts_ms":0,"exit_ts_ms":20*M5}
        # Drop before 1h cannot trigger a newly added 1h-armed rule.
        initial=m.apply(row,m.RULES["INITIAL_1H_1P0_MFE0P3"],
                        Stub({"HYPEUSDT":series}),10,obs(),original_row=row)
        self.assertEqual(initial["exit_ts_ms"],row["exit_ts_ms"])

if __name__=="__main__":unittest.main()
