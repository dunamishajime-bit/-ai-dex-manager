#!/usr/bin/env python3
"""PRISM VI staged SHORT V20 exposure: hold a starter, add only on causal followthrough.

A research alternative to either deleting signals or changing native STOPs.

- Every original natural SHORT signal opens a 25% or 50% starter at t0.
- At t+3H or +6H, add the unused 75%/50% *only* when the fully
  completed positive-volume M5 tape confirms a price/flow continuation.
- The native source-pinned pure SHORT_V20 position engine separately exits
  starter and add-on virtual legs; 0h/3h/6h prices and exits are replayed
  as independent counterfactual models (53x3 original, no source reuse).
- If the original leg had already exited by confirmation time, add is forbidden.
- No native win labels are used to make the decision, and all predeclared
  conditions are reported (never silently select best parameter post hoc).
- A single exchange position cannot necessarily have independent resident
  stops for two virtual legs; this is research, never an operational plan.
"""
from __future__ import annotations
import csv,json,statistics,math
from pathlib import Path
from collections import Counter
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
native=json.loads((ROOT/"PRISM6_PENGU_V20_ALL53_DELAY_NATIVE_REPLAY.json").read_text(encoding="utf8"))
assert native["sourceShortNaturalEvents"]==53 and native["originalNativeExactExitParity"]==53
events=native["events"]
idx={(e["period"],e["sourceOriginalId"],e["delayHours"]):e for e in events}
assert len(idx)==265
with (ROOT/"PRISM6_PENGU_V20_M5_53_EARLY_CAUSAL_FORENSICS.csv").open(encoding="utf-8-sig",newline="") as f:
 early=list(csv.DictReader(f))
periodnames={"PRE_2025_AUG_SEP":"PRE_2025_AUG_SEP",
             "BASE_2025_2026":"BASE_2025_2026",
             "POST_2026_OCT_NOV":"POST_2026_OCT_NOV"}
eidx={(x["period"],x["source_trade_id"],int(x["checkpointH"])):x for x in early}
assert len(eidx)==53*4
POLICIES={
 "FIXED_3H_ALL_ACTIVE":3,
 "BUYER_ABSENCE_3H":3,
 "SIX_HOUR_DOWNTREND_PRINT":6,
 "SIX_HOUR_CONFIRMED_SELLERS":6,
 "SIX_HOUR_ATR_LIKE_FAVORABLE_PRICE":6,
 "SIX_HOUR_LOW_REBOUND_RISK":6,
}
def trigger(rule,x):
 if x["status"]!="ASOF_COMPLETED":return False
 price=float(x["last_close_vs_entry_pct"])
 mfe=float(x["max_favorable_pct"])
 adverse=float(x["max_adverse_pct"])
 buyer=float(x["taker_buy_fraction"])
 btc=float(x["btc_return_checkpoint"])
 if rule=="FIXED_3H_ALL_ACTIVE":return True
 if rule=="BUYER_ABSENCE_3H":return price<=-.3 and buyer<=.52 and btc<=.005
 if rule=="SIX_HOUR_DOWNTREND_PRINT":return price<=-.3 and mfe>=.8
 if rule=="SIX_HOUR_CONFIRMED_SELLERS":return price<=-.5 and mfe>=1 and buyer<=.52 and btc<=.005
 if rule=="SIX_HOUR_ATR_LIKE_FAVORABLE_PRICE":return price<=-1.0 and mfe>=1.5 and adverse<=2.0
 if rule=="SIX_HOUR_LOW_REBOUND_RISK":return price<=-.5 and buyer<=.55 and adverse<=2.5 and btc<=.005
 raise ValueError("UNKNOWN_POLICY")
candidates=sorted({(e["period"],e["sourceOriginalId"]) for e in events if e["delayHours"]==0})
assert len(candidates)==53
records=[]
for period,orig_id in candidates:
 base=idx[(period,orig_id,0)]
 for starter in (.25,.5):
  for rule,whenH in POLICIES.items():
   check=eidx[(period,orig_id,whenH)]
   if int(check["entryTs"])!=base["entryTs"]:raise ValueError("EARLY_INPUT_SOURCE_TIME_MISMATCH")
   was_open=(base["exitTs"]>base["entryTs"]+whenH*3600000)
   signal=was_open and trigger(rule,check)
   add=idx[(period,orig_id,whenH)] if signal else None
   # A new leg starts only if the original leg was still open at the
   # fully completed bar boundary, *without borrowing future exit data*
   # to decide; native exit status is known as-of the new potential order.
   for fee in (10,30):
    source=base[f"cost{fee}NetReturn"]
    addret=add[f"cost{fee}NetReturn"] if add else None
    blended=starter*source+(1-starter)*(addret if add else 0)
    records.append({"period":period,"trade_id":orig_id,"starter_gross":starter,
      "rule":rule,"checkH":whenH,"costBps":fee,
      "source_0h_net_pct":100*source,"source_0h_win":source>0,
      "stage1_open_at_checkpoint":was_open,"stage2_asof_gate":bool(signal),
      "stage2_entry_ts":add["entryTs"] if add else None,
      "stage2_net_pct":100*addret if addret is not None else None,
      "stage2_native_exit_reason":add["exitReason"] if add else None,
      "sleeves_notional_net_pct":100*blended,
      "sleeves_win":blended>0,
      "unallocated_gross":0 if add else 1-starter,
      "position_virtual_not_production":True})
assert len(records)==53*2*len(POLICIES)*2
def summary(group):
 v=[x["sleeves_notional_net_pct"] for x in group]
 w=sum(z>0 for z in v)
 gain=sum(max(0,z) for z in v)
 loss=sum(max(0,-z) for z in v)
 raw=[x["source_0h_net_pct"] for x in group]
 return {"trades":len(group),"wins":w,"winPct":round(100*w/len(group),3),
  "meanPctOfUnitGross":round(statistics.mean(v),5),
  "pricePF":round(gain/loss,4) if loss else None,
  "originalWins":sum(x["source_0h_win"] for x in group),
  "addedN":sum(x["stage2_asof_gate"] for x in group),
  "originalWinnerFlippedToLoss":sum(x["source_0h_win"] and not x["sleeves_win"] for x in group),
  "originalLoserFlippedToWin":sum(not x["source_0h_win"] and x["sleeves_win"] for x in group),
  "meanIdleGross":round(statistics.mean(x["unallocated_gross"] for x in group),4),
  "originalFullGrossMeanPct":round(statistics.mean(raw),5)}
groups=[]
for period in ["PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV","ALL_SEEN"]:
 for starter in (.25,.5):
  for rule in POLICIES:
   for fee in (10,30):
    a=[x for x in records if (period=="ALL_SEEN" or x["period"]==period)
      and x["starter_gross"]==starter and x["rule"]==rule and x["costBps"]==fee]
    groups.append({"period":period,"starter_gross":starter,"rule":rule,"bps":fee,**summary(a)})
keys=list(dict.fromkeys(k for z in records for k in z))
with (ROOT/"PRISM6_PENGU_V20_STAGED_ENTRY_53_COMPLETE.csv").open("w",encoding="utf-8-sig",newline="") as f:
 w=csv.DictWriter(f,keys);w.writeheader();w.writerows(records)
keys=list(dict.fromkeys(k for z in groups for k in z))
with (ROOT/"PRISM6_PENGU_V20_STAGED_ENTRY_53_ABLATION.csv").open("w",encoding="utf-8-sig",newline="") as f:
 w=csv.DictWriter(f,keys);w.writeheader();w.writerows(groups)
( ROOT/"PRISM6_PENGU_V20_STAGED_ENTRY_53_SUMMARY.json").write_text(
 json.dumps({"schema":"prism6-short-v20-starter-add-on-price-economics/v1",
  "pure_native_original_trade_count":53,"pure_native_source_parity":53,
  "starter_sleeves":[.25,.5],"predeclared_confirmation_rules":POLICIES,
  "cohorts":groups,
  "limitations":[
   "Coin-margined or netted venue positions may not support separate resident stops",
   "Portfolio shared Gross and opportunity cost of unallocated leverage not simulated",
   "No funding/slippage or exchange signed fills; only pinned source modeled exits",
   "This study cannot be treated as independent blind OOS because 2025/08-2026/11 periods were already examined",
   "The 3h/6h checkpoint itself is post-entry market data: valid as-of add decision, NOT a prediction at the original entry",
   "Each added virtual leg is modeled by source pure engine with its own stop and hold; production requires a reconciled stop owner"
  ]},ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
for x in groups:
 if x["period"]=="ALL_SEEN" and x["bps"]==30:
  print("STAGED_ALL",x,flush=True)
print("STAGED_REPLAY_COMPLETE",len(records),"SCENARIOS",len(groups),flush=True)
