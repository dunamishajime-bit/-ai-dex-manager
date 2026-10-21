#!/usr/bin/env python3
"""No same-bar future peeking; selected earlier causal Q102 exit, V4 unchanged."""
import importlib.util,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("both",HERE/"run-q102-combined-risk-and-profit-after-v4-20261022.py")
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
M5,H=c.M5,c.HOUR
policy=c.Q102_CASES['Q102_PB3H_LOSS_PLUS_Q102_PROFIT3_TO1']
assert policy['kind']=='pb_early_plus_profit'
assert c.LONGSTOP['m5_floor']==-.05 and len(c.long.TIME_ROUTES)==37 and len(c.short.TIME_ROUTES)==37
def row(family='PB',side='LONG'):
 return {'strategy_id':'Q102','family':family,'side':side,'entry_ts_ms':0,
 'exit_ts_ms':5*H,'entry_price':100.,'exit_price':100.,'symbol':'ETHUSDT',
 'candidate_id':'UNIT','position_id':1,'quantity':1.}
class Src:
 def __init__(self,b):self.b=b;self.ts=[x[0] for x in b]
 def getdata(self,symbol):return self.b,self.ts
def obs():
 d=collections.defaultdict(int);d['by_reason']=collections.Counter();d['stop_decisions']=[];return d
def bars():
 return [(i*M5,100,100.1,99.9,100,1) for i in range(60)]
b=bars()
b[0]=(0,100,103.2,99.9,103.1,1)
b[1]=(M5,99.2,99.4,98.9,99.1,1)
res=c.apply(row(),policy,Src(b),10,obs())
assert res['exit_ts_ms']==2*M5 and res['exit_reason'].startswith('RESEARCH_Q102_PROFIT_'),res
# PB never reaches +0.5 favorable before third hour; -1.5% adverse is early exit.
b=bars()
for i in range(36,len(b)):
 b[i]=(i*M5,98.3,98.5,97.8,98.1,1)
r=c.apply(row(),policy,Src(b),10,obs())
assert r['exit_ts_ms']<5*H and 'INITIAL_ADVERSE_STOP' in r['exit_reason'],r
# For HIGH_VOL same -1.5% should not apply PB-only initial rule.
assert c.apply(row(family='HIGH_VOL'),policy,Src(b),10,obs())==row(family='HIGH_VOL')
assert c.apply(row(family='PB',side='SHORT'),policy,Src(b),10,obs())==row(family='PB',side='SHORT')
# All non-Q102 strategies remain untouched by Q102 overlay.
v4=dict(row(),strategy_id='V12')
assert c.apply(v4,policy,Src(b),10,obs())==v4
print('PASS Q102 PB-only 3h/-1.5% early EXIT plus 3%/1% closed-5m staged-profit, causal precedence, other-family/side isolation, V4 frozen')
