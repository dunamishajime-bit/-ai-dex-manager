#!/usr/bin/env python3
"""P19: source P14 unchanged residual + frozen BTC confirmed early partial profit.

Synthetic cashflow splitting, NOT real partial fills or native stop recalculation.
"""
from __future__ import annotations
import argparse,csv,json,hashlib
from collections import defaultdict
from pathlib import Path
RULES=("BTC_CONFIRM_GAIN_LOCK","BTC_STRONG_BOUNCE_LOCK")
FRACTIONS=(0.0,.25,.5,.75,1.0)
FEES=(10,30)
SLIPS=(0,10,25)
N=53

def read(path):
 with path.open("r",encoding="utf-8-sig",newline="") as f:
  return list(csv.DictReader(f))

def metric(rows):
 v=[x for x in rows if x["net_pct"] is not None]
 vals=[x["net_pct"] for x in v]
 win=[x for x in vals if x>0]
 prof=sum(win);loss=-sum(x for x in vals if x<0)
 src=[x["source_native_net_pct"] for x in v]
 return {
  "sourceOriginalIntentCount":len(rows),
  "priceProxyObserved":len(v),
  "sourceIntentPriceUnobserved":len(rows)-len(v),
  "scenarioWins":len(win),
  "scenarioWinratePctConditional":100*len(win)/len(v) if v else None,
  "scenarioMeanNetPctConditional":sum(vals)/len(vals) if vals else None,
  "scenarioProfitFactorConditional":prof/loss if loss>0 else None,
  "originalSourceWinsSameSubset":sum(x>0 for x in src),
  "originalSourceMeanNetPctSameSubset":sum(src)/len(src) if src else None,
  "sourceWinsNowLose":sum(x["source_native_net_pct"]>0 and x["net_pct"]<=0 for x in v),
  "sourceLosersNowWin":sum(x["source_native_net_pct"]<=0 and x["net_pct"]>0 for x in v),
  "originalWinnerTotalPnLDeltaPct":sum(x["net_pct"]-x["source_native_net_pct"]
                                      for x in v if x["source_native_net_pct"]>0),
  "originalLoserTotalPnLDeltaPct":sum(x["net_pct"]-x["source_native_net_pct"]
                                      for x in v if x["source_native_net_pct"]<=0),
  "earlyPartialActionCount":sum(x["researchPartialTriggered"] for x in rows),
 }

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--p18-scenarios",type=Path,required=True)
 ap.add_argument("--out-summary",type=Path,required=True)
 ap.add_argument("--out-ledger",type=Path,required=True)
 args=ap.parse_args()
 raw=read(args.p18_scenarios)
 if len(raw)!=954:raise ValueError("P19_SOURCE954_NATIVE_P18_REQUIRED")
 history={}
 for x in raw:
  if int(x["additionalExitSlippageBps"])!=0:continue
  fee=int(x["feeBps"])
  key=(x["period"],x["id"],fee)
  r=history.setdefault(key,{})
  if x["rule"] in r:raise ValueError("DUPLICATE_FROZEN_RULE_CASE")
  r[x["rule"]]=x
 if len(history)!=N*2:raise ValueError("53_X_2_COSTS_INPUT_MISMATCH")
 long=[]
 for (period,case,fee),rr in history.items():
  if set(rr)!={"SOURCE_P14_NATIVE_M5_BASELINE",*RULES}:
   raise ValueError("NOT_ALL_2_P18_RULES_PRESENT")
  nat=rr["SOURCE_P14_NATIVE_M5_BASELINE"]
  bsn=nat["original_p14_net_pct"]
  for rule in RULES:
   experiment=rr[rule]
   if experiment["P14ModelStatus"]!=nat["P14ModelStatus"]:
    raise ValueError("P19_NATIVE_PRICE_STATUS_INCONSISTENT")
   if experiment["original_p14_net_pct"]!=bsn:
    raise ValueError("P19_SOURCE_NATIVE_BASELINE_NOT_PARITY")
   triggered=experiment["scenario_exit_type"]=="FIRST_NEXT_POSITIVE_M5"
   if triggered:
    if not 0<int(experiment["scenario_exit_m5_open_ts"])<int(experiment["originalP14M5ExitTs"]):
     raise ValueError("P19_SOURCE_STOP_PRIORITY_NOT_PRESERVED")
   for fraction in FRACTIONS:
    for slip in SLIPS:
     if bsn=="":
      status="SOURCE_ENTRY_NOT_PRICE_WITNESSED"
      model_net=src=None
     else:
      status="SOURCE_PRICE_PROXY_OBSERVED"
      src=float(bsn)
      full=float(experiment["scenario_net_pct"])
      # Both src and full carry the same 10/30bps cost already.
      model_net=(1-fraction)*src+fraction*full-fraction*slip/100
     long.append({
      "period":period,"id":case,
      "sourceEntryTs":int(experiment["sourceEntryTs"]),
      "sourceNativeWin30":experiment["sourceNativeWin30"]=="True",
      "originalSourceLossCategory":experiment["lossCategory"],
      "sourceNativeModelStatus":experiment["P14ModelStatus"],
      "rule":rule,"partialCloseFraction":fraction,
      "feeBps":fee,"earlyExitAdditionalSlippageBps":slip,
      "nativeSourceCaseOutcomeWin30":experiment["sourceNativeWin30"]=="True",
      "originalP14SourceExitTs":int(experiment["originalP14M5ExitTs"]) if experiment["originalP14M5ExitTs"] else None,
      "researchEarlyCloseM5Ts":int(experiment["scenario_exit_m5_open_ts"]) if triggered else None,
      "researchPartialTriggered":triggered and fraction>0,
      "status":status,
      "source_native_net_pct":src,"net_pct":model_net,
      "sourcePriceProxyExecutionNotSignedFill":True,
      "residualSTOPStateRecomputedAfterPartial":False,
      "sourceNaturalTradeIntentPreserved":True,
     })
 if len(long)!=N*len(RULES)*len(FRACTIONS)*len(FEES)*len(SLIPS):
  raise ValueError("P19_3180_CASES_NOT_COMPLETE")
 groups=[]
 for rule in RULES:
  for f in FRACTIONS:
   for fee in FEES:
    for slip in SLIPS:
     case=[x for x in long if x["rule"]==rule and
           x["partialCloseFraction"]==f and
           x["feeBps"]==fee and x["earlyExitAdditionalSlippageBps"]==slip]
     if len(case)!=53:raise ValueError("P19_SCENARIO_NOT_53")
     groups.append({"rule":rule,"partialCloseFraction":f,
                    "feeBps":fee,"earlyExitAdditionalSlippageBps":slip,
                    **metric(case)})
 # Freeze algebraic consistency: f=0 -> SOURCE, f=1 and no new slip -> exact P18 full-price.
 for (period,case,fee),rr in history.items():
  for rule in RULES:
   src=float(rr["SOURCE_P14_NATIVE_M5_BASELINE"]["original_p14_net_pct"]) if rr["SOURCE_P14_NATIVE_M5_BASELINE"]["original_p14_net_pct"] else None
   full=float(rr[rule]["scenario_net_pct"]) if rr[rule]["scenario_net_pct"] else None
   for f in FRACTIONS:
    x=next(z for z in long if z["period"]==period and z["id"]==case and
           z["feeBps"]==fee and z["rule"]==rule and
           z["partialCloseFraction"]==f and z["earlyExitAdditionalSlippageBps"]==0)
    if src is None:
     if x["net_pct"] is not None:raise ValueError("P19_FILL_FALSELY_CREATED")
    else:
     if abs(x["net_pct"]-((1-f)*src+f*full))>1e-10:
      raise ValueError("P19_CASHFLOW_FRACTION_RECONCILIATION_FAIL")
 sample={}
 for rule in RULES:
  for fee in FEES:
   x={f:next(r for r in groups if r["rule"]==rule and
             r["feeBps"]==fee and r["earlyExitAdditionalSlippageBps"]==0 and
             r["partialCloseFraction"]==f) for f in FRACTIONS}
   base=x[0.0]["scenarioMeanNetPctConditional"]
   full=x[1.0]["scenarioMeanNetPctConditional"]
   if not full<base:
    raise ValueError("P19_UNEXPECTED_FULL_EXIT_NOT_LOWER_MEAN_RESEARCH_REEVALUATION_NEEDED")
   for f in FRACTIONS:
    predicted=(1-f)*base+f*full
    if abs(predicted-x[f]["scenarioMeanNetPctConditional"])>1e-9:
     raise ValueError("P19_ALGEBRAIC_BOUND_NOT_REPRODUCED")
   sample[f"{rule}_{fee}bps"]={"nativeMean":base,"fullExitMean":full,
                    "slopePerFraction":full-base,
                    "anyFixedFractionCanImproveMean":False}
 result={
  "schema":"prism7-p19-btc-mfe3-fixed-partial-cashflow-all-53-natural-intents/v1",
  "pinnedRuntimeSha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "p18SourceScenarioSha256":hashlib.sha256(args.p18_scenarios.read_bytes()).hexdigest(),
  "sourceNaturalIntents":53,
  "expectedCompleteScenarioRows":3180,
  "rules":list(RULES),"fractions":list(FRACTIONS),
  "feesBps":list(FEES),"earlyExitSlipBps":list(SLIPS),
  "outcomes":groups,
  "negativeFixedFractionAlgebraicProofByRuleAndCost":sample,
  "limitations":[
   "This is a linear residual PnL cashflow split, not native runtime execution state regeneration after partial fills.",
   "Native SOURCE winner/loser labels and original P18 BTC trigger results are historically observed; not unseen OOS.",
   "Fixed fraction early takes profit only if already precommitted P18 buyer-flow signal fired before P14 native stop.",
   "SOURCE natural intents 53 preserved, observed positive prints subset 52; missing one entry not counted in wins.",
   "No signed owner fills, impact, second-leg queue, funding, shared risk, gross, or compound DD.",
  ],
 }
 args.out_summary.parent.mkdir(parents=True,exist_ok=True)
 args.out_summary.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
 with args.out_ledger.open("w",encoding="utf-8",newline="") as f:
  w=csv.DictWriter(f,fieldnames=list(long[0]));w.writeheader();w.writerows(long)
 print("PRISM7_P19_PRECOMMITTED_FRACTION_3180_CASHFLOW_PASS")
 for rule in RULES:
  print("RULE",rule)
  for f in FRACTIONS:
   r=next(x for x in groups if x["rule"]==rule and x["feeBps"]==30
          and x["earlyExitAdditionalSlippageBps"]==0 and x["partialCloseFraction"]==f)
   print("  FRACTION",f,"WINS",r["scenarioWins"],"MEAN",round(r["scenarioMeanNetPctConditional"],6),
    "PF",round(r["scenarioProfitFactorConditional"],6),"SAVED_LOSS",r["sourceLosersNowWin"],
    "ORIGINAL_WINNER_DELTA",round(r["originalWinnerTotalPnLDeltaPct"],4))
 print("OUT",args.out_summary,args.out_ledger)
if __name__=="__main__":main()
