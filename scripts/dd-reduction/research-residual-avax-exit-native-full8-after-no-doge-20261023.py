#!/usr/bin/env python3
"""Research-only native 8-logic AVAX exit experiments AFTER DOGE RESIDUAL veto.
Changes only RESIDUAL AVAX LONG exit; original AMZN stock veto and other
adopted HYPE/IDLE/FET/V12/PENGU/Q102/V52 policies untouched. Full wallet
ownership and V12 cooldown convergence. No venue orders, no LIVE.
"""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
RESULT_ROOT=REPO/"docs/research/results/residual-composite-20261023"
def load(name,p):
 sp=importlib.util.spec_from_file_location(name,p)
 assert sp and sp.loader
 out=importlib.util.module_from_spec(sp);sp.loader.exec_module(out);return out
prior=load("avax_full8_prior_ablation",HERE/"research-residual-full8-ablation-20261023.py")
screen=load("avax_exit_m5_causal_screen",HERE/"research-residual-avax-exit-after-no-doge-20261023.py")
native=prior.native
STOCK=ROOT/"v52_amzn_entry_studies_20261022"/prior.AMZN_STUDY
REFERENCE=RESULT_ROOT/"RESIDUAL_FULL8_ABLATION_RESULT_20261023.json"
CASES={
 "BASE_NO_DOGE":None,
 "TRAIL_ARM3_GIVE1P5":"TRAIL_ARM3_GIVE1P5",
 "PROFIT_ARM3_FLOOR1P5":"PROFIT_ARM3_FLOOR1P5",
 "TIME_6H":"TIME_6H",
 "TIME_8H":"TIME_8H",
 "EARLY_2H_LOSS2_MFE_LT1":"EARLY_2H_LOSS2_MFE_LT1",
 "COMBO_LOSS4_TRAIL3":"COMBO_LOSS4_TRAIL3",
}
def sha(p):
 h=hashlib.sha256()
 with Path(p).open("rb") as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
def overlay(name):
 if name=="BASE_NO_DOGE":return []
 assert name in CASES and CASES[name] in screen.RULES
 return [{"strategy":"RESIDUAL","sides":["LONG"],"symbols":["AVAXUSDT"],
   "id":"AVAX_NO_DOGE_EXIT_"+name,"reentry_hours":0.0,
   "kind":"residual_avax_exit_after_no_doge_20261023","residualPolicy":CASES[name]}]
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--output",type=Path,required=True)
 parser.add_argument("--cases",nargs="+",default=list(CASES))
 a=parser.parse_args()
 assert a.cases and len(set(a.cases))==len(a.cases) and set(a.cases)<=set(CASES)
 assert REPO not in (a.output.resolve(),*a.output.resolve().parents)
 assert STOCK.is_dir()
 meta=json.loads((STOCK/"scenario-manifest.json").read_text("utf8"))
 assert meta["caseTape99Sha256"]==sha(STOCK/"v52-model-ledger.jsonl")
 anchor=json.loads(REFERENCE.read_text("utf-8"))["cases"]["NO_DOGE"]
 native.m.acquire_verified_h1()
 a.output.mkdir(parents=True,exist_ok=True)
 core=native.m.m.core
 core.OUTPUT=a.output
 core.BOOTSTRAP_REDIRECT=a.output/"_legacy-bootstrap-cache"
 original_filter=native.m.m.entry_filter
 original_apply=native.m.p.apply
 original_run=core._run_engine
 # The legacy adapter can delete the nested output directory before writing a
 # decisions file. The original imported function's write hook is insufficient
 # in this secondary module. Guard mkdir strictly inside our isolated output.
 task9_globals=original_run.__globals__
 actual_path_write=task9_globals["_path_write_text"]
 allowed_output=str(a.output.resolve()).replace(chr(92),"/").casefold().rstrip("/")
 def research_only_output_write(self,data,*args,**kwargs):
  current_path=str(self.resolve()).replace(chr(92),"/").casefold()
  if a.output.name in self.parts:
   self.parent.mkdir(parents=True,exist_ok=True)
   if self.name=="candidate-decisions.jsonl":
    print("AVAX_RESEARCH_WRITE_MKDIR",self.parent.exists(),str(self.parent)[-110:],flush=True)
  return actual_path_write(self,data,*args,**kwargs)
 task9_globals["_ensure_research_output_parent_write_text"]=research_only_output_write
 current="BASE_NO_DOGE"
 def filter_doge(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
  transformed=original_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
  out=[]
  for row in transformed:
   if row.get("strategy_id")=="RESIDUAL" and row.get("symbol")=="DOGEUSDT":
    obs["no_doge_residual_rejected"]=obs.get("no_doge_residual_rejected",0)+1
    continue
   out.append(row)
  return out
 def apply_exit(row,rule,source,cost_bps,obs,original_row=None):
  if rule.get("kind")!="residual_avax_exit_after_no_doge_20261023":
   return original_apply(row,rule,source,cost_bps,obs,original_row=original_row)
  if row.get("strategy_id")!="RESIDUAL" or row.get("symbol")!="AVAXUSDT" or row.get("side")!="LONG":return row
  audit=obs.setdefault("avaxExitDataQuality",collections.Counter())
  change=screen._find_exit(row,rule["residualPolicy"],source,audit)
  if not change:return row
  assert change["ts"]<int(row["exit_ts_ms"]) and change["ts"]>int(row["entry_ts_ms"])
  oldreason=row.get("exit_reason_actual") or row.get("exit_reason")
  result=dict(row,
     exit_ts_ms=int(change["ts"]),exit_price=float(change["fill"]),
     exit_reason="RESEARCH_AVAX_"+rule["residualPolicy"],
     unit_price_return=float(change["fill"])/float(row["entry_price"])-1)
  obs["by_reason"]["RESEARCH_AVAX_"+rule["residualPolicy"]]+=1
  obs["avaxExitModified"]=obs.get("avaxExitModified",0)+1
  obs.setdefault("avaxExitAudit",[]).append({"entryTs":row["entry_ts_ms"],"oldExitTs":row["exit_ts_ms"],
    "newExitTs":change["ts"],"oldReason":oldreason,"newReason":result["exit_reason"],"oldPrice":row["exit_price"],
    "newPrice":change["fill"],"trigger":change["trigger"]})
  return result
 def extra_overlay_engine(policy_name,phase,overlays,cost,source,helper,previous_factory,baseline_lookup=None):
  merged=[*overlays,*overlay(current)]
  research_name=policy_name+"_AVAX_"+current
  digest=hashlib.sha256(research_name.encode("utf-8")).hexdigest()[:12]
  namespace="cmp_"+digest
  # Archived full8 adapter can write candidate-decisions before creating PRICE_MODEL subdirectory.
  # Restrict directory preparation to the isolated research output, never engine source.
  run_dir=a.output/"engine"/namespace/namespace/(str(cost)+"bps")/"cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/("PRICE_MODEL_"+str(cost)+"BPS")
  run_dir.mkdir(parents=True,exist_ok=True)
  # The adapter invokes a function object from another imported task9 module.
  # Bind its global output prefix explicitly, so write_text ensures parents safely.
  original_run.__globals__["OUTPUT"]=a.output
  return original_run(research_name,phase,merged,cost,source,helper,previous_factory,
     baseline_lookup=baseline_lookup)
 core._transform_rows=filter_doge
 core._apply_initial_stop=apply_exit
 core._matches=native.m.m.idle.matches
 core._run_engine=extra_overlay_engine
 source,helper=core.task8.legacy.bootstrap()
 native.m.m.base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 results={"status":"RESEARCH_ONLY_FULL8_AVAX_EXITS_AFTER_DOGE_VETO_NOT_LIVE",
   "baseline":"NO_DOGE native 8-logics from 2026-10-23 ablation, exact ledger and accounting",
   "stockV52FrozenSourceSha":meta["caseTape99Sha256"],
   "costsBps":[10,30],"cases":{},
   "limitations":["Frozen selected V52 stock source 99 rows, 11 previously suppressed not regenerated",
       "H1 source/native crypto M5 closed candles with next bar open modeling; no real venue STOP order contract",
       "No execution L2 slippage, funding/margin liquidation or current LIVE SHA parity",
       "In-sample exit selection across 15 AVAX annual trades; no pristine OOS",
       "Every case replays all eight strategies and dynamic wallet/cooldown, does not create novel raw candidate signals"]}
 for name in a.cases:
  current=name
  for cost in (10,30):
   r,history=native.replay("RESIDUAL_NO_DOGE_AVAX_EXIT_"+name,cost,source,helper,previous,STOCK)
   assert r["accounting"]=="PASS"
   trades=native.m.jsonl(r["ledger"])
   res=[x for x in trades if x["strategy_id"]=="RESIDUAL"]
   avax=[x for x in res if x["symbol"]=="AVAXUSDT"]
   doge=[x for x in res if x["symbol"]=="DOGEUSDT"]
   changed=[x for x in avax if str(x.get("exit_reason_actual") or x.get("exit_reason") or "").startswith("RESEARCH_AVAX_")]
   b=anchor[str(cost)]
   value={
    "costBps":cost,"finalEquityJpy":r["final_equity_jpy"],
    "deltaVsNoDogeBaselineJpy":r["final_equity_jpy"]-b["portfolioEquityJpy"],
    "maxMtmDrawdownPct":r["maximum_mtm_drawdown_pct"],
    "ddDeltaVsNoDogePctPoints":r["maximum_mtm_drawdown_pct"]-b["maxMtmDDPct"],
    "portfolioPF":r["profit_factor"],
    "closedTrades":r["closed_trades"],
    "deltaTradesVsNoDoge":r["closed_trades"]-b["totalTrades"],
    "residualAvaxTrades":len(avax),
    "residualDogeTrades":len(doge),
    "avaxWins":sum(float(x["total_pnl_jpy"])>0 for x in avax),
    "avaxPnLJpy":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in avax),
    "changedAvaxExits":len(changed),
    "changedExitCandidateIds":[x["candidate_id"] for x in changed],
    "byStrategy":dict(collections.Counter(x["strategy_id"] for x in trades)),
    "ledgerSha256":sha(r["ledger"]),"reselectionPasses":len(history),"accounting":r["accounting"]}
   assert len(doge)==0 and sum(value["byStrategy"].values())==value["closedTrades"]
   if name=="BASE_NO_DOGE":
    assert abs(value["deltaVsNoDogeBaselineJpy"])<.02
    assert abs(value["ddDeltaVsNoDogePctPoints"])<1e-8
    assert value["closedTrades"]==b["totalTrades"]
    assert value["ledgerSha256"]==b["ledgerSha256"]
    assert value["changedAvaxExits"]==0
   results["cases"].setdefault(name,{"policy":CASES[name],"costs":{}})["costs"][str(cost)]=value
   (a.output/"RESIDUAL_AVAX_EXIT_NO_DOGE_NATIVE_FULL8_20261023.json").write_text(
    json.dumps(results,ensure_ascii=False,indent=2)+"\n",encoding="utf8",newline="\n")
   print("AVAX_NO_DOGE_EXIT_FULL8",name,cost,"FINAL",round(value["finalEquityJpy"]),
    "DELTA",round(value["deltaVsNoDogeBaselineJpy"]), "DD",round(value["maxMtmDrawdownPct"],6),
    "DDDELTA",round(value["ddDeltaVsNoDogePctPoints"],6),
    "N",value["closedTrades"],"DN",value["deltaTradesVsNoDoge"],
    "AVAX",len(avax),"AVA_WINS",value["avaxWins"],"AVA_PNL",round(value["avaxPnLJpy"]),
    "TRIGGERED",value["changedAvaxExits"],"RESELECT",value["reselectionPasses"],flush=True)
 print("AVAX_NATIVE_EXIT_FULL8_COMPLETE",len(results["cases"]),flush=True)
if __name__=="__main__":main()
