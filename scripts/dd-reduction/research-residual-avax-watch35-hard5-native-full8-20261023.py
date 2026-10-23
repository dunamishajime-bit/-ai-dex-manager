#!/usr/bin/env python3
"""Research-only AVAX initial-adverse-stop trials: keep DOGE veto, dual AVAX entry veto,
6h plus armed-3%/giveback-1.5% exit, and all other strategies unchanged.
No LIVE, venue, or production writes. Dynamic full8 wallet and cooldown re-selection.
"""
from __future__ import annotations
import argparse,bisect,collections,hashlib,importlib.util,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
DOC=REPO/"docs/research/results/residual-composite-20261023"
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 assert spec and spec.loader
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod
reference=load("avax_initial_after_dual_entry_reference",HERE/"research-residual-avax-composite-entry-veto-full8-20261023.py")
native=reference.native
screen=reference.original_screen
STOCK=reference.STOCK
REFERENCE=DOC/"RESIDUAL_AVAX_COMPOSITE_ENTRY_VETO_FULL8_20261023.json"
EXIT_COMBO="COMBO_TIME6_TRAIL3_GIVE1P5"
hedge=load("avax_risk35_hard5_policy",HERE/"research-residual-avax-risk35-hard5-policy-20261023.py")
CASES={
 "BASE_DUAL":{"watch":False,"hard":False},
 "WATCH35_2H_ONLY":{"watch":True,"hard":False},
 "HARD5_ONLY":{"watch":False,"hard":True},
 "WATCH35_2H_PLUS_HARD5":{"watch":True,"hard":True},
}

def sha(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
def main():
 pa=argparse.ArgumentParser()
 pa.add_argument("--output",required=True,type=Path)
 pa.add_argument("--cases",nargs="+",default=list(CASES))
 args=pa.parse_args()
 assert args.cases and len(set(args.cases))==len(args.cases) and set(args.cases)<=set(CASES)
 assert REPO not in (args.output.resolve(),*args.output.resolve().parents)
 meta=json.loads((STOCK/"scenario-manifest.json").read_text("utf8"))
 assert meta["caseTape99Sha256"]==sha(STOCK/"v52-model-ledger.jsonl")
 anchor=json.loads(REFERENCE.read_text("utf8"))["cases"]["VETO_DUAL"]["costs"]
 native.m.acquire_verified_h1()
 args.output.mkdir(parents=True,exist_ok=True)
 core=native.m.m.core
 core.OUTPUT=args.output
 core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 original_filter=native.m.m.entry_filter
 original_apply=native.m.p.apply
 original_run=core._run_engine
 original_writer=original_run.__globals__["_path_write_text"]
 def safe_research_writer(self,data,*pos,**kw):
  if args.output.name in self.parts:self.parent.mkdir(parents=True,exist_ok=True)
  return original_writer(self,data,*pos,**kw)
 original_run.__globals__["_ensure_research_output_parent_write_text"]=safe_research_writer
 fcache={};current="BASE_DUAL"
 def candidate_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
  transformed=original_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
  out=[]
  for row in transformed:
   if row.get("strategy_id")!="RESIDUAL":
    out.append(row);continue
   if row.get("symbol")=="DOGEUSDT":
    obs["no_doge_rejected"]=obs.get("no_doge_rejected",0)+1
    continue
   if row.get("symbol")!="AVAXUSDT" or row.get("side")!="LONG":
    out.append(row);continue
   ts=row.get("entry_ts_ms")
   assert ts is not None,("AVAX_MISSING_ENTRY_TS",row.get("candidate_id"))
   avax=reference.get_feature(source,"AVAXUSDT",ts,fcache)
   btc=reference.get_feature(source,"BTCUSDT",ts,fcache)
   assert avax is not None and btc is not None,("AVAX_MISSING_CAUSAL_M5",row.get("candidate_id"),ts)
   veto=reference.reason("DUAL",avax,btc)
   if veto:
    obs["avaxGateRemoved"]=obs.get("avaxGateRemoved",0)+1
    obs.setdefault("avaxGateEvidence",[]).append({"candidateId":row.get("candidate_id"),
      "entryTsMs":ts,"reason":veto,"AVAX1h":avax["ret1h"],"AVAX3h":avax["ret3h"],
      "AVAX6h":avax["ret6h"],"BTC3h":btc["ret3h"],"BTC6h":btc["ret6h"]})
    continue
   out.append(row)
  return out
 def apply_exit(row,rule,source,cost_bps,obs,original_row=None):
  if rule.get("kind")!="residual_avax_exit_after_no_doge_20261023":
   return original_apply(row,rule,source,cost_bps,obs,original_row=original_row)
  if row.get("strategy_id")!="RESIDUAL" or row.get("symbol")!="AVAXUSDT" or row.get("side")!="LONG":
   return row
  audit=obs.setdefault("avaxDataQuality",collections.Counter())
  combo=screen._find_exit(row,EXIT_COMBO,source,audit)
  selected=combo;label="RESEARCH_AVAX_"+EXIT_COMBO
  settings=CASES[current]
  if settings["watch"] or settings["hard"]:
   candidate=hedge.find_risk_exit(row,source,audit,
     enable_watch=settings["watch"],enable_hard=settings["hard"])
   if candidate is not None and (selected is None or candidate["ts"]<=selected["ts"]):
    selected=candidate
    label="RESEARCH_AVAX_RISK_HEDGE_"+candidate["trigger"]
  if selected is None:return row
  assert int(row["entry_ts_ms"])<selected["ts"]<int(row["exit_ts_ms"])
  updated=dict(row,exit_ts_ms=int(selected["ts"]),exit_price=float(selected["fill"]),
     exit_reason=label,unit_price_return=float(selected["fill"])/float(row["entry_price"])-1)
  obs["by_reason"][label]+=1
  obs["avaxExitModified"]=obs.get("avaxExitModified",0)+1
  if label.startswith("RESEARCH_AVAX_RISK_HEDGE_"):
   obs.setdefault("avaxRiskHedgeAudit",[]).append({"entryTsMs":row["entry_ts_ms"],
     "oldExitTs":row["exit_ts_ms"],"newExitTs":selected["ts"],"oldExitPrice":row["exit_price"],
     "newExitPrice":selected["fill"],"trigger":selected["trigger"],
     "firstTouchTsMs":selected["touchTsMs"],"deadlineTsMs":selected["watchDeadlineMs"],
     "lowestBarPct":selected["lowRetPct"],"simulatedFillPct":selected["fillRetPct"]})
  return updated
 def run_overlay(name,phase,overlays,cost,source,helper,previous_factory,baseline_lookup=None):
  compound_overlay=reference.prior.overlay(EXIT_COMBO)
  xname=name+"_AVAX_ENTRY_"+("VETO_DUAL" if current=="BASE_DUAL" else current)
  namespace="cmp_"+hashlib.sha256(xname.encode("utf8")).hexdigest()[:12]
  target=(args.output/"engine"/namespace/namespace/(str(cost)+"bps")/
     "cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/("PRICE_MODEL_"+str(cost)+"BPS"))
  target.mkdir(parents=True,exist_ok=True)
  original_run.__globals__["OUTPUT"]=args.output
  return original_run(xname,phase,[*overlays,*compound_overlay],cost,source,helper,previous_factory,
     baseline_lookup=baseline_lookup)
 core._transform_rows=candidate_filter
 core._apply_initial_stop=apply_exit
 core._matches=native.m.m.idle.matches
 core._run_engine=run_overlay
 source,helper=core.task8.legacy.bootstrap()
 native.m.m.base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 results={"status":"RESEARCH_ONLY_AVAX_WATCH35_2H_PLUS_HARD5_NATIVE_FULL8_NOT_LIVE",
  "referenceSha":sha(REFERENCE),"reference":"RESIDUAL_AVAX_COMPOSITE_ENTRY_VETO_FULL8_20261023.json",
  "scope":"Only RESIDUAL AVAXUSDT LONG. DOGE veto and AVAX DUAL entry veto fixed.",
  "exitBaseline":EXIT_COMBO,"costsBps":[10,30],"protectiveRiskHedgeCases":CASES,"cases":{},
  "limitations":["-5% historical STOP uses M5 low and floor/worse opening gap; immediate LIVE STOP requires verified native venue protective order",
    "Already explored 2025-08-10..2026-08-10 in-sample window, only 18 AVAX DUAL entries at baseline",
    "STOP on confirmed M5 close and next M5 open; intrabar under-water path may be worse",
    "Frozen V52 selected tape lacks 11 originally suppressed candidates and unrealized new raw signals",
    "No LIVE Production SHA parity or real venue order book, margin/funding/slippage parity"]}
 for case in args.cases:
  current=case
  for cost in (10,30):
   # Identical name on BASE_DUAL preserves prior veto DUAL ledger SHA for exact anchor.
   source_name="AVAX_COMBO_ENTRY_GATES_"+("VETO_DUAL" if case=="BASE_DUAL" else case)
   r,passes=native.replay(source_name,cost,source,helper,previous,STOCK)
   assert r["accounting"]=="PASS"
   trade=native.m.jsonl(r["ledger"])
   residual=[z for z in trade if z["strategy_id"]=="RESIDUAL"]
   avax=[z for z in residual if z["symbol"]=="AVAXUSDT"]
   assert all(z["symbol"]!="DOGEUSDT" for z in residual)
   early=[z for z in avax if str(z.get("exit_reason_actual") or z.get("exit_reason") or "").startswith("RESEARCH_AVAX_RISK_HEDGE_")]
   hard=[z for z in early if "HARD_MINUS5_ANY_TOUCH" in str(z.get("exit_reason_actual") or z.get("exit_reason"))]
   soft=[z for z in early if "SOFT_MINUS3P5_WATCH2H" in str(z.get("exit_reason_actual") or z.get("exit_reason"))]
   assert len(hard)+len(soft)==len(early)
   old=anchor[str(cost)]
   info={"costBps":cost,"finalEquityJpy":r["final_equity_jpy"],
    "deltaVsDualJpy":r["final_equity_jpy"]-old["finalEquityJpy"],
    "portfolioPF":r["profit_factor"],"ddPct":r["maximum_mtm_drawdown_pct"],
    "ddDeltaVsDualPctPoints":r["maximum_mtm_drawdown_pct"]-old["ddPct"],
    "closedTrades":r["closed_trades"],"deltaTradesVsDual":r["closed_trades"]-old["closedTrades"],
    "totalWinners":sum(float(z["total_pnl_jpy"])>0 for z in trade),
    "avaxCount":len(avax),"avaxWins":sum(float(z["total_pnl_jpy"])>0 for z in avax),
    "avaxModeledPnLJpy":sum(float(z["modeled_realized_pnl_jpy_at_exit_fx"]) for z in avax),
    "initialStopCount":len(early),"hard5Count":len(hard),"watch35Count":len(soft),
    "initialStopTimes":[z["entry_ts_ms"] for z in early],
    "byStrategy":dict(collections.Counter(z["strategy_id"] for z in trade)),
    "ledgerSha256":sha(r["ledger"]),"reselectionPasses":len(passes),"accounting":r["accounting"]}
   assert len(passes)==3,("RESELECTION_COUNT",case,cost,len(passes))
   assert sum(info["byStrategy"].values())==info["closedTrades"]
   if case=="BASE_DUAL":
    assert abs(info["deltaVsDualJpy"])<.02
    assert abs(info["ddDeltaVsDualPctPoints"])<1e-8
    assert info["closedTrades"]==old["closedTrades"]
    assert info["ledgerSha256"]==old["ledgerSha256"],("BASELINE_LEDGER_NOT_IDENTICAL",cost)
    assert info["initialStopCount"]==0
   results["cases"].setdefault(case,{"hedgeRule":CASES[case],"costs":{}})["costs"][str(cost)]=info
   output=args.output/"AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json"
   output.write_text(json.dumps(results,ensure_ascii=False,indent=2)+"\n",encoding="utf8",newline="\n")
   print("AVAX_WATCH35_HARD5_NATIVE_FULL8",case,cost,"FINAL",round(info["finalEquityJpy"]),
    "GAIN",round(info["deltaVsDualJpy"]),"DD",round(info["ddPct"],5),
    "N",info["closedTrades"],"WR",round(100*info["totalWinners"]/info["closedTrades"],3),
    "AVAX",info["avaxCount"],"AVAX_WINS",info["avaxWins"],
    "RISK_STOPS",info["initialStopCount"],"HARD5",info["hard5Count"],"WATCH35",info["watch35Count"],"PF",round(info["portfolioPF"],4),flush=True)
 print("AVAX_WATCH35_HARD5_NATIVE_FULL8_COMPLETE",len(results["cases"]))
if __name__=="__main__":main()
