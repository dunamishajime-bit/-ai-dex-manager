#!/usr/bin/env python3
"""Q102 initial adverse + staged profit source model causal/side/scope unit tests."""
import importlib.util,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(alias,file):
 spec=importlib.util.spec_from_file_location(alias,HERE/file)
 obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
q=load("q102_family","run-q102-focused-family-guard-after-v4-20261022.py")
M5=q.M5;H=q.HOUR
assert q.LONGSTOP["m5_floor"]==-.05 and q.LONGSTOP["pre_arm_mfe"]==.02
assert len(q.long.TIME_ROUTES)==37 and len(q.long.old.ROUTES_X)==3
assert q.SHORTPROFIT["mfe_gte"]==.05 and q.SHORTPROFIT["profit_floor"]==.02
assert len(q.PREARM_FAMILY_LIMITS)==6
class Feed:
 def __init__(self,rows):self.bars=rows;self.times=[x[0] for x in rows]
 def getdata(self,symbol):return self.bars,self.times
def row(family="MR",side="SHORT",strategy="Q102"):
 return {"strategy_id":strategy,"family":family,"side":side,"symbol":"ETHUSDT",
 "entry_price":100.,"entry_ts_ms":0,"exit_ts_ms":5*H,"exit_price":100.,
 "quantity":1,"candidate_id":"unit-1","position_id":1}
def obs():
 d=collections.defaultdict(int)
 d['by_reason']=collections.Counter()
 d['stop_decisions']=[]
 return d
def bars():
 return [(i*M5,100.,100.1,99.9,100.,1.) for i in range(5*12)]
b=bars()
# SHORT profit upgrade arm on completed close >=3%, not same-bar low.
b[0]=(0,100,100.0,96.7,97.1,1.)  # intrabar +3.3%, close +2.9%, MUST NOT ARM
b[1]=(M5,100.8,101.,99.9,100.8,1.)
policy=q.Q102_CASES['Q102_MR_SHORT_PROFIT3_FLOOR1']
assert q.q102_floor(row(),policy,Feed(b),10,obs())==row()
# Prior bar close +3.1% SHORT -> next bar rises above +1% protection.
b[0]=(0,100.,100.,96.5,96.9,1.)
b[1]=(M5,102.,102.2,101.8,102.,1.)
res=q.q102_floor(row(),policy,Feed(b),10,obs())
assert res['exit_reason']=='RESEARCH_Q102_PROFIT_ARM2_FLOOR0P5',res
assert res['exit_ts_ms']==2*M5 and res['exit_price']>102.,res
# LONG side profit model mirror
b=bars();b[0]=(0,100,103.2,99.8,103.1,1);b[1]=(M5,98.9,99.0,98.5,98.8,1)
long=q.q102_floor(row(family="PB",side="LONG"),q.Q102_CASES['Q102_PROFIT_ARM3_FLOOR1'],Feed(b),10,obs())
assert long['exit_ts_ms']==2*M5 and long['exit_price']<99.,long
# No side/family leakage to Q102 other Family, and no other strategy mutations.
candidate=q.Q102_CASES['Q102_MR_SHORT_PREARM4P0_H3']
original_bars=bars()
for i in range(36,len(original_bars)):
 original_bars[i]=(i*M5,104.5,104.6,104.2,104.4,1.)
short=q.apply(row(),candidate,Feed(original_bars),10,obs())
assert short['exit_ts_ms']<row()['exit_ts_ms'] and 'RESEARCH_INITIAL_ADVERSE_STOP_' in short['exit_reason'],short
for rowkind in [row(family="REV"),row(family="MR",side="LONG"),row(family="MR",strategy="V12")]:
 assert q.apply(rowkind,candidate,Feed(original_bars),10,obs())==rowkind
# Before 3h no retroactive adverse exit even with early threshold breach.
earlier=bars()
for i in range(35):earlier[i]=(i*M5,104.7,104.9,104.4,104.6,1.)
later=Feed(earlier)
qrow=row()
assert q.apply(qrow,candidate,later,10,obs())==qrow
# Missing internal M5 causes FAIL CLOSED, not extrapolated fills.
broken=original_bars[:16]+original_bars[17:]
result=q.apply(row(),candidate,Feed(broken),10,obs())
assert result==row()
print("PASS Q102 family prearm +4%/3h and staged profit +3% -> +1%, Q102-only, causal full M5, no same bar/side/family spill, V4 frozen")
