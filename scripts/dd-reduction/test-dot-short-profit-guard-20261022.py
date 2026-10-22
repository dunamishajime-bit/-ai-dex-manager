#!/usr/bin/env python3
"""No-lookahead and scope checks for DOT SHORT profit guards."""
import unittest
import importlib.util
from pathlib import Path
from collections import Counter, defaultdict

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("dot_short_guard_tests",
    HERE/"run-dot-short-profit-guard-after-hype-20261022.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
M5=300000

def sample():
    bars=[(i*M5,100.,100.,100.,100.,1.) for i in range(25)]
    bars[3]=(3*M5,100.,100.1,97.,97.5,1.)
    bars[4]=(4*M5,97.5,99.8,97.2,99.0,1.)
    times=[x[0] for x in bars]
    class Source:
        def getdata(self,symbol):
            return bars,times
    row=dict(candidate_id="DOT-001",strategy_id="IDLE",side="SHORT",
             symbol="DOTUSDT",entry_ts_ms=0,entry_price=100.,
             exit_ts_ms=22*M5)
    obs=defaultdict(int);obs["by_reason"]=Counter()
    return bars,Source(),row,obs

class TestDotGuard(unittest.TestCase):
    def test_scoped_to_dot_short(self):
        for name,rule in m.DOT_GUARDS.items():
            r=m.mainmod.EXIT_RULES[name]
            self.assertTrue(m.mainmod.idle.matches(
                dict(strategy_id="IDLE",side="SHORT",symbol="DOTUSDT"),r))
            for symbol,side,strategy in [
                ("TAOUSDT","SHORT","IDLE"),("RENDERUSDT","SHORT","IDLE"),
                ("DOTUSDT","LONG","IDLE"),("DOTUSDT","SHORT","PENGU"),
                ("DOTUSDT","LONG","HYPE_LONG")]:
                self.assertFalse(m.mainmod.idle.matches(
                    dict(strategy_id=strategy,side=side,symbol=symbol),r))
    def test_floor_after_confirmed_m5_close(self):
        bars,source,row,obs=sample()
        rule=m.mainmod.EXIT_RULES["DOT_PROFIT_2P0_FLOOR0P5"]
        new=m.mainmod.apply(row,rule,source,10,obs)
        self.assertEqual(new["exit_ts_ms"],5*M5)
        self.assertIn("RESEARCH_IDLE_DOT_PROFIT",new["exit_reason"])
        self.assertGreater(new["unit_price_return"],0)
        self.assertAlmostEqual(new["exit_price"],99.5*(1+.001),places=7)
    def test_arm_requires_closed_candle_not_high(self):
        bars,source,row,obs=sample()
        bars[3]=(3*M5,100.,100.1,97.,99.0,1.)
        new=m.mainmod.apply(row,m.mainmod.EXIT_RULES["DOT_PROFIT_2P0_FLOOR0P5"],source,10,obs)
        self.assertEqual(new["exit_ts_ms"],row["exit_ts_ms"])
    def test_cost_sensitivity_preserves_floor_not_guarantee(self):
        _,source,row,obs=sample()
        a=m.mainmod.apply(row,m.mainmod.EXIT_RULES["DOT_PROFIT_2P0_FLOOR0P5"],source,10,obs)
        b=m.mainmod.apply(row,m.mainmod.EXIT_RULES["DOT_PROFIT_2P0_FLOOR0P5"],source,30,obs)
        self.assertLess(a["exit_price"],b["exit_price"])
        self.assertGreater(a["unit_price_return"],b["unit_price_return"])
        self.assertGreater(b["unit_price_return"],0)
    def test_three_arm_and_floor_values(self):
        a=m.DOT_GUARDS
        self.assertEqual(a["DOT_PROFIT_1P5_FLOOR0P25"],(.015,.0025))
        self.assertEqual(a["DOT_PROFIT_2P0_FLOOR0P5"],(.020,.005))
        self.assertEqual(a["DOT_PROFIT_3P0_FLOOR1P0"],(.030,.010))
if __name__=="__main__":
    unittest.main()
