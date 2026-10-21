#!/usr/bin/env python3
"""HYPE conservative +3% completed M5 close -> +1% protection causal tests."""
import importlib.util,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('hype_profit3',HERE/'run-hype-conservative-profit3-after-v4q102-20261022.py')
x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x)
M5=x.M5;H=x.HOUR
policy=x.HYPE_CASES['HYPE_PROFIT_ARM3_FLOOR1']
assert policy['arm']==.03 and policy['floor']==.01
assert len(x.base.long.TIME_ROUTES)==37 and len(x.base.short.TIME_ROUTES)==37
assert x.Q102_3['id']=='Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3'
def trade(strategy='HYPE_LONG'):
 return {'strategy_id':strategy,'side':'LONG','symbol':'HYPEUSDT',
 'entry_ts_ms':0,'exit_ts_ms':3*H,'entry_price':100.,'exit_price':99.,
 'candidate_id':'U3','quantity':1.,'modeled_realized_pnl_jpy_at_exit_fx':-100.,'exit_reason_actual':'5M_PROTECTIVE_STOP'}
def bars():return [(i*M5,100.,100.2,99.8,100.,1.) for i in range(36)]
class Feed:
 def __init__(self,rows):self.rows=rows;self.ts=[r[0] for r in rows]
 def getdata(self,sym):return self.rows,self.ts
def obs():
 d=collections.defaultdict(int);d['by_reason']=collections.Counter();d['stop_decisions']=[];return d
b=bars();b[0]=(0,100.,103.4,99.9,102.9,1.)
b[1]=(M5,100.5,100.8,99.9,100.3,1.)
assert x.apply(trade(),policy,Feed(b),10,obs())==trade(), 'HIGH_ONLY_MUST_NOT_ARM'
b[0]=(0,100.,103.5,99.9,103.1,1.)
y=x.apply(trade(),policy,Feed(b),10,obs())
assert y['exit_ts_ms']==2*M5 and y['exit_price']<100.5,y
assert y['exit_reason']=='RESEARCH_HYPE_PROFIT_ARM3_FLOOR1',y
for strategy in ('Q102','V12','PENGU','FET'):
 r=trade(strategy)
 assert x.apply(r,policy,Feed(b),10,obs())==r
late=bars()
late[20]=(20*M5,100.,103.5,99.9,103.1,1.)
late[21]=(21*M5,100.5,100.8,99.9,100.3,1.)
gap=late[:8]+late[9:]
assert x.apply(trade(),policy,Feed(gap),10,obs())==trade()
print('PASS HYPE +3% confirmed M5 CLOSE arms +1% floor on later M5 only, gap-aware, no Q102/V4 leakage, source HYPE75 unchanged')
