#!/usr/bin/env python3
"""Causal AVAX entry-condition panel from the DOGE-veto+6h/trail full8 ledger."""
from __future__ import annotations
import argparse,bisect,collections,datetime,hashlib,importlib.util,json,math,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
RESULT=ROOT/"rv23combo/RESIDUAL_AVAX_EXIT_NO_DOGE_NATIVE_FULL8_20261023.json"
def load(name,path):
 sp=importlib.util.spec_from_file_location(name,path);obj=importlib.util.module_from_spec(sp);sp.loader.exec_module(obj);return obj
native=load("avax_negative_study_prior",HERE/"research-residual-avax-exit-native-full8-after-no-doge-20261023.py")
state=load("avax_negative_study_causal_features",HERE/"research-residual-stateful-entry-exit-20261023.py")
M5=300000;H=3600000
def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for block in iter(lambda:f.read(1<<20),b""):h.update(block)
 return h.hexdigest()
def r9(x):return None if x is None else round(float(x),5)
def base_features(source,sym,t0):
 bars,times=source.getdata(sym)
 j=bisect.bisect_left(times,t0)
 if j<320 or j>=len(bars) or times[j]!=t0 or times[j-1]+M5!=t0:
  return None
 # All of these bars have fully closed at or before entry timestamp.
 last=float(bars[j-1][4])
 out={}
 for n in (1,3,6,12,24,48):
  k=j-1-n*12
  out[f"ret{n}h"]=100*(last/float(bars[k][4])-1)
 for n in (1,3,6):
  b=bars[j-n*12:j]
  if not b:return None
  out[f"range{n}h"]=100*(max(float(x[2]) for x in b)-min(float(x[3]) for x in b))/last
  out[f"pos{n}h"]=100*(last-min(float(x[3]) for x in b))/max(1e-12,(max(float(x[2]) for x in b)-min(float(x[3]) for x in b)))
  out[f"distHigh{n}h"]=100*(last/max(float(x[2]) for x in b)-1)
  out[f"distLow{n}h"]=100*(last/min(float(x[3]) for x in b)-1)
 # Relative 1h volume vs preceding 12 hours for completed bar only.
 sums=[sum(float(x[5]) for x in bars[k-12:k]) for k in range(j-12*12,j,12)]
 latest=sum(float(x[5]) for x in bars[j-12:j])
 med=statistics.median(sums) if sums else 0
 out["vol1hRel12h"]=latest/med if med>0 else 0
 closes=[float(x[4]) for x in bars[j-72:j]]
 em8=sum(closes[-8:])/8
 em36=sum(closes[-36:])/36
 out["ma8Minus36Pct"]=100*(em8/em36-1)
 out["closeVsMa36Pct"]=100*(last/em36-1)
 out["lastClose"]=last
 return out
def main():
 parser=argparse.ArgumentParser();parser.add_argument("--output",type=Path,required=True);a=parser.parse_args()
 assert REPO not in (a.output.resolve(),*a.output.resolve().parents)
 d=json.loads(RESULT.read_text("utf8"))
 native.native.m.acquire_verified_h1()
 source,_=native.native.m.m.core.task8.legacy.bootstrap()
 panel={}
 for cost in ("10","30"):
  identity=d["cases"]["COMBO_TIME6_TRAIL3_GIVE1P5"]["costs"][cost]
  paths=[p for p in (ROOT/"rv23combo/engine").rglob("portfolio-trades.jsonl") if sha(p)==identity["ledgerSha256"]]
  assert paths,("MISSING_LEDGER",cost)
  rows=native.native.m.jsonl(paths[0])
  trade=[r for r in rows if r["strategy_id"]=="RESIDUAL" and r["symbol"]=="AVAXUSDT"]
  assert len(trade)==24
  p=[]
  for r in trade:
   t=int(r["entry_ts_ms"])
   x=base_features(source,"AVAXUSDT",t)
   b=base_features(source,"BTCUSDT",t)
   assert x is not None and b is not None,("M5_COVERAGE",t)
   features={f"avax{k}":r9(v) for k,v in x.items()}
   features.update({f"btc{k}":r9(v) for k,v in b.items() if k not in ("lastClose",)})
   features.update({f"rel{n}h":r9(x[f"ret{n}h"]-b[f"ret{n}h"]) for n in (1,3,6,12,24,48)})
   p.append({"candidateId":r["candidate_id"],"entryTsMs":t,"entryUtc":datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat(),
       "pnlModeledJpy":r["modeled_realized_pnl_jpy_at_exit_fx"],"pnlEngineJpy":r["total_pnl_jpy"],"win":r["total_pnl_jpy"]>0,
       "holdingH":(r["exit_ts_ms"]-t)/H,"exitReason":r["exit_reason_actual"],
       "priceEntry":r["entry_price"],"priceExit":r["exit_price"],"features":features})
  p.sort(key=lambda x:x["entryTsMs"])
  for i,r in enumerate(p):
   r["previousEntryGapH"]=(r["entryTsMs"]-p[i-1]["entryTsMs"])/H if i else None
   r["previousTradeWin"]=p[i-1]["win"] if i else None
   r["previousTradeExitTsMs"]= next((z["exit_ts_ms"] for z in trade if z["candidate_id"]==p[i-1]["candidateId"]),None) if i else None
   r["priorTradeKnownAtEntry"]=bool(i and r["previousTradeExitTsMs"]<=r["entryTsMs"])
  panel[cost]=p
 assert [r["candidateId"] for r in panel["10"]]==[r["candidateId"] for r in panel["30"]]
 out={"status":"RESEARCH_ONLY_AVAX_COMPOSITE_ENTRY_CAUSAL_PANEL_NOT_LIVE",
      "sourceSha":d["cases"]["COMBO_TIME6_TRAIL3_GIVE1P5"]["costs"]["10"]["ledgerSha256"],
      "costs":{"10":panel["10"],"30":panel["30"]},
      "sourceConvention":"last fully closed M5 at entry timestamp-5min, NO post-entry bars",
      "limitations":["24 accepted AVAX signals only; historical 8-way selection biased",
        "Cannot infer unseen vetoed AVAX candidates or LIVE fills from accepted stream",
        "Researchers have studied this year repeatedly; any feature threshold chosen on these 24 entries is in-sample",
        "Cost and exit are original dynamic 8-way wallet and native 6h+trail backtest"]}
 a.output.parent.mkdir(parents=True,exist_ok=True)
 a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8",newline="\n")
 for cost in ("10","30"):
  print("PANEL",cost,"N",len(panel[cost]),"W",sum(v["win"] for v in panel[cost]))
 print("LOSS_FEATURES_10")
 for r in panel["10"]:
  f=r["features"]
  print(r["candidateId"],r["entryUtc"][:16],"WIN" if r["win"] else "LOSS",
    "AVAX6",f["avaxret6h"],"BTC6",f["btcret6h"],"REL6",f["rel6h"],
    "AVAX3",f["avaxret3h"],"BTC3",f["btcret3h"],"AVAX1",f["avaxret1h"],
    "AVAX24",f["avaxret24h"],"ATR3",f["avaxrange3h"],"VOL",f["avaxvol1hRel12h"],
    "MA36",f["avaxcloseVsMa36Pct"],"PREVGAP",r["previousEntryGapH"],flush=True)
 print("PANEL_DONE",a.output)
if __name__=="__main__":main()
