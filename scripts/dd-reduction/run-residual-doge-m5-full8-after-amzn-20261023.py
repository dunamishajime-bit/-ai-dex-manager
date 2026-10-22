#!/usr/bin/env python3
"""Research full-8 dynamic BT for RESIDUAL DOGE only, after adopted AMZN +1% veto.

All prior adopted HYPE, IDLE, FET, V12, Q102, PENGU remain in the
existing source-frozen 8-strategy model. AMZN +1% entry veto study is
carried as approved-by-user research, although still non-certified LIVE.
V52 source 99 stock tape with original suppressed11 is pinned.
Only RESIDUAL DOGE LONG new M5 *closed signal -> next M5 open* exits.
Re-run full wallet ownership and V12 cooldown reselection.
No order changes or LIVE promotion.
"""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
def load(name,p):
 sp=importlib.util.spec_from_file_location(name,p)
 assert sp and sp.loader
 obj=importlib.util.module_from_spec(sp);sp.loader.exec_module(obj);return obj
amzn=load("residual_after_amzn_stock_replay",HERE/"run-v52-amzn-entry-full8-after-fet-20261022.py")
screen=load("residual_doge_screen_exit_from_completed_m5",HERE/"screen-residual-next-m5-after-v52amzn-20261023.py")
native=amzn.native
AMZN_STUDY="AMZN_SHORT_PRIOR_CLOSE_PLUS1P0"
BASE=ROOT/"f8v52amzn_more/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json"
CASES={
 "DOGE_LOSS_1H_2P_MFE1":("DOGE_INITIAL_1H_LOSS2_MFE_LT1",),
 "DOGE_LOSS_2H_1P5_MFE1":("DOGE_INITIAL_2H_LOSS1P5_MFE_LT1",),
 "DOGE_PROFIT_3P_FLOOR1":("DOGE_PROFIT_ARM3_FLOOR1",),
 "DOGE_LOSS1H_PLUS_PROFIT3P":("DOGE_INITIAL_1H_LOSS2_MFE_LT1","DOGE_PROFIT_ARM3_FLOOR1"),
}
def sha(p):
 h=hashlib.sha256()
 with Path(p).open("rb") as f:
  for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
 return h.hexdigest()
def rules_for(name):
 assert name in CASES
 return [
    {"strategy":"RESIDUAL","sides":["LONG"],"symbols":[screen.RULES[k]["symbol"]],
     "id":"RESIDUAL_20261023_"+k,"reentry_hours":0.0,
     "kind":"residual_m5_causal_v1","residualPolicy":k}
    for k in CASES[name]]
def create_apply():
 delegate=native.m.p.apply
 def apply(row,rule,source,cost_bps,obs,original_row=None):
  if rule.get("kind")!="residual_m5_causal_v1":
   return delegate(row,rule,source,cost_bps,obs,original_row=original_row)
  if row.get("strategy_id")!="RESIDUAL" or row.get("symbol")!=screen.RULES[rule["residualPolicy"]]["symbol"] or row.get("side")!="LONG":
   return row
  obs.setdefault("triggers",0)
  outcome=screen.candidate(row,screen.RULES[rule["residualPolicy"]],source,cost_bps,obs)
  if not outcome or int(outcome["ts"])>=int(row["exit_ts_ms"]):return row
  price=float(outcome["fill"])
  if price<=0:raise ValueError("NONPOSITIVE_RESIDUAL_CUSTOM_EXIT")
  result=dict(row,
     exit_ts_ms=int(outcome["ts"]),
     exit_price=price,
     exit_reason="RESEARCH_RESIDUAL_"+rule["residualPolicy"],
     unit_price_return=price/float(row["entry_price"])-1)
  obs["by_reason"]["RESIDUAL_"+rule["residualPolicy"]]+=1
  return result
 return apply

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--output",required=True,type=Path)
 parser.add_argument("--cases",nargs="+",default=list(CASES))
 args=parser.parse_args()
 assert args.cases and set(args.cases)<=set(CASES)
 assert len(args.cases)==len(set(args.cases))
 assert REPO not in (args.output.resolve(),*args.output.resolve().parents)
 baseline=json.loads(BASE.read_text("utf-8"))["cases"][AMZN_STUDY]["costs"]
 stock=ROOT/"v52_amzn_entry_studies_20261022"/AMZN_STUDY
 assert stock.is_dir()
 original=json.loads((stock/"scenario-manifest.json").read_text("utf-8"))
 assert original["sourceOriginal99Sha256"]==native.hashfile(native.STOCK_ARCHIVE/"v52-model-ledger.jsonl")
 assert original["amznVetoCount"]==1 and original["amznVetoShort"]==1
 native.m.acquire_verified_h1()
 args.output.mkdir(parents=True,exist_ok=True)
 core=native.m.m.core
 core.OUTPUT=args.output
 core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 core._transform_rows=native.m.m.entry_filter
 core._apply_initial_stop=create_apply()
 core._matches=native.m.m.idle.matches
 source,helper=core.task8.legacy.bootstrap()
 native.m.m.base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 orig_engine=core._run_engine
 current_name=None
 def run_engine(policy_name,phase,overlays,cost,src,helper,prior):
  extra=rules_for(current_name) if current_name else []
  return orig_engine(policy_name+"_R_"+str(current_name),phase,[*overlays,*extra],cost,src,helper,prior)
 core._run_engine=run_engine
 out={
   "status":"RESEARCH_ONLY_RESIDUAL_M5_EXIT_FULL8_AFTER_USER_ADOPTED_V52_AMZN_GATE",
   "period":"2025-08-10..2026-08-10",
   "baselineResearch":"FET_TRAIL8_4+HYPE+IDLE+AMZN_SHORT_PREV_YAHOO_OVER_PLUS1P0_VETO",
   "carryOverAmznSourceStockTapeSha256":original["caseTape99Sha256"],
   "sourceOriginalSuppressedV52CandidatesNotRegenerated":11,
   "source5mRepricedAtNextOpen":True,
   "noLiveOrProductionModifications":True,
   "costsBps":[10,30],"cases":{}}
 for name in args.cases:
  current_name=name
  for cost in (10,30):
   result,history=native.replay("RESIDUAL_"+name,cost,source,helper,previous,stock)
   assert result["accounting"]=="PASS"
   ledger=native.m.jsonl(result["ledger"])
   residual=[x for x in ledger if x["strategy_id"]=="RESIDUAL"]
   trigger=[x for x in residual if x["exit_reason_actual"].startswith("RESEARCH_RESIDUAL_")]
   doge=[x for x in residual if x["symbol"]=="DOGEUSDT"]
   avax=[x for x in residual if x["symbol"]=="AVAXUSDT"]
   b=baseline[str(cost)]
   r={
     "finalEquityJpy":result["final_equity_jpy"],
     "deltaVsCarryOverAmznBaselineJpy":result["final_equity_jpy"]-b["equityJpy"],
     "maxMtmDrawdownPct":result["maximum_mtm_drawdown_pct"],
     "ddChangePctPoints":result["maximum_mtm_drawdown_pct"]-b["maxMtmDdPct"],
     "closedTrades":result["closed_trades"],
     "deltaTotalTrades":result["closed_trades"]-b["closedTrades"],
     "residualTrades":len(residual),"residualWins":sum(x["total_pnl_jpy"]>0 for x in residual),
     "residualNetContributionJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in residual),
     "residualDogeTrades":len(doge),"residualDogeWins":sum(x["total_pnl_jpy"]>0 for x in doge),
     "residualDogeNetContributionJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in doge),
     "residualAvaxTrades":len(avax),"residualAvaxNetContributionJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in avax),
     "changedResidualDogeExits":len(trigger),
     "changedExitEvents":[{"candidateId":x["candidate_id"],"symbol":x["symbol"],"exitReason":x["exit_reason_actual"],
       "exitUtc":x["exit_ts_ms"],"modelPnlJpy":x["modeled_realized_pnl_jpy_at_exit_fx"]} for x in trigger],
     "full8ReselectionPasses":len(history),"ledgerSha256":sha(result["ledger"]),
     "accounting":result["accounting"]}
   assert all(x["symbol"]=="DOGEUSDT" for x in trigger)
   assert len(residual)>0
   assert r["changedResidualDogeExits"]>0,(name,cost,"No residual signal changed")
   out["cases"].setdefault(name,{"rules":CASES[name],"costs":{}})["costs"][str(cost)]=r
   (args.output/"RESIDUAL_M5_EXIT_FULL8_AFTER_AMZN_20261023.json").write_text(
      json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
   print("RESIDUAL_FULL8",name,cost,"final",round(r["finalEquityJpy"]),
    "delta",round(r["deltaVsCarryOverAmznBaselineJpy"]),
    "DD",round(r["maxMtmDrawdownPct"],5),
    "trades",r["closedTrades"],"delta_trades",r["deltaTotalTrades"],
    "residual",r["residualTrades"],"DOGE",r["residualDogeTrades"],
    "NET_RES_JPY",round(r["residualNetContributionJpy"]),
    "changed_exits",r["changedResidualDogeExits"],flush=True)
 print("RESIDUAL_FULL8_RESEARCH_CASES_COMPLETE",len(out["cases"]),flush=True)
if __name__=="__main__":main()
