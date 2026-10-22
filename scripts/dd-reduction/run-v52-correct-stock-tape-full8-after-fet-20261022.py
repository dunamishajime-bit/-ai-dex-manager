#!/usr/bin/env python3
"""CAUSAL V52 STOCK TAPE overlay: integrated 8-logic research, NOT LIVE.

V52 is sourced through model v52_ledger_root, NOT crypto candidate filter.
Copy immutable SHA-pinned 99 original V52 tape rows into scenario-specific
research directories. Transform 88 historically closed signals only using
actual completed Aster+Yahoo H1 checkpoint conditions; do not invent excluded
11 already suppressed same-session candidates.

Intercept solely the one model script's in-memory read of the frozen stock
tape path (no source file modifications, credentials, venue or VPS actions).
The integrated allocator then recomputes wallet, capacity and reallocation.
Important limitation: original V52 selected candidate tape stays fixed;
suppressed 11 cannot re-enter without regenerating the V52 native signal.
"""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json,os,shutil
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
STOCK_ARCHIVE=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/Previous_Projects/bt-analysis-formal/formal_extract/bt-v12-score100-volume080-normalonly-20260928/v52-SHA-verified-original-ledger")
sp=importlib.util.spec_from_file_location("stock_hourly_policy",HERE/"run-v52-hourly-exits-after-fet-20261022.py")
assert sp and sp.loader
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)

STOCK_LOOKUP_LITERAL='v52_ledger_root=baseline/"v52-SHA-verified-original-ledger"'
BASE="V52_AFTER_FET84_NO_CHANGE"
CASES=m.CASES
ACTIVE_TAPE_ROOT=None
ORIGINAL_READ_TEXT=Path.read_text

def hashfile(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for part in iter(lambda:f.read(1024*1024),b""):h.update(part)
 return h.hexdigest()

def research_stock_root_path_read(self,*args,**kwargs):
 payload=ORIGINAL_READ_TEXT(self,*args,**kwargs)
 if self.name=="run-current-vps-no-dca.py":
  if ACTIVE_TAPE_ROOT is None:raise RuntimeError("V52_RESEARCH_TAPE_ROOT_NOT_INITIALIZED")
  if payload.count(STOCK_LOOKUP_LITERAL)!=1:
   raise RuntimeError("V52_RESEARCH_STOCK_TAPE_PATH_HOOK_SOURCE_NO_MATCH")
  assert Path(ACTIVE_TAPE_ROOT).is_dir()
  return payload.replace(STOCK_LOOKUP_LITERAL,
    "v52_ledger_root=pathlib.Path("+repr(str(ACTIVE_TAPE_ROOT))+")",1)
 return payload

def build_stock_tape(name):
 original=STOCK_ARCHIVE/"v52-model-ledger.jsonl"
 summary=STOCK_ARCHIVE/"v52-model-summary.json"
 origin=STOCK_ARCHIVE/"restore-provenance.json"
 assert original.is_file() and summary.is_file() and origin.is_file()
 prov=json.loads(origin.read_text("utf-8"))
 assert hashfile(original)==prov["reconstructed_v52_ledger_sha256"], "ARCHIVED_STOCK_TAPE_SHA_DIVERGENCE"
 original_rows=m.jsonl(original)
 assert len(original_rows)==99
 assert collections.Counter(x["status"] for x in original_rows)=={"MODELED_CLOSED_TRADE":88,"SKIPPED_PREENTRY":11} or sum(x["status"]=="MODELED_CLOSED_TRADE" for x in original_rows)==88
 assert collections.Counter(x["status"] for x in original_rows)["MODELED_CLOSED_TRADE"]==88
 rule=CASES[name]
 modified=[]
 newrows=[]
 obs={"triggered":0,"by_reason":collections.Counter()}
 m.STATS.clear()
 for row in original_rows:
  new=dict(row)
  if rule is not None and row["status"]=="MODELED_CLOSED_TRADE":
   proxy={
    "candidate_id":"STOCK_TAPE_"+str(row["entry_ts_ms"])+"_"+str(row["symbol"]),
    "strategy_id":"V52","symbol":row["symbol"],"side":row["side"],
    "entry_ts_ms":row["entry_ts_ms"],"exit_ts_ms":row["exit_ts_ms"],
    "entry_price":row["aster_entry_price_usd"],"exit_price":row["aster_exit_price_usd"],
    "exit_reason_actual":row["reason"],
   }
   outcome=m.apply(proxy,rule,None,10,obs)
   if outcome["exit_ts_ms"]<proxy["exit_ts_ms"]:
    entry=float(row["aster_entry_price_usd"])
    stop=float(outcome["exit_price"])
    sign=1 if row["side"]=="LONG" else -1
    assert stop>0 and entry>0
    assert row["entry_ts_ms"]<outcome["exit_ts_ms"]<row["exit_ts_ms"]
    new["exit_ts_ms"]=int(outcome["exit_ts_ms"])
    new["aster_exit_price_usd"]=stop
    new["gross_price_return"]=sign*(stop/entry-1)
    new["reason"]=outcome["exit_reason"]
    modified.append({
      "entryTsMs":row["entry_ts_ms"],"symbol":row["symbol"],"side":row["side"],
      "oldExitTsMs":row["exit_ts_ms"],"newExitTsMs":new["exit_ts_ms"],
      "oldExitPrice":row["aster_exit_price_usd"],"newExitPrice":stop,
      "oldReason":row["reason"],"newReason":new["reason"]})
  newrows.append(new)
 root=ROOT/"v52_stock_tape_studies_20261022"/name
 root.mkdir(parents=True,exist_ok=True)
 text="".join(json.dumps(row,sort_keys=True,separators=(",",":"))+"\n" for row in newrows)
 (root/"v52-model-ledger.jsonl").write_text(text,encoding="utf-8",newline="\n")
 summ=json.loads(summary.read_text("utf-8"))
 summ["model"]="V52_20261022_COUNTERFACTUAL_HOURLY_RESEARCH_TAPE"
 summ["status"]="RESEARCH_PRICE_MODEL_CLOSED_SAMPLE"
 summ["exit_reasons"]=dict(collections.Counter(row["reason"] for row in newrows if row["status"]=="MODELED_CLOSED_TRADE"))
 summ["limitations"]=[
  *summ.get("limitations",[]),
  "Scenario-specific 2026-10-22 V52 counterfactual isolated tape; not a real venue fill",
  "Original 11 suppressed V52 candidates cannot be regenerated in this fixed 99-row native tape.",
  "Only fully closed original Yahoo 60m and archived Aster H1 bars; entry/exit parity anomalies fail closed."
 ]
 (root/"v52-model-summary.json").write_text(json.dumps(summ,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 out={
  "status":"RESEARCH_MODIFIED_STOCK_TAPE_NOT_LIVE",
  "case":name,
  "sourceArchiveOriginalSha256":hashfile(original),
  "normalizedScenarioSha256":hashfile(root/"v52-model-ledger.jsonl"),
  "originalRows":len(original_rows),
  "originalClosed":88,
  "suppressedPreentryUnmodified":11,
  "modifiedClosedRows":len(modified),
  "allChangedExitsWithinOriginalHolding":True,
  "events":modified,
  "excludedBpsOrReasonMismatch":dict(m.STATS),
  "note":"Subset sensitivity: stock native 11 suppressed entry candidates not regenerated."
 }
 (root/"scenario-modification-manifest.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("STOCK_TAPE",name,"CHANGED",len(modified),"ORIGINAL",out["sourceArchiveOriginalSha256"],"NEW",out["normalizedScenarioSha256"],"OBS",dict(m.STATS),flush=True)
 assert len(modified)>0 if name!=BASE else len(modified)==0,("NEW_EXIT_NEVER_APPLIED",name)
 return root,out

def replay(name,cost,source,helper,previous,tape):
 global ACTIVE_TAPE_ROOT
 ACTIVE_TAPE_ROOT=tape
 # Only on this research computer; original source file never edited.
 oldread=Path.read_text
 assert oldread is ORIGINAL_READ_TEXT
 Path.read_text=research_stock_root_path_read
 try:
  # Use FET 8/4 and all user-adopted HYPE+Idle+V12+Q102 without V52 inert crypto hook.
  p=m.p
  prev=None
  passes=[]
  for iteration in range(5):
   m.m.base.CURRENT.clear()
   if prev is not None:m.m.base.CURRENT["cooldown_events"]=prev
   m.m.entry.ACTIVE["policy"]=m.m.hype.GATE
   for k in ("lookups","passed","blocked","missing"):m.m.entry.ACTIVE[k].clear()
   for k in ("passed","blocked","missing"):m.m.ACTIVE[k].clear()
   m.m.ACTIVE["checked"]=0
   m.m.ACTIVE["policy"]=m.m.POLICIES[p.TRIPLE]
   overlay=[m.m.hype.V4,m.m.hype.Q102,m.m.idle.HYPE_RULE,m.m.EXIT_RULES[p.TRIPLE],p.RULES["FET_TRAIL_8P_GIVEBACK_4P"]]
   result=m.m.core._run_engine(
    "V52_NATIVE_STOCK_"+name+"_C"+str(cost)+"_I"+str(iteration),
    "V12_LONG_COMPOSITE",overlay,cost,source,helper,previous)
   assert result["accounting"]=="PASS"
   assert not m.m.ACTIVE["missing"] and not m.m.entry.ACTIVE["missing"],"OTHER_STRATEGY_M5_CAUSAL_WINDOW_UNAVAILABLE"
   events=m.m.base.actual_cooldown_events(result)
   passes.append({"iteration":iteration,"v12ShortCooldown":len(events)})
   if events==prev:return result,passes
   prev=events
  raise RuntimeError("V52_STOCK_NATIVE_RESELECTION_DID_NOT_CONVERGE")
 finally:
  Path.read_text=oldread
  ACTIVE_TAPE_ROOT=None

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--output",required=True,type=Path)
 parser.add_argument("--cases",nargs="+",default=list(CASES))
 args=parser.parse_args()
 assert len(set(args.cases))==len(args.cases) and set(args.cases)<=set(CASES)
 assert REPO not in (args.output.resolve(),*args.output.resolve().parents)
 m.acquire_verified_h1()
 for name in args.cases:build_stock_tape(name)
 args.output.mkdir(parents=True,exist_ok=True)
 m.m.core.OUTPUT=args.output
 m.m.core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 m.m.core._transform_rows=m.m.entry_filter
 m.m.core._apply_initial_stop=m.p.apply
 m.m.core._matches=m.m.idle.matches
 source,helper=m.m.core.task8.legacy.bootstrap()
 m.m.base.install_legacy_capture(helper)
 m.m.core.Path.write_text=m.m.core._path_write_text
 m.m.core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 previous_fet=json.loads((ROOT/"f8fet/FET_NEXT_FULL8_RESEARCH_20261022.json").read_text("utf-8"))["cases"]["FET_TRAIL_8P_GIVEBACK_4P"]["costs"]
 out={"status":"RESEARCH_ONLY_V52_NATIVE_STOCK_TAPE_FIXED_SUPPRESSED_11",
      "fixedPriorLogic":"HYPE LONG adopted / TAO and RENDER SHORT triple adopted / FET LONG 8pct arm 4pp giveback",
      "economicScope":"all8 dynamic wallet and cross-strategy gross, V52 originally suppressed 11 candidates NOT regenerated",
      "period":"2025-08-10..2026-08-10",
      "modeledVenueExecution":"H1 close/checkpoints, no L2 or pending orders",
      "cases":{}}
 for name in args.cases:
  tape=ROOT/"v52_stock_tape_studies_20261022"/name
  tape_manifest=json.loads((tape/"scenario-modification-manifest.json").read_text("utf-8"))
  costs={}
  for cost in (10,30):
   r,history=replay(name,cost,source,helper,previous,tape)
   portfolio=m.jsonl(r["ledger"])
   stock=[x for x in portfolio if x["strategy_id"]=="V52"]
   assert 80<=len(stock)<=90
   changed=[x for x in stock if str(x.get("exit_reason_actual") or x.get("exit_reason")).startswith("RESEARCH_H1_V52")]
   row={
    "equityJpy":r["final_equity_jpy"],
    "deltaVsFet84BaselineJpy":r["final_equity_jpy"]-previous_fet[str(cost)]["portfolioFinalEquityJpy"],
    "maxMtmDdPct":r["maximum_mtm_drawdown_pct"],
    "profitFactor":r["profit_factor"],
    "closedTrades":r["closed_trades"],
    "v52Trades":len(stock),
    "v52Wins":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"])>0 for x in stock),
    "v52Losses":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"])<=0 for x in stock),
    "v52ModeledPnlJpy":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in stock),
    "v52BySide":{side:{
      "trades":sum(x["side"]==side for x in stock),
      "wins":sum(x["side"]==side and float(x["modeled_realized_pnl_jpy_at_exit_fx"])>0 for x in stock),
      "pnlJpy":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in stock if x["side"]==side)
     } for side in ("LONG","SHORT")},
    "modifiedV52Exits":len(changed),
    "reselectionHistory":history,
    "stockSourceRootSha256":tape_manifest["normalizedScenarioSha256"],
    "fixedStockOriginallySuppressed11":True,
    "accounting":r["accounting"],
    "ledgerSha256":hashfile(r["ledger"]),
   }
   if name==BASE:
    assert len(stock)==87
    assert abs(row["equityJpy"]-previous_fet[str(cost)]["portfolioFinalEquityJpy"])<.2
    assert abs(row["maxMtmDdPct"]-previous_fet[str(cost)]["maxMtmDdPct"])<1e-7
    assert row["modifiedV52Exits"]==0
   elif cost==10 and tape_manifest["modifiedClosedRows"]>0:
    assert row["modifiedV52Exits"]>0, "STOCK_TAPE_NATIVE_ROUTE_STILL_INERT"
   costs[str(cost)]=row
   print("V52_NATIVE_REPLAY",name,cost,"EQUITY",round(row["equityJpy"]),
       "DIFF",round(row["deltaVsFet84BaselineJpy"]),"DD",round(row["maxMtmDdPct"],5),
       "V52_WIN",row["v52Wins"],"/",row["v52Trades"],
       "V52_NEW_EXIT",row["modifiedV52Exits"],flush=True)
  out["cases"][name]={"rule":CASES[name],"tapeManifest":tape_manifest,"costs":costs}
  (args.output/"V52_NATIVE_TAPE_FULL8_20261022.json").write_text(
    json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("V52_NATIVE_STOCK_CASE_STUDY_FINISHED",len(out["cases"]),flush=True)

if __name__=="__main__":main()
