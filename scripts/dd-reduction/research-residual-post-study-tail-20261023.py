#!/usr/bin/env python3
"""Post-study market-data tail test, RESEARCH ONLY, NOT independent unseen OOS."""
from __future__ import annotations
import bisect,datetime,importlib.util,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
D=HERE/"research-residual-stateful-entry-exit-20261023.py"
s=importlib.util.spec_from_file_location("residual_deep_tail",D)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
ROOT=REPO/"docs/research/results/residual-entry-exit-deep-20261023"
START=int(datetime.datetime(2026,8,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
SOURCE_LAST_END=int(datetime.datetime(2026,9,1,tzinfo=datetime.timezone.utc).timestamp()*1000)
def main():
 m.base.native.m.acquire_verified_h1()
 src,_=m.base.native.m.m.core.task8.legacy.bootstrap()
 out={"status":"RESEARCH_POST_STUDY_TAIL_NOT_TRUE_OOS_NOT_FULL8_NO_LIVE",
   "period":"2026-08-10..available historical M5 tail",
   "note":"Rules frozen from earlier RESIDUAL 2026-10-23 research. Data dates are later than original 2026-08-10 study cutoff, but not proven untouched from other analyses.",
   "limitations":["~22d short tail, small sample and possible regime mismatch",
      "No 8-strategy capital admission, mark-to-market equity, venue L2, funding or margin parity"],"costsBps":[10,30],"cases":{}}
 for sym in m.SYMS:
  bars,times=src.getdata(sym);start=max(bisect.bisect_left(times,START),290)
  # Only decisions allowing 12h complete exits within source coverage.
  end=min(bisect.bisect_left(times,SOURCE_LAST_END),len(bars)-145)
  signals={name:[] for name in m.ENTRY_NAMES}
  cnt=0
  for j in range(start,end):
   decision=times[j]+m.M5
   if decision%m.H or times[j+1]!=decision:continue
   f=m.features_for(sym,bars,times,j,src)
   if f is None:continue
   cnt+=1
   for name in m.ENTRY_NAMES:
    if m.allows(name,sym,f):signals[name].append((j+1,decision))
  for name in m.ENTRY_NAMES:
   side="SHORT" if name in m.SHORT_NAMES else "LONG"
   rec={"rawSignals":len(signals[name]),"costs":{}}
   for cost in (10,30):
    # No END beyond available 5m candles; programmatic guard includes trailing 12h.
    cohort=[]
    busy=-1
    for idx,t in signals[name]:
     if t<=busy:continue
     ep=float(bars[idx][1]);n=144
     if idx+n>=len(bars) or times[idx+n]>=SOURCE_LAST_END:continue
     # Temporarily raise end bound from original research to available tail.
     original=m.END;m.END=SOURCE_LAST_END
     try:r=m.simulate(bars,times,idx,side,m.EXIT_CASES["ORIGINAL_12H"],cost)
     finally:m.END=original
     if r:
      cohort.append(r);busy=r["exitTsMs"]
    rec["costs"][str(cost)]=m.stats(cohort)
   out["cases"].setdefault(name,{})[sym]=rec
  print("TAIL_SYMBOL",sym,"hourly",cnt,
   "SHORT_RETEST",out["cases"]["SHORT_RETEST_FAIL"][sym],
   "PB_RECOVER",out["cases"]["PB_RECOVER_BTC"][sym],flush=True)
 ROOT.mkdir(parents=True,exist_ok=True)
 p=ROOT/"RESIDUAL_POST_STUDY_TAIL_AUDIT_20261023.json"
 p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("TAIL_AUDIT_COMPLETE",p,flush=True)
if __name__=="__main__": main()
