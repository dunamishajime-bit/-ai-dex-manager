#!/usr/bin/env python3
"""AMZN-specific *entry* veto: causal Yahoo reference momentum, native V52 stock tape.

Keep user-adopted HYPE, Idle TAO/RENDER, FET long 8/4, V12, Q102, PENGU
and non-AMZN V52 untouched. Evaluate 2025-08-10..2026-08-10 with
10bps and 30bps native 8-strategy wallet allocation.

Causality: entry at xx:30; Yahoo 60m record start_ms+3600000 <= entry time
only. Previous New York stock session close is the last Yahoo bar dated
before the entry's NY trading date, and must already be available.
LONG optional: last completed Yahoo H1 return <= -1.0% veto.
SHORT optional: last completed Yahoo stock reference advanced >+0/0.5/1%
from last PREVIOUS NY session reference close veto.

Native stock 99-row tape 88 closes + 11 *existing* pre-entry rejects is
SHA-pinned. Model a veto by converting ONLY selected AMZN closed-trade row
to a skipped-candidate row at exact entry time. The frozen 11 previous
suppressed V52 stock signals are NOT regenerated, so this is a partial
causal admission replay: full wallet/crypto reallocation but suppressed
stock admission cannot be fully reoptimized.
"""
from __future__ import annotations
import argparse,bisect,collections,datetime,hashlib,importlib.util,json,math
from pathlib import Path
from zoneinfo import ZoneInfo

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
REF=ROOT/"v52_hourly_reference_recovery/yahoo-AMZN-h1.jsonl"
SOURCE_MANIFEST=REPO/"docs/research/results/v52-after-fet-20261022/V52_YAHOO_ASTER_H1_SOURCE_PROVENANCE_20261022.json"
FROZEN=ROOT/"f8v52native/V52_NATIVE_TAPE_FULL8_20261022.json"
OUTPUT_TAG="RESEARCH_ONLY_AMZN_ENTRY_YAHOO_REFERENCE_CLOSED_H1_V52_SOURCE_FIXED"
NY=ZoneInfo("America/New_York")
HOUR=3600000

SPECS={
 "AMZN_SHORT_PRIOR_CLOSE_PLUS0P0":(0.,None),
 "AMZN_SHORT_PRIOR_CLOSE_PLUS0P5":(.5,None),
 "AMZN_SHORT_PRIOR_CLOSE_PLUS1P0":(1.,None),
 "AMZN_LONG_H1_MINUS1P0":(None,-1.),
 "AMZN_SHORT0P5_PLUS_LONG_H1_MINUS1P0":(.5,-1.),
}

spec=importlib.util.spec_from_file_location("v52_20261022_native_true_stock_fixed",HERE/"run-v52-correct-stock-tape-full8-after-fet-20261022.py")
assert spec and spec.loader
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)


def sha(p):
 h=hashlib.sha256()
 with Path(p).open("rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()


def get_amzn_reference():
 provenance=json.loads(SOURCE_MANIFEST.read_text("utf-8"))
 src=json.loads(REF.read_text("utf-8")) if REF.suffix==".json" else native.m.jsonl(REF)
 assert len(src)>1000
 # Provenance checks in the earlier confirmed public Yahoo/Aster source manifests.
 assert sha(REF)==provenance["yahooH1"]["AMZN"]["normalizedSha256"], "AMZN_YAHOO_NORMALIZED_SOURCE_SHA_DIVERGENCE"
 assert len(src)==int(provenance["yahooH1"]["AMZN"]["count"]), "AMZN_YAHOO_SOURCE_COUNT_DIVERGENCE"
 for prev,nxt in zip(src,src[1:]):
  assert int(prev["start_ms"])<int(nxt["start_ms"])
 complete=[int(x["start_ms"])+HOUR for x in src]
 assert len(set(complete))==len(complete)
 return src,complete


def index_at(rows,complete,at):
 k=bisect.bisect_right(complete,int(at))-1
 if k<0:raise ValueError("NO_COMPLETED_YAHOO_REFERENCE_AT_ENTRY")
 # Although final NY market 15:30 bar is 30min, hour conservative delay is always causal.
 return k


def feature(rows,complete,at):
 at=int(at)
 k=index_at(rows,complete,at)
 time_last=int(rows[k]["start_ms"])
 d=datetime.datetime.fromtimestamp(at/1000,NY).date()
 prevday=[z for z in range(k+1) if datetime.datetime.fromtimestamp(
     int(rows[z]["start_ms"])/1000,NY).date()<d]
 if not prevday:raise RuntimeError("NO_PREVIOUS_COMPLETED_YAHOO_SESSION")
 prev=prevday[-1]
 current=float(rows[k]["close"])
 before=float(rows[prev]["close"])
 if not (current>0 and before>0):raise RuntimeError("BAD_YAHOO_MARK")
 sess=100*(current/before-1)
 k1=index_at(rows,complete,at-HOUR)
 prevh=float(rows[k1]["close"])
 assert prevh>0
 h1=100*(current/prevh-1)
 assert complete[k]<=at and complete[k1]<=at-HOUR
 assert time_last+HOUR<=at
 return {
   "yahooLastCompletedBarStartedUtc":datetime.datetime.fromtimestamp(time_last/1000,datetime.timezone.utc).isoformat(),
   "yahooLastCompletedBarClose":current,
   "previousNySessionLastClose":before,
   "previousNySessionLastCloseBarStartedUtc":datetime.datetime.fromtimestamp(
      int(rows[prev]["start_ms"])/1000,datetime.timezone.utc).isoformat(),
   "returnSincePreviousNySessionClosePct":sess,
   "lastCompletedYahooH1ReturnPct":h1,
   "entryNyDay":str(d),
 }


def veto(row,params,ref,complete):
 assert row["symbol"]=="AMZNUSDT" and row["status"]=="MODELED_CLOSED_TRADE"
 sh,lg=params
 f=feature(ref,complete,row["entry_ts_ms"])
 side=row["side"]
 if side=="SHORT":blocked=sh is not None and f["returnSincePreviousNySessionClosePct"]>sh
 elif side=="LONG":blocked=lg is not None and f["lastCompletedYahooH1ReturnPct"]<=lg
 else:raise RuntimeError("INVALID_V52_SIDE")
 return blocked,f


def build(name,refs):
 assert name in SPECS
 rows_ref,complete=refs
 params=SPECS[name]
 origin=native.STOCK_ARCHIVE/"v52-model-ledger.jsonl"
 origin_prov=json.loads((native.STOCK_ARCHIVE/"restore-provenance.json").read_text("utf-8"))
 assert sha(origin)==origin_prov["reconstructed_v52_ledger_sha256"]
 rows=native.m.jsonl(origin)
 assert len(rows)==99 and sum(x.get("status")=="MODELED_CLOSED_TRADE" for x in rows)==88
 new=[];changes=[];features=[]
 for i,x in enumerate(rows):
  y=dict(x)
  if x.get("status")=="MODELED_CLOSED_TRADE" and x["symbol"]=="AMZNUSDT":
   match,f=veto(x,params,rows_ref,complete)
   features.append({"entryTsMs":x["entry_ts_ms"],"side":x["side"],
                   "entryBasisBps":x["entry_basis_bps"],
                   "rejectedByCandidate":match,**f})
   if match:
    y={
      "status":"SKIPPED_CANDIDATE",
      "decision_ts_ms":int(x["entry_ts_ms"]),
      "reason":"RESEARCH_AMZN_YAHOO_CAUSAL_ENTRY_VETO",
      "session":x.get("session"),
      "symbol":x["symbol"],
     }
    changes.append({
     "originalTapeRowIndex":i,"symbol":x["symbol"],"side":x["side"],
     "originalEntryTsMs":x["entry_ts_ms"],"originalExitTsMs":x["exit_ts_ms"],
     "entryBasisBps":x["entry_basis_bps"],
     "originalPriceReturnPct":100*float(x["gross_price_return"]),**f})
  else:assert x==y
  new.append(y)
 assert changes and len(new)==99
 assert len(features)==17
 assert sum(x.get("status")!="MODELED_CLOSED_TRADE" for x in rows)==11
 assert sum(x.get("status")=="SKIPPED_CANDIDATE" for x in new)==11+len(changes)
 for x,y in zip(rows,new):
  if x.get("status")!="MODELED_CLOSED_TRADE":
   assert x==y
  if x.get("symbol")!="AMZNUSDT":assert x==y
  if x.get("status")=="MODELED_CLOSED_TRADE" and x.get("symbol")=="AMZNUSDT" and x["side"]=="LONG" and params[1] is None:assert x==y
 dest=ROOT/"v52_amzn_entry_studies_20261022"/name
 dest.mkdir(parents=True,exist_ok=True)
 target=dest/"v52-model-ledger.jsonl"
 target.write_text("".join(json.dumps(x,sort_keys=True,separators=(",",":"))+"\n" for x in new),encoding="utf-8",newline="\n")
 meta=json.loads((native.STOCK_ARCHIVE/"v52-model-summary.json").read_text("utf-8"))
 meta["model"]="V52_AMZN_YAHOO_PRE_ENTRY_RESEARCH_GATE"
 meta["status"]="RESEARCH_NOT_LIVE_MODELLED_HISTORICAL_ENTRY_VETO"
 meta["limitations"]=[*meta.get("limitations",[]),
    "Historical V52 11 suppressed preentry candidates frozen: cannot reselect when original AMZN slots freed",
    "Yahoo H1 last completed price may be nonexecutable and delayed; native signed-vs-reference parity not certified",
    "Past 17 AMZN accepted sample only: train/test sample too small to prove forward profit"]
 (dest/"v52-model-summary.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 state={
   "researchCase":name,"params":{"shortPriorSessionPositiveVetoPct":params[0],
                                "longCompletedYahooH1LossVetoPct":params[1]},
   "sourceOriginal99Sha256":sha(origin),"caseTape99Sha256":sha(target),
   "originalV52Closed":88,"originalSuppressedUnchanged":11,
   "amznOriginalClosed":17,"amznVetoCount":len(changes),
   "amznVetoShort":sum(x["side"]=="SHORT" for x in changes),
   "amznVetoLong":sum(x["side"]=="LONG" for x in changes),
   "rejectedAmznRecords":changes,"amznAllOriginalEntryFeatures":features,
   "sourceCausalRule":"Yahoo close bar starting at t, only if t+1h <= signal entry; previous NY session determined before entry",
   "basisStopMultiple":1.75,"basisConvergenceBps":20,
   "originalSuppressed11Regenerated":False,
   "status":OUTPUT_TAG}
 (dest/"scenario-manifest.json").write_text(json.dumps(state,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("AMZN_GATE_TAPE",name,"CHANGED",len(changes),"SHORT",state["amznVetoShort"],"LONG",state["amznVetoLong"],flush=True)
 return state


def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--cases",nargs="+",default=list(SPECS))
 parser.add_argument("--output",type=Path,required=True)
 args=parser.parse_args()
 assert len(set(args.cases))==len(args.cases)
 assert set(args.cases)<=set(SPECS)
 assert REPO not in (args.output.resolve(),*args.output.resolve().parents)
 refs=get_amzn_reference()
 native.m.acquire_verified_h1()
 for name in args.cases:build(name,refs)
 args.output.mkdir(parents=True,exist_ok=True)
 eng=native.m.m.core
 eng.OUTPUT=args.output
 eng.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 eng._transform_rows=native.m.m.entry_filter
 eng._apply_initial_stop=native.m.p.apply
 eng._matches=native.m.m.idle.matches
 source,helper=eng.task8.legacy.bootstrap()
 native.m.m.base.install_legacy_capture(helper)
 eng.Path.write_text=eng._path_write_text
 eng.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 baseline=json.loads(FROZEN.read_text("utf-8"))["cases"]["V52_AFTER_FET84_NO_CHANGE"]["costs"]
 out={
   "schema":"v52-amzn-specific-causal-yahoo-entry-veto-full8-after-fet-20261022-v1",
   "status":OUTPUT_TAG,"costBps":[10,30],"cases":{},
   "period":"2025-08-10..2026-08-10",
   "baselineFETHYPEIDLE":"PENGU_V12_Q102_OTHER_V52_UNTOUCHED",
   "modeledTradeTape":"V52 original 88 closed + original 11 suppressed; blocked AMZN converted to skipped at entry",
   "recreatedPreviouslySuppressedV52Candidates":False,
   "productionReleaseOrLiveChanged":False}
 for name in args.cases:
  tape=ROOT/"v52_amzn_entry_studies_20261022"/name
  scenario=json.loads((tape/"scenario-manifest.json").read_text("utf-8"))
  for cost in (10,30):
   r,history=native.replay(name,cost,source,helper,previous,tape)
   assert r["accounting"]=="PASS"
   trades=native.m.jsonl(r["ledger"])
   stock=[x for x in trades if x["strategy_id"]=="V52"]
   am=[x for x in stock if x["symbol"]=="AMZNUSDT"]
   other=[x for x in stock if x["symbol"]!="AMZNUSDT"]
   original=baseline[str(cost)]
   assert len(am)==17-scenario["amznVetoCount"],("AMZN_COUNT_GATE_NOT_REALIZED",name,cost,len(am),scenario)
   assert len(stock)==87-scenario["amznVetoCount"],("V52_MODEL_STOCK_COUNT_GATE_WRONG",name,cost)
   assert len(other)==70,("UNTOUCHED_V52_SYMBOL_ADMISSION_CHANGED",name,cost,len(other))
   ratio={"original":17,"new":len(am),"wins":sum(x["total_pnl_jpy"]>0 for x in am),"losses":sum(x["total_pnl_jpy"]<0 for x in am),
      "longN":sum(x["side"]=="LONG" for x in am),
      "shortN":sum(x["side"]=="SHORT" for x in am),
      "netContributionJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in am),
      "negativeContributionJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in am if x["total_pnl_jpy"]<0)}
   value={
      "equityJpy":r["final_equity_jpy"],
      "deltaEquityJpy":r["final_equity_jpy"]-original["equityJpy"],
      "maxMtmDdPct":r["maximum_mtm_drawdown_pct"],
      "deltaMtmDdPctPoints":r["maximum_mtm_drawdown_pct"]-original["maxMtmDdPct"],
      "profitFactor":r["profit_factor"],
      "closedTrades":r["closed_trades"],
      "deltaTotalTrades":r["closed_trades"]-original["closedTrades"],
      "v52Trades":len(stock),"amzn":ratio,
      "reselectionPasses":len(history),
      "ledgerSha256":sha(r["ledger"]),"accounting":r["accounting"]}
   out["cases"].setdefault(name,{"tape":scenario,"costs":{}})["costs"][str(cost)]=value
   (args.output/"V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
   print("AMZN_ENTRY_FULL8",name,cost,"equity",round(value["equityJpy"]),
       "delta",round(value["deltaEquityJpy"]),"dd",round(value["maxMtmDdPct"],5),
       "ddChangePp",round(value["deltaMtmDdPctPoints"],5),
       "totalTrades",value["closedTrades"],"v52",len(stock),"amzn",ratio["new"],
       "AMZN_WR",round(100*ratio["wins"]/ratio["new"],1),
       "AMZN_netJPY",round(ratio["netContributionJpy"]),flush=True)
 print("V52_AMZN_ENTRY_8LOGIC_COMPARISONS_COMPLETE",len(out["cases"]),flush=True)

if __name__=="__main__":main()
