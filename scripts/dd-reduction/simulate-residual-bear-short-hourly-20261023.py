#!/usr/bin/env python3
"""RESIDUAL ENTRY redesign #2: causal bear-market SHORT and directional switching.

Complements LONG-only original RESIDUAL; this is research for a *new*
DOGE/AVAX SHORT signal, not a change to live. No liquidity, funding,
portfolio ownership, or direct L2 evidence. HH:55 closed 5m signal ->
next hour HH:00 M5 open fill; one position at a time per symbol,
12h fixed time exit, legacy-inspired emergency price STOP 10%, TP 25%,
10bps vs 30bps roundtrip costs, worst-case same-bar STOP before TP.
Split 2026-02-10. In-sample explored 20+ cases; no independent OOS.
"""
from __future__ import annotations
import bisect,datetime,importlib.util,json,math,statistics,csv
from pathlib import Path
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
OUT=REPO/"docs/research/results/residual-entry-after-amzn-20261023"
def load(name,path):
 sp=importlib.util.spec_from_file_location(name,path);assert sp and sp.loader
 mod=importlib.util.module_from_spec(sp);sp.loader.exec_module(mod);return mod
base=load("residual_long_new_entry_reuse_m5",HERE/"simulate-residual-new-multifactor-hourly-long-20261023.py")
native=base.native
features=base.features
H=3600000;M5=300000
SPECS={
 "BTC6_DOWN":(("btc6h","lt",0),),
 "BTC24_DOWN":(("btc24h","lt",0),),
 "DOGE3_DOWN":(("ret3h","lt",0),),
 "DOGE6_DOWN":(("ret6h","lt",0),),
 "REL3_DOWN":(("rel3h","lt",0),),
 "BTC6_DOWN_DOGE3_DOWN":(("btc6h","lt",0),("ret3h","lt",0)),
 "BTC6_DOWN_DOGE6_DOWN":(("btc6h","lt",0),("ret6h","lt",0)),
 "BTC6_DOWN_REL3_DOWN":(("btc6h","lt",0),("rel3h","lt",0)),
 "BTC6_DOWN_REL6_DOWN":(("btc6h","lt",0),("rel6h","lt",0)),
 "BTC24_DOWN_DOGE6_DOWN":(("btc24h","lt",0),("ret6h","lt",0)),
 "BTC6_DOWN_DOGE6_MINUS1":(("btc6h","lt",0),("ret6h","le",-1)),
 "BTC6_DOWN_DOGE6_MINUS2":(("btc6h","lt",0),("ret6h","le",-2)),
 "BTC6_DOWN_DOGE3_DOWN_REL3_DOWN":(("btc6h","lt",0),("ret3h","lt",0),("rel3h","lt",0)),
 "BTC6_DOWN_DOGE6_DOWN_VOL1P2":(("btc6h","lt",0),("ret6h","lt",0),("volratio","ge",1.2)),
 "BTC6_DOWN_DOGE6_DOWN_ATR0P7":(("btc6h","lt",0),("ret6h","lt",0),("atr3h","ge",.7)),
 "BTC6_DOWN_DOGE6_DOWN_REL3_DOWN":(("btc6h","lt",0),("ret6h","lt",0),("rel3h","lt",0)),
 "BTC24_DOWN_DOGE3_DOWN_REL24_DOWN":(("btc24h","lt",0),("ret3h","lt",0),("rel24h","lt",0)),
 "BTC6_DOWN_REL24_LE_MINUS3_VOL1P2":(("btc6h","lt",0),("rel24h","le",-3),("volratio","ge",1.2)),
 "BTC6_DOWN_DOGE6_DOWN_BREAK1H":(("btc6h","lt",0),("ret6h","lt",0),("breakdown","flag",True)),
 "BTC6_DOWN_DOGE6_DOWN_EMA_DOWN":(("btc6h","lt",0),("ret6h","lt",0),("emaDown","flag",True)),
 "BTC6_DOWN_DOGE6_DOWN_RETEST":(("btc6h","lt",0),("ret6h","lt",0),("retest","flag",True)),
 "BTC6_DOWN_DOGE6_DOWN_VOL1P2_EMA_DOWN":(("btc6h","lt",0),("ret6h","lt",0),("volratio","ge",1.2),("emaDown","flag",True)),
}
def allow(rule,features_,bars,i):
 for k,op,val in rule:
  if k=="breakdown":
   if i<13 or float(bars[i][4])>=min(float(bars[t][3]) for t in range(i-12,i)):return False
   continue
  if k=="emaDown":
   if i<36:return False
   cs=[float(bars[t][4]) for t in range(i-36,i+1)]
   x=y=cs[0];a=2/13;b=2/37
   for cl in cs[1:]:
    x+=a*(cl-x);y+=b*(cl-y)
   if not (x<y and cs[-1]<x):return False
   continue
  if k=="retest":
   if i<24:return False
   last=float(bars[i][4]);back30=float(bars[i-6][4]);back1h=float(bars[i-12][4])
   if not (last<back30 and -.005<last/back1h-1<.015):return False
   continue
  f=features_.get(k)
  if f is None or not math.isfinite(float(f)):return False
  if op=="lt" and not (float(f)<val):return False
  if op=="le" and not (float(f)<=val):return False
  if op=="ge" and not (float(f)>=val):return False
 return True
def opportunity(sym,case,source):
 rule=SPECS[case]
 bars,times=source.getdata(sym)
 begin=bisect.bisect_left(times,base.START)
 end=bisect.bisect_left(times,base.END)
 candidates=[]
 for i in range(max(begin,290),end):
  decision=times[i]+M5
  if decision%H or i+1>=end or times[i+1]!=decision:continue
  f=features.get_feat(source,sym,decision)
  if not base.prefilter(sym,f):continue
  if allow(rule,f,bars,i):candidates.append((i+1,decision,f))
 return bars,times,candidates
def run(sym,case,cost,source):
 bars,times,signals=opportunity(sym,case,source)
 events=[];previous_exit=-1
 for i,decision,features_ in signals:
  if decision<=previous_exit:continue
  enter=float(bars[i][1])
  if enter<=0:continue
  end=min(len(bars)-1,i+144)
  outprice=None;reason="TIME12H";exitts=None
  mfe=0.;mae=0.
  for j in range(i,end):
   ti,op,hi,lo,cl,_vol=bars[j]
   if j>i and ti!=times[j-1]+M5:raise RuntimeError("NONCONTIGUOUS_PRICE_M5")
   mfe=max(mfe,100*(enter/float(lo)-1))
   mae=min(mae,100*(enter/float(hi)-1))
   stop=enter*1.10;take=enter*.75
   if float(hi)>=stop:
    outprice=max(float(op),stop);exitts=ti+M5;reason="SHORT_STOP10";break
   if float(lo)<=take:
    outprice=take;exitts=ti+M5;reason="SHORT_TAKE25";break
  if outprice is None:
   outprice=float(bars[end][1]);exitts=times[end]
  netpct=100*((enter-outprice)/enter-cost/10000)
  events.append({"strategy":"RESIDUAL_REDESIGN_RESEARCH_ONLY",
     "symbol":sym,"case":case,"side":"SHORT","entryTsMs":decision,"exitTsMs":int(exitts),
     "entryUtc":datetime.datetime.fromtimestamp(decision/1000,datetime.timezone.utc).isoformat(),
     "entry":enter,"exit":outprice,"returnNetPct":netpct,"reason":reason,
     "maxFavorablePct":mfe,"maxAdversePct":mae,
     "btc6hPct":features_["btc6h"],"assetRet6hPct":features_["ret6h"],
     "relative3hPct":features_["rel3h"],"volumeRatio":features_["volratio"]})
  previous_exit=int(exitts)
 return events,len(signals)
def stat(rows):
 win=[x for x in rows if x["returnNetPct"]>0]
 loss=[x for x in rows if x["returnNetPct"]<=0]
 n=len(rows);good=sum(x["returnNetPct"] for x in win);bad=sum(x["returnNetPct"] for x in loss)
 e=10000.;peak=e;dd=0
 for t in rows:
  e*=1+t["returnNetPct"]/100
  if e<=0:raise ValueError("NONPOSITIVE_WALLET")
  peak=max(peak,e);dd=min(dd,100*(e/peak-1))
 return {"trades":n,"wins":len(win),"losses":len(loss),"winRatePct":len(win)/n*100 if n else None,
 "pf":good/-bad if bad<0 else None,
 "endingEquityJpy":e,"closedDDPct":dd,"grossProfitPctPoints":good,
 "grossLossPctPoints":bad,"totalNetReturnPctPoints":good+bad}
def main():
 native.m.acquire_verified_h1()
 src,_=native.m.m.core.task8.legacy.bootstrap()
 out={"status":"RESEARCH_ONLY_ALTERNATIVE_BEAR_MARKET_SHORT_NOT_LIVE_OR_INTEGRATED",
  "period":"2025-08-10..2026-08-10",
  "split":"2026-02-10",
  "entry":"Completed M5 at 55min prior to exact HH:00, next 5m open",
  "feeBpsRoundtrip":[10,30],
  "rules":SPECS,"cases":{},
  "limitations":["No original V52 ledger wallet ownership, no live/canonical parity",
    "M5 12h emergency STOP10 TAKE25 research proxy; no signed venue orderbook/funding",
    "Short entry candidates entirely new; no proof admission/slot priority equals production",
    "Case selection uses historic sample; cannot claim true unseen OOS"]}
 rows=[]
 for name in SPECS:
  for sym in ("DOGEUSDT","AVAXUSDT"):
   for c in (10,30):
    events,rawsignals=run(sym,name,c,src)
    early=[t for t in events if t["entryTsMs"]<base.SPLIT]
    late=[t for t in events if t["entryTsMs"]>=base.SPLIT]
    q={"all":stat(events),"early":stat(early),"late":stat(late),
      "potentialSignalsBeforeSlotExclusion":rawsignals}
    out["cases"].setdefault(name,{}).setdefault(sym,{})[str(c)]=q
    if c==10:rows.extend(events)
    print("SHORT_ENTRY",name,sym,c,"N",q["all"]["trades"],"W",q["all"]["wins"],
    "WR",round(q["all"]["winRatePct"] or 0,2),"PF",round(q["all"]["pf"] or 0,3),
    "DD",round(q["all"]["closedDDPct"],3),
    "TRAIN",q["early"]["wins"],"/",q["early"]["trades"],
    "LATE",q["late"]["wins"],"/",q["late"]["trades"],
    "EQUITY",round(q["all"]["endingEquityJpy"]),flush=True)
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/"RESIDUAL_INDEPENDENT_BEAR_SHORT_DESIGN_20261023.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 with (OUT/"RESIDUAL_INDEPENDENT_BEAR_SHORT_EVENTS_10BPS_20261023.csv").open("w",encoding="utf-8",newline="") as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator="\n");w.writeheader();w.writerows(rows)
 print("BEAR_SHORT_NEW_RESEARCH_COMPLETE",len(SPECS),"CASES",len(rows),"EVENTS")
if __name__=="__main__":main()
