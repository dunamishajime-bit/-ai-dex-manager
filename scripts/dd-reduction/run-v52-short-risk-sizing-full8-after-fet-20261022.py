#!/usr/bin/env python3
"""Research-only V52 SHORT risk-aware size via native 99-row stock tape.

Fixed 2025-08..2026-08 user-adopted cumulative 8-logic base HYPE/Idle/FET 8-4,
V12/Q102, PENGU untouched. V52 original convergence=20bps, basis stop1.75.
Never substitute token 5m for Yahoo; never change venue, Production, or VPS.

Experimental *pre-entry* gross trims preserve V52 entry+exit and 87 selected
V52 trades when verified. Entry basis is from frozen V52 source (causal at
entry). All 99 original stock rows remain; originally suppressed 11 do NOT
regenerate (explicit limitation).
"""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
SP=importlib.util.spec_from_file_location("native_stocks_after_fet_selected",
 HERE/"run-v52-correct-stock-tape-full8-after-fet-20261022.py")
assert SP and SP.loader
native=importlib.util.module_from_spec(SP);SP.loader.exec_module(native)
BASE="V52_AFTER_FET84_NO_CHANGE"
CASES={
 "V52_SHORT_BASIS_LT75_GROSS1P0":(75.,1.0),
 "V52_SHORT_BASIS_LT75_GROSS1P5":(75.,1.5),
 "V52_SHORT_BASIS_LT80_GROSS1P0":(80.,1.0),
 "V52_SHORT_BASIS_LT80_GROSS1P5":(80.,1.5),
}
OUTCOME="RESEARCH_ONLY_FIXED_NATIVE_STOCK_TAPE_V52_SIZE_SENSITIVITY"

def sha(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for part in iter(lambda:f.read(1024*1024),b""):h.update(part)
 return h.hexdigest()

def build(name):
 assert name in CASES
 threshold,target=CASES[name]
 original=native.STOCK_ARCHIVE/"v52-model-ledger.jsonl"
 meta=native.STOCK_ARCHIVE/"v52-model-summary.json"
 manifest=json.loads((native.STOCK_ARCHIVE/"restore-provenance.json").read_text("utf-8"))
 assert sha(original)==manifest["reconstructed_v52_ledger_sha256"]
 rows=native.m.jsonl(original)
 assert len(rows)==99 and sum(x.get("status")=="MODELED_CLOSED_TRADE" for x in rows)==88
 out=[];changes=[]
 for x in rows:
  y=dict(x)
  if x.get("status")=="MODELED_CLOSED_TRADE" and x["side"]=="SHORT":
   bps=float(x["entry_basis_bps"])
   if bps>0 and bps<threshold:
    old=float(x["slot_gross"])
    assert old>=target and old<=2.00001,(name,x)
    if old>target:
     y["slot_gross"]=target
     changes.append({"entryTsMs":x["entry_ts_ms"],"symbol":x["symbol"],
                     "side":x["side"],"entryBasisBps":bps,
                     "oldGross":old,"newGross":target})
  out.append(y)
 assert changes,("NO_STOCK_SIZE_CHANGES",name)
 assert len(out)==len(rows)
 for x,y in zip(rows,out):
  assert x.get("symbol")==y.get("symbol") and x.get("side")==y.get("side") and x["status"]==y["status"]
  assert x.get("entry_basis_bps")==y.get("entry_basis_bps")
  assert (x==y) if x["status"]!="MODELED_CLOSED_TRADE" else True
  if x!=y:assert set(k for k in x if x[k]!=y[k])=={"slot_gross"}
 dest=ROOT/"v52_stock_risk_sensitivity_20261022"/name
 dest.mkdir(parents=True,exist_ok=True)
 (dest/"v52-model-ledger.jsonl").write_text(
  "".join(json.dumps(x,separators=(",",":"),sort_keys=True)+"\n" for x in out),
  encoding="utf-8",newline="\n")
 summary=json.loads(meta.read_text("utf-8"))
 summary["model"]="V52_SHORT_BASIS_RISK_SIZE_RESEARCH_NATIVE_TAPE"
 summary["status"]="RESEARCH_PRICE_MODEL_CLOSED_SAMPLE"
 summary["limitations"]=[*summary.get("limitations",[]),
  "99 fixed original stock rows: suppressed 11 entries never regenerated.",
  "Only pre-entry original source Basis used; economic parity relies on source-frozen Python engine, not Production TypeScript.",
  "V52 sizing changed, not entry signal or native 1.75x Basis Stop."]
 (dest/"v52-model-summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 m={"case":name,"thresholdBps":threshold,"targetGross":target,"changes":changes,
    "changedNativeClosed":len(changes),"source99Sha256":manifest["reconstructed_v52_ledger_sha256"],
    "nativeTapeSha256":sha(dest/"v52-model-ledger.jsonl"),
    "status":OUTCOME,"suppressedPreentryUnmodified":11}
 (dest/"scenario-manifest.json").write_text(json.dumps(m,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("V52_RISK_TAPE",name,len(changes),"LOWERED_SHORT_RISK_SLOTS",flush=True)
 return dest,m

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--output",required=True,type=Path)
 parser.add_argument("--cases",nargs="+",default=list(CASES))
 args=parser.parse_args()
 assert args.cases and set(args.cases)<=set(CASES) and len(set(args.cases))==len(args.cases)
 assert REPO not in (args.output.resolve(),*args.output.resolve().parents)
 native.m.acquire_verified_h1()
 for name in args.cases:build(name)
 args.output.mkdir(parents=True,exist_ok=True)
 engine=native.m.m.core
 engine.OUTPUT=args.output
 engine.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 engine._transform_rows=native.m.m.entry_filter
 engine._apply_initial_stop=native.m.p.apply
 engine._matches=native.m.m.idle.matches
 src,helper=engine.task8.legacy.bootstrap()
 native.m.m.base.install_legacy_capture(helper)
 engine.Path.write_text=engine._path_write_text
 engine.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 original=json.loads((ROOT/"f8v52native/V52_NATIVE_TAPE_FULL8_20261022.json").read_text("utf-8"))
 baseline=original["cases"][BASE]["costs"]
 out={"status":OUTCOME,
    "preEntryBasisCausalFeatureOnly":True,"nativeBasisStopUnchanged":1.75,
    "userAdoptedOtherStrategiesFixed":True,
    "researchBaseline":"HYPE+TAO+RENDER+FET_LONG_8P_ARM_4PP",
    "important":"Native V52 selected 88-row tape remains fixed, suppressed 11 not regenerated; risk-sizing changes can alter portfolio ownership.",
    "costsBps":[10,30],"cases":{}}
 for name in args.cases:
  dest=ROOT/"v52_stock_risk_sensitivity_20261022"/name
  meta=json.loads((dest/"scenario-manifest.json").read_text("utf-8"))
  for cost in (10,30):
   r,history=native.replay(name,cost,src,helper,previous,dest)
   assert r["accounting"]=="PASS"
   trades=native.m.jsonl(r["ledger"])
   current=[x for x in trades if x["strategy_id"]=="V52"]
   assert current
   short=[x for x in current if x["side"]=="SHORT"]
   long=[x for x in current if x["side"]=="LONG"]
   b=baseline[str(cost)]
   value={
    "finalEquityJpy":r["final_equity_jpy"],
    "deltaVsCurrentJpy":r["final_equity_jpy"]-b["equityJpy"],
    "maxMtmDDPct":r["maximum_mtm_drawdown_pct"],
    "deltaDDPp":r["maximum_mtm_drawdown_pct"]-b["maxMtmDdPct"],
    "closedTrades":r["closed_trades"],
    "deltaTotalTrades":r["closed_trades"]-b["closedTrades"],
    "v52Trades":len(current),"v52LongTrades":len(long),"v52ShortTrades":len(short),
    "v52Wins":sum(x["total_pnl_jpy"]>0 for x in current),
    "v52Losses":sum(x["total_pnl_jpy"]<0 for x in current),
    "v52ContributionJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in current),
    "v52ShortContributionJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in short),
    "v52ShortNegativeJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in short if x["total_pnl_jpy"]<0),
    "changedGrossRows":sum(x["side"]=="SHORT" and x["accepted_gross"]<=meta["targetGross"]+1e-5 and x["accepted_gross"]>=meta["targetGross"]-.06 for x in current),
    "ledgerSha256":sha(r["ledger"]),"accounting":r["accounting"],
    "reselectionPasses":len(history),
   }
   assert value["v52Trades"]==b["v52Trades"],"V52_TRADE_COUNT_CHANGED"
   assert value["v52LongTrades"]==35 and value["v52ShortTrades"]==52
   out["cases"].setdefault(name,{"stockSource":meta,"costs":{}})["costs"][str(cost)]=value
   (args.output/"V52_SHORT_RISK_GROSS_FULL8_20261022.json").write_text(
    json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
   print("V52_SIZE_FULL8",name,"cost",cost,
     "equity",round(value["finalEquityJpy"]),"delta",round(value["deltaVsCurrentJpy"]),
     "dd",round(value["maxMtmDDPct"],4),"deltaDD",round(value["deltaDDPp"],4),
     "totalTrades",value["closedTrades"],"v52trades",value["v52Trades"],
     "shortPnl",round(value["v52ShortContributionJpy"]),flush=True)
 print("V52_SIZING_RESEARCH_FULL8_COMPLETE",len(out["cases"]),flush=True)
if __name__=="__main__":main()
