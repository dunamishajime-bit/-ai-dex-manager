#!/usr/bin/env python3
"""Two user-adopted Q102 rules always present; new HIGH_VOL LONG -3% H1x2 after2h.
Selected profit rule and PB prior rule never broaden scope to others. No future bars.
"""
import importlib.util,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('q102_add',HERE/'run-q102-adopted2-plus-hvlong-h1-2h-20261022.py')
x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x)
H=x.HOUR;M5=x.M5
assert len(x.long.TIME_ROUTES)==37 and len(x.long.old.ROUTES_X)==3 and len(x.short.TIME_ROUTES)==37
assert x.LONGSTOP['m5_floor']==-.05 and x.SHORTPROFIT['profit_floor']==.02
A=x.Q102_CASES['Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3']
B=x.Q102_CASES['Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3_PREPROFIT']
assert A['arm_hours']==2 and A['loss_pct']==.03 and A['preprofit_close_arm']==999.
assert B['preprofit_close_arm']==.02
def tr(family='HIGH_VOL',side='LONG',strategy='Q102'):
 return dict(strategy_id=strategy,family=family,side=side,symbol='ENAUSDT',
  entry_ts_ms=0,exit_ts_ms=5*H,entry_price=100.,exit_price=100.,quantity=1.,candidate_id='T')
def bars():
 return [(i*M5,100.,100.1,99.9,100.,1.) for i in range(5*12)]
class S:
 def __init__(self,b):self.b=b;self.ts=[a[0] for a in b]
 def getdata(self,sym):return self.b,self.ts
def ob():
 d=collections.defaultdict(int);d['by_reason']=collections.Counter();d['stop_decisions']=[];return d
# After two COMPLETE UTC H1 closes (0:55 and 1:55 M5 bars, for last two hours)
m=bars()
for i in (11,23):m[i]=(i*M5,96.0,97.0,95.9,96.8,1)
for r in (A,B):
 y=x.apply(tr(),r,S(m),10,ob())
 assert y['exit_ts_ms']==2*H+M5,(r['id'],y)
 assert y['exit_reason'].startswith('RESEARCH_Q102_H1_2CLOSE_LOSS_')
# Second close at 2h is necessary, and one is not sufficient.
only=bars();only[23]=m[23]
assert x.apply(tr(),A,S(only),10,ob())==tr()
# No H1 lookahead before 2h even if price touched adverse -3% intrabar.
intrabar=bars()
for i in (11,23):intrabar[i]=(i*M5,100.,100.1,96.1,100.,1)
assert x.apply(tr(),A,S(intrabar),10,ob())==tr()
# Preprofit guard variant: previous *closed* 5m +2% blocks, main user requested rule does not.
earlier=bars()
earlier[0]=(0,100.,102.5,99.9,102.1,1)
for i in (11,23):earlier[i]=m[i]
a=x.apply(tr(),A,S(earlier),10,ob())
b=x.apply(tr(),B,S(earlier),10,ob())
assert a['exit_ts_ms']==2*H+M5,a
assert b==tr(),b
# Original HIGH_VOL SHORT +3% CONFIRMED M5 CLOSE -> signed entry +1% floor.
short=bars()
short[0]=(0,100,101,96,96.9,1)
short[1]=(M5,101,102,100,101,1)
y=x.apply(tr(side='SHORT'),A,S(short),10,ob())
assert y['exit_ts_ms']==2*M5 and y['exit_reason'].startswith('RESEARCH_Q102_PROFIT_'),y
# Original PB LONG 3h after, MFE below+0.5%, adverse threshold >=1.5%
pb=bars()
for i in range(36,len(pb)):pb[i]=(i*M5,98.3,98.5,97.8,98.1,1)
y=x.apply(tr(family='PB'),A,S(pb),10,ob())
assert y['exit_ts_ms']<5*H and 'RESEARCH_INITIAL_ADVERSE_STOP_' in y['exit_reason'],y
# Q102 other families and independent V12 untouched
for k in (tr(family='REV'),tr(side='SHORT',family='MR'),tr(strategy='V12')):
 assert x.apply(k,A,S(m),10,ob())==k,k
# Data gaps fail closed (no future interpolation)
gap=m[:16]+m[17:]
assert x.apply(tr(),A,S(gap),10,ob())==tr()
print('PASS V4 4 exit scopes, Q102 PB early and HV SHORT profit adopted fixed, HV LONG H1x2 after2h/-3%, confirmed M5/H1, prior +2 variant comparison, gaps and no leakage')
