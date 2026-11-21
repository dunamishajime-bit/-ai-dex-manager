#!/usr/bin/env python3
"""PRISM VI: adverse executable-fill stress of print-touched SHORT limit model.

Assume the executed market order is NOT necessarily filled just because
historical high printed at or above the hypothetical SELL limit. Stress:
 (i) first candle must penetrate limit by 0/10/25/50bps,
 (ii) adverse selection: all historical losers fill, but only 100/75/50/25%
      of historical winners fill, with scaled positive payoff mass.
These are deliberately hypothetical pessimistic bounds, NOT actual fill
probabilities, and even penetration does not prove venue queue priority.

Evaluate ORIGINAL 53 natural signals in denominator. Never optimize a
premium/TTL from this already observed dataset into live trading.
"""
from __future__ import annotations
import json,math,statistics
from pathlib import Path
from collections import Counter
OUT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
def read(p):return json.loads((OUT/p).read_text(encoding="utf8"))
original=read("PRISM6_PENGU_V20_ALL53_DELAY_NATIVE_REPLAY.json")
limit=read("PRISM6_PENGU_V20_SELL_LIMIT_53X9_NATIVE_PRICE_REPLAY.json")
source=read("PRISM6_PENGU_V20_SELL_LIMIT_53X9_PRINT_TOUCH_QUEUE.json")
assert original["originalNativeExactExitParity"]==53
assert len(limit["events"])==477
assert len(source["events"])==477
orig={(e["period"],e["sourceOriginalId"]):e for e in original["events"] if e["delayHours"]==0}
assert len(orig)==53
trace={(e["period"],e["sourceOriginalId"],e["limitPremium"],e["limitTTLHours"]):e for e in source["events"]}
assert len(trace)==477
rows=limit["events"]
STEPS_BPS=(0,10,25,50)
ALPHAS=(1.0,.75,.5,.25)
def ci(w,n):
 if not n:return None
 z=1.95996398454;p=w/n;d=1+z*z/n;m=(p+z*z/(2*n))/d
 r=z*math.sqrt((p*(1-p)/n)+(z*z/(4*n*n)))/d
 return [round(100*(m-r),2),round(100*(m+r),2)]
study=[]
for period in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV","ALL_SEEN"):
 for premium in source["premiums"]:
  for ttl in source["ttlHours"]:
   q=[x for x in rows if (period=="ALL_SEEN" or x["period"]==period)
     and x["limitPremium"]==premium and x["limitTTLHours"]==ttl]
   if not q:continue
   for cost in (10,30):
    base=[orig[(x["period"],x["sourceOriginalId"])][f"cost{cost}NetReturn"] for x in q]
    for minPen in STEPS_BPS:
     eligible=[]
     for x in q:
      event=trace[(x["period"],x["sourceOriginalId"],x["limitPremium"],x["limitTTLHours"])]
      if x["observedTouch"]!=event["historical_print_touches_limit"]:
       raise ValueError("SOURCE_TOUCH_NOT_MATCH")
      native=x["nativeRepriced"]
      if native is None:continue
      pen=event["first_touch_m5_high_above_limit_pct"]*100 # pct -> bps
      if pen+1e-7<minPen:continue
      eligible.append(native[f"cost{cost}NetReturn"])
     positive=[x for x in eligible if x>0]
     negative=[x for x in eligible if x<=0]
     for alpha in ALPHAS:
      pos=sum(positive)*alpha
      neg=sum(-x for x in negative)
      if neg<0:raise ValueError("BAD_NEGATIVE_LOSS")
      pf=pos/neg if neg>0 else None
      meanGrossEquivalent=(pos-neg)/len(q)
      # Effective modeled P(win) when positive fills are selected with
      # only alpha of their mass: it is NOT an observed win rate.
      expectedCount=len(negative)+alpha*len(positive)
      worstWins=alpha*len(positive)
      study.append({
       "period":period,"premiumPct":round(100*premium,4),"ttlHours":ttl,
       "costBps":cost,"minFirstTouchPenetrationBps":minPen,
       "conditionalWinningPrintParticipation":alpha,
       "naturalSignals":len(q),
       "originalNaturalPriceWinRatePct":round(100*sum(x>0 for x in base)/len(q),2),
       "originalNaturalMeanNetPct":round(100*statistics.mean(base),5),
       "eligibleM5PriceTouches":len(eligible),
       "eligibleM5PriceTouchFraction":round(len(eligible)/len(q),4),
       "positiveTouches":len(positive),"negativeTouches":len(negative),
       "rawTouchedWinRatePct":round(100*len(positive)/len(eligible),4) if eligible else None,
       "rawWilson95TouchWinPct":ci(len(positive),len(eligible)),
       "expectedFilledTouchesUnderAdverseSelection":round(expectedCount,3),
       "stressedWinShareGivenFillPct":round(100*worstWins/expectedCount,4) if expectedCount else None,
       "stressMeanPctPerOriginalSignal":round(100*meanGrossEquivalent,5),
       "stressPricePF":round(pf,4) if pf is not None else None,
       "status":"ADVERSE_SELECTION_HYPOTHESIS_NOT_VERIFIED_EXECUTION"})
assert len(study)==4*3*3*2*4*4
first=[x for x in study if x["period"]=="ALL_SEEN" and x["premiumPct"]==.5
  and x["ttlHours"]==1 and x["costBps"]==30]
print("STRICT_LIMIT_RESEARCH_STRESS_N",len(study),flush=True)
for x in first:
 print("STRESS",x["minFirstTouchPenetrationBps"],x["conditionalWinningPrintParticipation"],
  "N",x["eligibleM5PriceTouches"],"TOUCHED_WINS",x["positiveTouches"],
  "WIN_SHARE",x["stressedWinShareGivenFillPct"],
  "MEAN",x["stressMeanPctPerOriginalSignal"],"PF",x["stressPricePF"],flush=True)
(OUT/"PRISM6_PENGU_V20_LIMIT_ADVERSE_FILL_STRESS_SUMMARY.json").write_text(
 json.dumps({"schema":"prism6-pengu-short-v20-passive-limit-order-fill-stress/v1",
  "naturalSignals":53,"limitConfigN":9,"costModelBps":[10,30],
  "sourceNativeExitModel":True,"assumedSignedVenueExecution":False,
  "penetrationSensitivity":STEPS_BPS,"adverseWinnerFillMassFractions":ALPHAS,
  "results":study,"limitations":[
   "High >= limit is a proxy printed trade, not proof of the hypothetical SELL order getting a queue fill",
   "First-touch penetration of the limit is an extra printed-price heuristic, not venue market depth",
   "Winning order fills may be less likely than losing order fills; adverse fractions test this asymmetry",
   "Fractional winning fill mass is a deterministic payout sensitivity, not an observed execution forecast",
   "Research 53 event sample is small and all dates have already been viewed; do not tune from grid",
   "Real maker/taker fees, spread, queue priority, order placement constraints, funding and risk Gross differ",
   "No concurrent open-position or portfolio-level DD test; not eligible for Production"
  ]},ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("ADVERSE_FILL_MODEL_GUARD_RESEARCH_ONLY",flush=True)
