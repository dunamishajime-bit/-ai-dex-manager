#!/usr/bin/env python3
"""RESIDUAL DOGE/AVAX LONG: causal M5 entry feature discovery.

Select original full-8 accepted entries from SHA-pinned AMZN +1% research baseline.
Screen train/test in chronological split 2026-02-10 (exploratory only, not true OOS
because strategy search was already informed by historic outcomes).
Neither MTM nor capital reallocation is re-run in this first descriptive pass.
Model uses M5 bars fully completed before signal_ts (no future reads).
"""
from __future__ import annotations
import collections,datetime,hashlib,importlib.util,json,math,statistics
from pathlib import Path
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
HERE=Path(__file__).resolve().parent; REPO=HERE.parents[1]
OUT=REPO/"docs/research/results/residual-entry-after-amzn-20261023"
SPLIT=int(datetime.datetime(2026,2,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
def load(name,path):
 sp=importlib.util.spec_from_file_location(name,path);assert sp and sp.loader
 mod=importlib.util.module_from_spec(sp);sp.loader.exec_module(mod);return mod
native=load("residual_entry_verified_amzn_replay",HERE/"run-v52-amzn-entry-full8-after-fet-20261022.py").native
features=load("residual_entry_feature_helper",HERE/"screen-idle-five-symbol-entry-caused-20261022.py")
SPECS={
 "BTC6H_GE_0":(("btc6h","ge",0),),
 "BTC6H_GE_MINUS1":(("btc6h","ge",-1),),
 "BTC3H_GE_0":(("btc3h","ge",0),),
 "BTC24H_GE_0":(("btc24h","ge",0),),
 "RET1H_GE_0":(("ret1h","ge",0),),
 "RET3H_GE_0":(("ret3h","ge",0),),
 "RET6H_GE_0":(("ret6h","ge",0),),
 "RET24H_GE_MINUS3":(("ret24h","ge",-3),),
 "REL3H_GE_0":(("rel3h","ge",0),),
 "REL6H_GE_0":(("rel6h","ge",0),),
 "REL24H_GE_0":(("rel24h","ge",0),),
 "REL6H_GE_MINUS1":(("rel6h","ge",-1),),
 "VOL1H_GE_1P2":(("volratio","ge",1.2),),
 "VOL1H_GE_1P0":(("volratio","ge",1.0),),
 "VOL1H_LE_1P5":(("volratio","le",1.5),),
 "ATR3H_LE_1P0":(("atr3h","le",1.0),),
 "ATR3H_LE_1P5":(("atr3h","le",1.5),),
 "RANGEPOS_GE_HALF":(("rangepos3h","ge",.5),),
 "RANGEPOS_LE_HALF":(("rangepos3h","le",.5),),
 "RET6H_GE_0_AND_BTC6H_GE_0":(("ret6h","ge",0),("btc6h","ge",0)),
 "REL3H_GE_0_AND_VOL1H_GE1":(("rel3h","ge",0),("volratio","ge",1)),
 "RET3H_GE0_AND_REL3H_GE0":(("ret3h","ge",0),("rel3h","ge",0)),
 "BTC6H_GE0_AND_REL6H_GE0":(("btc6h","ge",0),("rel6h","ge",0)),
 "RET1H_GE0_AND_REL3H_GE0":(("ret1h","ge",0),("rel3h","ge",0)),
 "RET3H_GE0_AND_ATR3H_LE1P5":(("ret3h","ge",0),("atr3h","le",1.5))
}
def sha(p):
 h=hashlib.sha256()
 with Path(p).open("rb") as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
def passes(feat,spec):
 for featname,op,val in spec:
  v=feat.get(featname)
  if v is None or not math.isfinite(float(v)):return False
  if op=="ge" and float(v)<val:return False
  if op=="le" and float(v)>val:return False
 return True
def metric(rows):
 gain=sum(r["modeledPnlJpy"] for r in rows if r["win"])
 loss=sum(r["modeledPnlJpy"] for r in rows if not r["win"])
 n=len(rows);wins=sum(r["win"] for r in rows)
 return {"n":n,"wins":wins,"losses":n-wins,"winRatePct":100*wins/n if n else None,
         "portfolioModeledContributionJpy":gain+loss,
         "profitJpy":gain,"lossJpy":loss,"weightedContributionPF":gain/(-loss) if loss<0 else None}
def main():
 base=json.loads((ROOT/"f8v52amzn_more/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json").read_text("utf-8"))["cases"]["AMZN_SHORT_PRIOR_CLOSE_PLUS1P0"]["costs"]
 native.m.acquire_verified_h1()
 src,_=native.m.m.core.task8.legacy.bootstrap()
 result={"status":"RESEARCH_SCREEN_ONLY_NOT_NEW_LIVE_SIGNAL_ADMISSION",
         "period":"2025-08-10..2026-08-10","trainingCutoffUtc":"2026-02-10",
         "caseType":"RESIDUAL_LONG_30/29_EXISTING_ACCEPTED_ONLY",
         "futureData":"M5 source helper uses bisect_left(time,entry_ts)-1 and complete time <= entry",
         "costs":{},"ruleDefinitions":SPECS}
 detail=[]
 for c in ("10","30"):
  cost=base[c]
  candidates=[p for p in (ROOT/"f8v52amzn_more/engine").rglob("portfolio-trades.jsonl") if sha(p)==cost["ledgerSha256"]]
  assert candidates
  alltrades=[json.loads(x) for x in candidates[0].read_text("utf-8").splitlines() if x]
  selected=sorted([x for x in alltrades if x["strategy_id"]=="RESIDUAL"],key=lambda x:x["entry_ts_ms"])
  assert len(selected)==(30 if c=="10" else 29)
  transformed=[]
  for r in selected:
   assert r["side"]=="LONG" and r["symbol"] in ("DOGEUSDT","AVAXUSDT")
   feat=features.get_feat(src,r["symbol"],r["entry_ts_ms"])
   assert feat is not None and all(math.isfinite(v) for v in feat.values() if v is not None)
   item={"candidateId":r["candidate_id"],"ts":int(r["entry_ts_ms"]),"symbol":r["symbol"],
     "route":r["route"],"side":r["side"],"win":r["total_pnl_jpy"]>0,
     "modelRoiPct":100*r["total_pnl_jpy"]/r["entry_equity"],
     "modeledPnlJpy":r["modeled_realized_pnl_jpy_at_exit_fx"],
     "features":feat,"train":r["entry_ts_ms"]<SPLIT}
   transformed.append(item)
  costresults={}
  for symbol in ("DOGEUSDT","AVAXUSDT"):
   subset=[r for r in transformed if r["symbol"]==symbol]
   baseMetrics=metric(subset)
   cases={}
   for name,spec in SPECS.items():
    accepted=[r for r in subset if passes(r["features"],spec)]
    tr=[r for r in accepted if r["train"]]
    tst=[r for r in accepted if not r["train"]]
    stats={"all":metric(accepted),"train":metric(tr),"late":metric(tst),
     "blocked":metric([r for r in subset if r not in accepted]),
     "keptCandidateIds":[r["candidateId"] for r in accepted],
     "blockedCandidateIds":[r["candidateId"] for r in subset if r not in accepted]}
    cases[name]=stats
   costresults[symbol]={"baseline":baseMetrics,
    "train":metric([r for r in subset if r["train"]]),
    "late":metric([r for r in subset if not r["train"]]),
    "candidates":cases}
   credible=sorted(((name,v) for name,v in cases.items() if v["all"]["n"]>=5 and v["train"]["n"]>=2 and v["late"]["n"]>=2),
     key=lambda kv:(kv[1]["late"]["winRatePct"],kv[1]["all"]["winRatePct"],kv[1]["all"]["n"]),reverse=True)
   print("RESIDUAL_ENTRY_SCREEN",c,symbol,"BASE",baseMetrics,"TRAIN",costresults[symbol]["train"],"LATE",costresults[symbol]["late"],flush=True)
   for name,stat in credible[:15]:
    print("TOP",c,symbol,name,"ALL",stat["all"]["wins"],"/",stat["all"]["n"],
      "TRAIN",stat["train"]["wins"],"/",stat["train"]["n"],
      "LATE",stat["late"]["wins"],"/",stat["late"]["n"],
      "PNLJPY",round(stat["all"]["portfolioModeledContributionJpy"]),flush=True)
  result["costs"][c]=costresults
  for row in transformed:
   detail.append({"costBps":int(c),**{k:v for k,v in row.items() if k!="features"},**row["features"]})
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/"RESIDUAL_CAUSAL_ENTRY_PRE_SCREEN_20261023.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 import csv
 with (OUT/"RESIDUAL_CAUSAL_ENTRY_ALL_59_TRADES_20261023.csv").open("w",encoding="utf-8",newline="") as f:
  w=csv.DictWriter(f,fieldnames=list(detail[0]),lineterminator="\n")
  w.writeheader();w.writerows(detail)
 print("SCREEN_FINISHED",len(detail),"ORIGINAL_ACCEPTED_ONLY_FROM_AMZN_PLUS1",flush=True)
if __name__=="__main__":main()
