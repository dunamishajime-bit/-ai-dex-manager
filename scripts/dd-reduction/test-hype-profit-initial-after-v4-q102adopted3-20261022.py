#!/usr/bin/env python3
"""HYPE-only confirmed M5 arming, early adverse and accepted V4/Q102 isolation."""
import importlib.util,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('hype_study',HERE/'run-hype-profit-loss-after-accepted-v4-q102-20261022.py')
x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x)
H=x.HOUR;M5=x.M5
assert len(x.base.long.TIME_ROUTES)==37 and len(x.base.short.TIME_ROUTES)==37
assert x.Q102_3['id']=='Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3'
assert x.Q102_3['arm_hours']==2 and x.Q102_3['loss_pct']==.03
def trade(strategy='HYPE_LONG'):
 return {'strategy_id':strategy,'side':'LONG','symbol':'HYPEUSDT',
  'entry_ts_ms':0,'exit_ts_ms':3*H,'entry_price':100.,'exit_price':99.,
  'candidate_id':'U1','quantity':1.,'original_quantity':1.,'position_id':1,
  'modeled_realized_pnl_jpy_at_exit_fx':-100.,'total_pnl_jpy':-1.,
  'exit_reason_actual':'5M_PROTECTIVE_STOP'}
def bars():
 return [(i*M5,100.,100.1,99.9,100.,1.) for i in range(36)]
class Feed:
 def __init__(self,v):self.v=v;self.ts=[a[0] for a in v]
 def getdata(self,symbol):return self.v,self.ts
def obs():
 d=collections.defaultdict(int);d['by_reason']=collections.Counter();d['stop_decisions']=[];return d
profit=x.HYPE_CASES['HYPE_PROFIT_ARM0P8_FLOOR0P3']
# Intrabar touched +0.8 but completed close remains +0.4, no arming.
b=bars();b[0]=(0,100,101,99.9,100.4,1)
b[1]=(M5,100.2,100.3,99.8,100.0,1)
assert x.profit_after_confirmed_m5(trade(),profit,Feed(b),10,obs())==trade()
# A prior completed M5 CLOSE +0.9 arms stop, next M5 gap below +0.3 executes conservatively.
b=bars();b[0]=(0,100,101.5,99.9,100.9,1)
b[1]=(M5,100.1,100.5,99.6,100.1,1)
got=x.profit_after_confirmed_m5(trade(),profit,Feed(b),10,obs())
assert got['exit_ts_ms']==2*M5 and got['exit_price']<100.1,got
assert got['exit_reason']=='RESEARCH_HYPE_PROFIT_ARM0P8_FLOOR0P3',got
# HYPE already closed during next 5m; no synthetic earlier fill.
short=trade();short['exit_ts_ms']=2*M5
assert x.profit_after_confirmed_m5(short,profit,Feed(b),10,obs())==short
# No HYPE variant must touch Q102, V12, PENGU or another family.
for strategy in ('Q102','V12','PENGU','FET','IDLE'):
 t=trade(strategy=strategy)
 assert x.apply(t,profit,Feed(b),10,obs())==t
# HYPE early STOP must respect source 1h delay and prior +0.3 MFE cutoff.
early=x.HYPE_CASES['HYPE_EARLY_1H_MINUS1_MFE0P3']
b=bars()
for i in range(12,len(b)):
 b[i]=(i*M5,98.7,99.1,98.4,98.8,1)
got=x.apply(trade(),early,Feed(b),10,obs())
assert got['exit_ts_ms']<3*H and got['exit_reason'].startswith('RESEARCH_INITIAL_ADVERSE_STOP_'),got
# After earlier +1% excursion the early stop is BLOCKED.
b=bars();b[0]=(0,100,101.4,99.9,100.6,1)
for i in range(12,len(b)):
 b[i]=(i*M5,98.7,99.1,98.4,98.8,1)
assert x.apply(trade(),early,Feed(b),10,obs())==trade()
# Internal M5 missing is fail closed; don't fabricate quote timeline.
gap=b[:8]+b[9:]
assert x.profit_after_confirmed_m5(trade(),profit,Feed(gap),10,obs())==trade()
print('PASS HYPE-only 5m close-confirmed profit arm, gap-aware floor and early 1h -1% MFE gate, all four V4 & three Q102 fixed, no strategy spill')
