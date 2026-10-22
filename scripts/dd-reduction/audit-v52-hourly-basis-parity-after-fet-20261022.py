#!/usr/bin/env python3
"""Independent hourly checkpoint V52 source-parity audit.

Compare archived 2025-08..2026-08 Aster official H1 OHLC closes with Yahoo
historical 1h *completed* closes, against user-adopted full8 FET8/4 V52 fills
and stored Yahoo-entry-reference + entryBasis. No counterfactual V52 profit is
reported until check-level baseline exit-reason and quote parity are proven.
"""
from __future__ import annotations
import argparse,bisect,collections,datetime,hashlib,importlib.util,json,math,statistics
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
PREV=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/Previous_Projects/bt-analysis-formal/formal_extract/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests")
REF=ROOT/"v52_hourly_reference_recovery"
HOUR=3600000
SYMS=("TSLA","NVDA","META","MSFT","AMZN")

def readjson(p):return json.loads(Path(p).read_text(encoding="utf-8"))
def jsonl(p):
 with Path(p).open(encoding="utf-8") as f:return [json.loads(s) for s in f if s.strip()]
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def month(ms):return datetime.datetime.fromtimestamp(ms/1000,datetime.timezone.utc).strftime("%Y-%m")

def last_closed(series, timestamps,decision):
 i=bisect.bisect_right(timestamps,decision-HOUR)-1
 if i<0:return None
 row=series[i]
 if row["start"]+HOUR>decision:raise AssertionError("UNCLOSED_FUTURE_BAR")
 return row

def classify_basis(basis,entry_basis,convergence=20.,stop=1.75):
 if basis is None or entry_basis is None or not (math.isfinite(basis) and math.isfinite(entry_basis)) or entry_basis==0:return "UNKNOWN"
 if abs(basis)<=convergence or basis*entry_basis<=0:return "BASIS_CONVERGED"
 if abs(basis)>=stop*abs(entry_basis):return "BASIS_STOP"
 return "TIME_OR_SESSION_FLAT"

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--output",required=True,type=Path)
 args=p.parse_args()
 from importlib.util import spec_from_file_location,module_from_spec
 spec=spec_from_file_location("v52_legacy_evidence_model",HERE/"audit-v52-basis-evidence-after-fet-20261022.py")
 assert spec and spec.loader
 base=module_from_spec(spec);spec.loader.exec_module(base)
 ledger_manifest=readjson(ROOT/"f8fet/FET_NEXT_FULL8_RESEARCH_20261022.json")
 reference_provenance=readjson(REF/"yahoo-h1-provenance-manifest.json")
 aster_coverage=readjson(PREV/"aster-stock-hourly-coverage.json")
 aster={};yahoo={}
 for sym in SYMS:
  yahoo_file=REF/f"yahoo-{sym}-h1.jsonl"
  assert sha(yahoo_file)==reference_provenance[sym]["normalizedSha256"]
  y=jsonl(yahoo_file)
  yy=[{"start":int(x["start_ms"]),"close":float(x["close"])} for x in y]
  yahoo[sym]=(yy,[x["start"] for x in yy])
  token=sym+"USDT"
  aster_path=PREV/"normalized/aster_stock/klines"/f"{token}.jsonl"
  assert sha(aster_path)==aster_coverage["symbols"][sym]["normalized_sha256"]
  aa=[{"start":int(x["event_time_ms"]),"close":float(x["close"])} for x in jsonl(aster_path)]
  aster[sym]=(aa,[x["start"] for x in aa])
  assert len(aa)==8784 and len(yy)>1500
 accepted_path=REPO/"docs/research/results/v4-production-cert-20261009/bt-baseline/cases/V2_M150_D05_CORE_NATIVE/runs/PRICE_MODEL_10BPS/candidate-decisions.jsonl"
 accepted=[x for x in jsonl(accepted_path) if x.get("strategy_id")=="V52" and x.get("decision") in ("ACCEPTED_MODELED_ENTRY","REJECTED_PORTFOLIO") and isinstance(x.get("v52_yahoo_entry_reference_usd"),(int,float))]
 by_event=collections.defaultdict(list)
 for x in accepted:by_event[(int(x["entry_ts_ms"]),str(x["symbol"]),str(x["side"]))].append(x)
 results={"schema":"v52-formal-cumulative-hourly-source-checkpoint-parity-v1",
  "status":"NOT_CERTIFIED_BASIS_EXIT_CHECKPOINT_PARITY",
  "period":"2025-08-10..2026-08-10",
  "model":"FET84_PLUS_HYPE_AND_IDLE_ADOPTED",
  "references":{"yahoo":reference_provenance,"asterSourceSha256":{sym:aster_coverage["symbols"][sym]["normalized_sha256"] for sym in SYMS}},
  "alignment":"only fully completed 60m bars; as-of price can lag live midpoint by up to an hour; never read current bar",
  "cost":{}}
 for cost in ("10","30"):
  b=ledger_manifest["cases"]["FET_TRAIL_8P_GIVEBACK_4P"]["costs"][cost]
  rows=[x for x in base.jsonl(base.find_ledger(b["sourceLedgerSha256"])) if x["strategy_id"]=="V52"]
  assert len(rows)==87
  records=[];miss=0;entrybasis_errors=[];yahoo_errors=[];aster_errors=[]
  for r in rows:
   symbol=r["symbol"].removesuffix("USDT");ep=int(r["entry_ts_ms"]);et=int(r["exit_ts_ms"])
   options=by_event[(ep,r["symbol"],r["side"])]
   original=options[0] if len(options)==1 else None
   if original is None:
    miss+=1
    records.append({"candidateId":r["candidate_id"],"entry":ep,"cost":cost,"paired":False,"cause":"CANDIDATE_NOT_FOUND"})
    continue
   y0=last_closed(*yahoo[symbol],ep)
   a0=last_closed(*aster[symbol],ep)
   y1=last_closed(*yahoo[symbol],et)
   a1=last_closed(*aster[symbol],et)
   if any(x is None for x in (y0,a0,y1,a1)):
    miss+=1
    records.append({"candidateId":r["candidate_id"],"entry":ep,"cost":cost,"paired":False,"cause":"MISSING_COMPLETED_ASOF_H1"})
    continue
   y_ref=float(original["v52_yahoo_entry_reference_usd"])
   b0=float(original["v52_entry_basis_bps"])
   yp=float(y0["close"]);ap=float(a0["close"])
   proxy_entry_bps=10000*(ap/yp-1)
   entrybasis_errors.append(abs(proxy_entry_bps-b0))
   yahoo_errors.append(abs(10000*(yp/y_ref-1)))
   aster_errors.append(abs(10000*(ap/float(r["entry_price"])-1)))
   dynamic_bps=10000*(float(a1["close"])/float(y1["close"])-1)
   guessed=classify_basis(dynamic_bps,b0)
   actual=str(r["exit_reason_actual"])
   records.append({
     "candidateId":r["candidate_id"],"positionId":r["position_id"],"symbol":r["symbol"],
     "side":r["side"],"entry":ep,"exit":et,"entryMonth":month(ep),
     "basisAtEntryBps":b0,"proxyCompletedEntryBasisBps":proxy_entry_bps,
     "yahooEntryReferenceOriginal":y_ref,"yahooEntryCompletedH1":yp,
     "asterEntryOriginal":float(r["entry_price"]),"asterEntryCompletedH1":ap,
     "yahooExitCompletedH1":float(y1["close"]),"asterExitCompletedH1":float(a1["close"]),
     "basisAtExitProxyBps":dynamic_bps,
     "originalExitReason":actual,"proxyExitReason":guessed,
     "matchesReason":actual==guessed,
     "exitPnlJpy":float(r["modeled_realized_pnl_jpy_at_exit_fx"]),
     "paired":True
   })
  paired=[r for r in records if r["paired"]]
  matches=sum(r["matchesReason"] for r in paired)
  stats={
   "modelTrades":len(rows),"paired":len(paired),"unpaired":miss,
   "reasonMatches":matches,"reasonMismatch":len(paired)-matches,
   "reasonMatchPct":100*matches/len(paired) if paired else None,
   "entryYahooReferenceMedianAbsBps":statistics.median(yahoo_errors) if yahoo_errors else None,
   "entryAsterPriceMedianAbsBps":statistics.median(aster_errors) if aster_errors else None,
   "entryBasisMedianAbsErrorBps":statistics.median(entrybasis_errors) if entrybasis_errors else None,
   "entryYahooReference95thAbsBps":sorted(yahoo_errors)[int((len(yahoo_errors)-1)*0.95)] if yahoo_errors else None,
   "entryBasisMaxAbsErrorBps":max(entrybasis_errors) if entrybasis_errors else None,
   "reasonBySide":{},
   "records":records
  }
  for side in ("LONG","SHORT"):
   rr=[r for r in paired if r["side"]==side]
   stats["reasonBySide"][side]={"paired":len(rr),"correct":sum(r["matchesReason"] for r in rr),"mismatches":[r["candidateId"] for r in rr if not r["matchesReason"]][:25]}
  results["cost"][cost]=stats
  print("PARITY",cost,{k:v for k,v in stats.items() if k not in ("records","reasonBySide")},"SIDE",stats["reasonBySide"],flush=True)
 (args.output).mkdir(parents=True,exist_ok=True)
 (args.output/"V52_HOURLY_PARITY_20261022.json").write_text(json.dumps(results,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("V52_PARITY_OUTPUT",args.output,flush=True)
if __name__=="__main__":main()
