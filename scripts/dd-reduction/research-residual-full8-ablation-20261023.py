#!/usr/bin/env python3
"""Research full-8 counterfactual: stop injecting nonperforming RESIDUAL entries.
Preserve source HYPE/FET/IDLE/V12/Q102/PENGU/V52/AMZN and dynamic reselection.
No real venue, no production, no order or cancel calls.

Research hypothesis: underperformance of only 30 historical RESIDUAL admissions
may mean overall trade opportunity should be reallocated to existing runners
rather than chase additional weak RESIDUAL fills.
"""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
sp=importlib.util.spec_from_file_location("residual_full8_amzn_base_source",HERE/"run-v52-amzn-entry-full8-after-fet-20261022.py")
amzn=importlib.util.module_from_spec(sp);sp.loader.exec_module(amzn)
native=amzn.native
AMZN_STUDY="AMZN_SHORT_PRIOR_CLOSE_PLUS1P0"
BASE=ROOT/"f8v52amzn_more/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json"
CASES=("BASE_REPLAY","NO_RESIDUAL","NO_DOGE","NO_AVAX")
def sha(p):
 h=hashlib.sha256()
 with Path(p).open("rb") as f:
  for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
 return h.hexdigest()
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--output",type=Path,required=True)
 parser.add_argument("--cases",nargs="+",default=CASES)
 a=parser.parse_args()
 assert set(a.cases).issubset(CASES) and len(set(a.cases))==len(a.cases)
 assert REPO not in (a.output.resolve(),*a.output.resolve().parents)
 baseline=json.loads(BASE.read_text("utf-8"))["cases"][AMZN_STUDY]["costs"]
 stock=ROOT/"v52_amzn_entry_studies_20261022"/AMZN_STUDY
 sm=json.loads((stock/"scenario-manifest.json").read_text("utf-8"))
 assert sm["amznVetoCount"]==1 and sm["originalSuppressed11Regenerated"] is False
 assert sm["caseTape99Sha256"]==sha(stock/"v52-model-ledger.jsonl")
 native.m.acquire_verified_h1()
 a.output.mkdir(parents=True,exist_ok=True)
 core=native.m.m.core
 core.OUTPUT=a.output
 core.BOOTSTRAP_REDIRECT=a.output/"_legacy-bootstrap-cache"
 original_filter=native.m.m.entry_filter
 current="BASE_REPLAY"
 def select_candidates(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
  transformed=original_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
  removed=[];out=[]
  for row in transformed:
   if row.get("strategy_id")!="RESIDUAL":
    out.append(row);continue
   if current=="NO_RESIDUAL" or (current=="NO_DOGE" and row.get("symbol")=="DOGEUSDT") or (current=="NO_AVAX" and row.get("symbol")=="AVAXUSDT"):
    removed.append(row)
   else:out.append(row)
  obs["residual_research_suppressed"]={"case":current,"cost":cost_bps,
      "removed":len(removed),"symbols":dict(collections.Counter(r.get("symbol") for r in removed))}
  return out
 core._transform_rows=select_candidates
 core._apply_initial_stop=native.m.p.apply
 core._matches=native.m.m.idle.matches
 source,helper=core.task8.legacy.bootstrap()
 native.m.m.base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 out={"status":"RESEARCH_ONLY_NATIVE_FULL8_DYNAMIC_RESIDUAL_ABLATION_NO_LIVE",
 "sourceSha":"e1f2088574c933dab388d26ed3c113ad47c72321",
 "baseline":"AMZN_SHORT_PRIOR_CLOSE_PLUS1P0 and adopted HYPE+IDLE+FET etc unchanged",
 "stockOriginalSuppressed11NotRecreated":True,
 "costsBps":[10,30],"cases":{},
 "limitations":["Original non-selected RESIDUAL candidate stream may be incomplete and cannot regenerate novel signals",
     "No venue L2, real margin/liquidation, production SHA/real-order lifecycle certified",
     "Result is research 8-strategy wallet on fixed native V52 99-row tape and other archived candidate data",
     "Do not automatically retire LIVE RESIDUAL even if research economics improve"]}
 # Same native engine source and case tape, with ONLY this candidate filter transform.
 for name in a.cases:
  current=name
  for cost in (10,30):
   r,history=native.replay("RESIDUAL_ABLATION_"+name,cost,source,helper,previous,stock)
   assert r["accounting"]=="PASS"
   ledger=native.m.jsonl(r["ledger"])
   resid=[row for row in ledger if row["strategy_id"]=="RESIDUAL"]
   rest=[row for row in ledger if row["strategy_id"]!="RESIDUAL"]
   b=baseline[str(cost)]
   outcome={
    "portfolioEquityJpy":r["final_equity_jpy"],
    "equityDeltaFrom8LogicBaselineJpy":r["final_equity_jpy"]-b["equityJpy"],
    "maxMtmDDPct":r["maximum_mtm_drawdown_pct"],
    "ddDeltaPctPoints":r["maximum_mtm_drawdown_pct"]-b["maxMtmDdPct"],
    "PF":r["profit_factor"],
    "totalTrades":r["closed_trades"],
    "tradeCountDelta":r["closed_trades"]-b["closedTrades"],
    "residualTrades":len(resid),
    "residualDoge":sum(x["symbol"]=="DOGEUSDT" for x in resid),
    "residualAvax":sum(x["symbol"]=="AVAXUSDT" for x in resid),
    "residualWins":sum(float(x.get("total_pnl_jpy") or 0)>0 for x in resid),
    "nonResidualTrades":len(rest),
    "byStrategy":dict(collections.Counter(x["strategy_id"] for x in ledger)),
    "byStrategyWins":{s:sum(x["strategy_id"]==s and float(x.get("total_pnl_jpy") or 0)>0 for x in ledger)
                       for s in sorted({x["strategy_id"] for x in ledger})},
    "residualModeledContributionJpy":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in resid),
    "reselectionPasses":len(history),
    "ledgerSha256":sha(r["ledger"]),"accounting":r["accounting"]}
   if name=="BASE_REPLAY":
    assert abs(outcome["equityDeltaFrom8LogicBaselineJpy"])<.02,("ANCHOR_EQUITY_NOT_MATCHED",cost,outcome)
    assert abs(outcome["ddDeltaPctPoints"])<1e-7,("ANCHOR_DD_NOT_MATCHED",cost)
    assert outcome["totalTrades"]==b["closedTrades"],("ANCHOR_TRADES_NOT_MATCHED",cost)
    assert outcome["ledgerSha256"]==b["ledgerSha256"],("ANCHOR_LEDGER_HASH_NOT_MATCHED",cost)
   else:
    assert outcome["residualTrades"]<30 and outcome["totalTrades"]>1150,(name,cost,outcome)
    if name=="NO_RESIDUAL":assert outcome["residualTrades"]==0
    if name=="NO_DOGE":assert outcome["residualDoge"]==0
    if name=="NO_AVAX":assert outcome["residualAvax"]==0
   out["cases"].setdefault(name,{})[str(cost)]=outcome
   (a.output/"RESIDUAL_FULL8_ABLATION_RESULT_20261023.json").write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8",newline="\n")
   print("FULL8_ABLATION",name,cost,"FINAL",round(outcome["portfolioEquityJpy"]),
     "DELTA",round(outcome["equityDeltaFrom8LogicBaselineJpy"]),
     "DD",round(outcome["maxMtmDDPct"],4),
     "TRADES",outcome["totalTrades"],"DELTA_N",outcome["tradeCountDelta"],
     "RESIDUAL",outcome["residualTrades"],"STRATS",outcome["byStrategy"],
     "RESELECTION",outcome["reselectionPasses"],flush=True)
 print("FULL8_ABLATION_COMPLETE",len(out["cases"]),flush=True)
if __name__=="__main__":main()