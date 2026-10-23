#!/usr/bin/env python3
"""Frozen post-study M5 tail of highwin AVAX/DOGE SHORT_BEAR_BREAK entrance.
Research only: tail itself may not be independent and is <1 month."""
from __future__ import annotations
import bisect,datetime,importlib.util,json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
sp=importlib.util.spec_from_file_location("residual_highwin_tail_source",HERE/"research-residual-highwin-entry-exit-20261023.py")
h=importlib.util.module_from_spec(sp);sp.loader.exec_module(h)
m=h.m
UTC=datetime.timezone.utc
START=int(datetime.datetime(2026,8,10,tzinfo=UTC).timestamp()*1000)
PRICE_END=int(datetime.datetime(2026,9,1,tzinfo=UTC).timestamp()*1000)
OUT=REPO/"docs/research/results/residual-highwin-20261023"
def main():
 m.base.native.m.acquire_verified_h1()
 src,_=m.base.native.m.m.core.task8.legacy.bootstrap()
 out={"status":"RESEARCH_ONLY_TAIL_NOT_FRESH_OOS",
      "dates":"2026-08-10..2026-09-01; last >=12h reserve for complete replay",
      "costs":[10,30],
      "cases":{}}
 old=m.END;m.END=PRICE_END
 try:
  for symbol in m.SYMS:
   bars,times=src.getdata(symbol)
   a=bisect.bisect_left(times,START)
   b=min(bisect.bisect_left(times,PRICE_END-12*h.H),len(times)-145)
   decisions=0;signal={}
   for rule in ("SHORT_BEAR_BREAK","SHORT_RELATIVE_ACCEL","LONG_BTC_STABLE_PULLBACK"):
    signal[rule]=[]
   for j in range(max(a,290),b):
    t=times[j]+h.M5
    if t%h.H or times[j+1]!=t:continue
    f=m.features_for(symbol,bars,times,j,src)
    if f is None:continue
    decisions+=1
    for label in signal:
     side,allow=h.RULES[label]
     if allow(f,symbol):signal[label].append((j+1,t))
   for label,rows in signal.items():
    cases={}
    for exitname in ("TIME6H","TP1P0_SL2P5_3H","TP1P5_SL3P0_6H","TP2P0_SL4P0_12H"):
     cases[exitname]={}
     for cost in (10,30):
      tr=m.allocate(rows,bars,times,h.RULES[label][0],h.EXIT_RULES[exitname],cost)
      cases[exitname][str(cost)]=m.stats(tr)
    out["cases"].setdefault(symbol,{})[label]={"rawSignals":len(rows),"exitCases":cases}
   print("TAIL",symbol,"decisions",decisions,
      "shortBreak",out["cases"][symbol]["SHORT_BEAR_BREAK"],flush=True)
 finally:m.END=old
 OUT.mkdir(parents=True,exist_ok=True)
 p=OUT/"RESIDUAL_HIGHWIN_POST_STUDY_TAIL_20261023.json"
 p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("TAIL_COMPLETE",p,flush=True)
if __name__=="__main__":main()