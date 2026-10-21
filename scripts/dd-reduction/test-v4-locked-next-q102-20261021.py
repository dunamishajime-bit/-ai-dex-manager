#!/usr/bin/env python3
"""Source-contract Q102 close arming, gap fill, causal isolation, locked V4 scope."""
import importlib.util,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location("cumulative",HERE/"run-v4-locked-next-q102-20261021.py")
x=importlib.util.module_from_spec(s);s.loader.exec_module(x)
M5=x.M5;H=x.HOUR
assert len(x.long.TIME_ROUTES)==37 and len(x.long.old.ROUTES_X)==3 and len(x.short.TIME_ROUTES)==37
assert len(x.Q102_CASES)==6
assert x.SHORTPROFIT["mfe_gte"]==.05 and x.SHORTPROFIT["profit_floor"]==.02
assert x.LONGSTOP["m5_floor"]==-.05 and x.LONGSTOP["pre_arm_mfe"]==.02
def trade(side="LONG",strategy="Q102",exit_h=4):
 return {"strategy_id":strategy,"side":side,"route":"Q102_PB","symbol":"ETHUSDT",
  "entry_price":100.,"entry_ts_ms":0,"exit_ts_ms":exit_h*H,"exit_price":100.,
  "quantity":1.,"candidate_id":"T","position_id":1}
def bars(base=100.,n=48):
 return [(i*M5,base,base+.01,base-.01,base,1.) for i in range(n)]
class Feed:
 def __init__(self,rows):self.rows=rows;self.ts=[v[0] for v in rows]
 def getdata(self,symbol):return self.rows,self.ts
def obs():
 d=collections.defaultdict(int);d["by_reason"]=collections.Counter()
 d["stop_decisions"]=[];return d
rule=x.Q102_CASES["Q102_PROFIT_ARM2_FLOOR0P5"]
# LONG: transient intrabar +2% followed by close +1% must NOT arm.
b=bars()
b[0]=(0,100,103.,99.,101.,1)
b[1]=(M5,100,100.6,99.9,100.,1)
assert x.q102_floor(trade(),rule,Feed(b),10,obs())==trade()
# Explicit completed close +2% arms from next bar, gap fill no better than actual adverse open.
b[0]=(0,100,102.5,99.,102.2,1)
b[1]=(M5,99.5,100.,99.2,99.5,1)
filled=x.q102_floor(trade(),rule,Feed(b),10,obs())
assert filled["exit_ts_ms"]==2*M5 and 99.35<=filled["exit_price"]<=99.5,filled
# SHORT: transient favorable low does NOT arm if close not >=2% favorable.
b=bars()
b[0]=(0,100,101,96.8,99.1,1)
b[1]=(M5,100,100.8,99,100,1)
assert x.q102_floor(trade(side="SHORT"),rule,Feed(b),10,obs())==trade(side="SHORT")
# SHORT: prior closed M5 at 97.9 arms, next open gaps above short stop => conservative cover.
b[0]=(0,100.,101.,97.5,97.9,1.)
b[1]=(M5,101.6,102.,101.,101.5,1.)
short=x.q102_floor(trade(side="SHORT"),rule,Feed(b),10,obs())
assert short["exit_ts_ms"]==2*M5 and short["exit_price"]>=101.6,short
# Missing M5 between fully formed bars refuses fabricated exit.
bad=b[:1]+b[2:]
d=obs()
assert x.q102_floor(trade(side="SHORT"),rule,Feed(bad),10,d)==trade(side="SHORT")
assert d["internal_gap"]==1
# NEVER apply Q102 exit to V12, PENGU, or other protected strategy.
for strategy in ["V12","PENGU","IDLE","HYPE_LONG","FET"]:
 assert x.q102_floor(trade(strategy=strategy),rule,Feed(b),10,obs())==trade(strategy=strategy)
assert x.Q102_CASES["Q102_MR_SHORT_INIT2P5_6H"]["family"]=="MR"
assert x.Q102_CASES["Q102_MR_SHORT_INIT2P5_6H"]["sides"]==["SHORT"]
assert x.Q102_CASES["Q102_HV_LONG_INIT2P5_6H"]["family"]=="HIGH_VOL"
assert x.Q102_CASES["Q102_HV_LONG_INIT2P5_6H"]["sides"]==["LONG"]
# Family targeting is a strict inclusion gate, not a rewrite of the existing Q102 strategy.
q=trade(strategy="Q102",side="SHORT");q["family"]="REV"
assert x.apply(q,x.Q102_CASES["Q102_MR_SHORT_INIT2P5_6H"],Feed(b),10,obs())==q
print("PASS V4 four frozen scopes / Q102 SHORT+LONG completed-close arms, adverse gap, missing M5 fail closed, non-Q102 isolation")
