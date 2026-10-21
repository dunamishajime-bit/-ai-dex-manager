#!/usr/bin/env python3
"""Q102 double CLOSED H1 adverse confirmation, no future leakage, V4 fixed."""
import importlib.util,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('q102h1',HERE/'run-q102-timeexit-two-confirmed-h1-after-v4-20261022.py')
x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x)
H=x.HOUR;M5=x.M5
assert len(x.long.TIME_ROUTES)==37 and len(x.long.old.ROUTES_X)==3 and len(x.short.TIME_ROUTES)==37
assert x.LONGSTOP['m5_floor']==-.05 and x.SHORTPROFIT['profit_floor']==.02
policy=x.Q102_CASES['Q102_MR_SHORT_H1_2CLOSE_BELOW2_AFTER12H']
class Feed:
 def __init__(self,b):self.b=b;self.ts=[a[0] for a in b]
 def getdata(self,sym):return self.b,self.ts
def trade(strategy='Q102',family='MR',side='SHORT'):
 return dict(strategy_id=strategy,family=family,side=side,symbol='UNIUSDT',
 entry_ts_ms=0,exit_ts_ms=16*H,entry_price=100.,exit_price=100.,quantity=1.,candidate_id='U1')
def obs():
 d=collections.defaultdict(int);d['by_reason']=collections.Counter();return d
def bars():return [(i*M5,100.,100.1,99.9,100.,1) for i in range(16*12)]
b=bars()
# Strict UTC H1 boundaries: bar 131 ends at 11h, bar143 ends at12h.
for i in (131,143):
 b[i]=(i*M5,102.1,102.9,102.,102.5,1)
y=x.q102_h1_confirmed_exit(trade(),policy,Feed(b),10,obs())
assert 'RESEARCH_Q102_H1_2CLOSE_LOSS_' in y['exit_reason'],y
assert y['exit_ts_ms']==12*H+M5,(y['exit_ts_ms'],12*H+M5)
assert y['exit_price']>100.
# One completed H1 negative is insufficient.
one=bars();one[143]=b[143]
assert x.q102_h1_confirmed_exit(trade(),policy,Feed(one),10,obs())==trade()
# M5 intrabar low is NOT confirmed profit +2% (SHORT); no accidental arming.
w=bars();w[0]=(0,100,100,97,99,1)
for i in (131,143):w[i]=b[i]
assert x.q102_h1_confirmed_exit(trade(),policy,Feed(w),10,obs())!=trade()
# Earlier fully completed M5 CLOSE reaches +2%, blocks initial loss proposal.
armed=bars();armed[0]=(0,100.,100.,97.5,97.8,1.)
for i in (131,143):armed[i]=b[i]
assert x.q102_h1_confirmed_exit(trade(),policy,Feed(armed),10,obs())==trade()
# Wrong strategy / Family / Side fail-closed without mutation.
for t in (trade(strategy='V12'),trade(family='REV'),trade(side='LONG')):
 assert x.q102_h1_confirmed_exit(t,policy,Feed(b),10,obs())==t
# Missing M5 inside history prevents fills even if late 2x H1 signaled.
gap=b[:40]+b[41:]
assert x.q102_h1_confirmed_exit(trade(),policy,Feed(gap),10,obs())==trade()
print('PASS Q102 H1 two completed UTC hours after 12h, next-M5 causal exit, 2% close-profit gate, no same bar lookahead, gap fails closed, V4 fixed')
