#!/usr/bin/env python3
"""Independent integrity checks for the complete research result set. No orders."""
from __future__ import annotations
import csv,datetime as dt,json,math,sys
from collections import Counter,defaultdict
from pathlib import Path

root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\results")
def load(s):return json.loads((root/s).read_text(encoding="utf-8"))
report=load("route_audit_summary.json")
model=load("causal_policy_walkforward_summary.json")
regime=load("route_regime_error_attribution.json")
trace=load("causal_policy_candidate_trace_10_30bps.json")
join=load("accepted_portfolio_shadow_gate_join.json")
assert report["asof_feature_provenance"]["checked_independent_h1_momentum_lookbacks"]==1234
assert report["asof_feature_provenance"]["verified_independent_h1_momentum_lookbacks"]==1234
assert report["asof_feature_provenance"]["mismatch"]==[]
assert report["candidate_count"]==model["observations"]["valid_unique_candidates"]==2892
assert len(report["per_route"])==64
assert model["source_sha256"]["filled_10"]==report["source_sha256"]["fills_10bps"]
assert model["source_sha256"]["filled_30"]==report["source_sha256"]["fills_30bps"]

for fee in ("10","30"):
 cohort=report["runners"][fee]
 assert sum(cohort[s]["n"] for s in ["V4","Q102","PENGU","V52","FET","IDLE","HYPE"])==cohort["ALL"]["n"]
 assert sum(cohort[s]["wins"] for s in ["V4","Q102","PENGU","V52","FET","IDLE","HYPE"])==cohort["ALL"]["wins"]
 assert len(trace[fee])==2892
 assert len(set(x["signal_id"] for x in trace[fee]))==2892
 assert sum(int(x["price_win"]) for x in trace[fee])>=0
 for x in trace[fee]:
  assert 0<=x["online"]["p"]<=1 and x["online"]["route_n"]<=x["online"]["hist_n"]
  assert all(isinstance(y,bool) for y in x["keep"].values())
  # Post-entry outcome is never allowed as a feature in the forecast.
  assert all(y not in x["quality"] for y in ("price_win","net_price_return_pct","exitTs"))
  assert x["price_win"]==(x["net_price_return_pct"]>0)
 # Audit the 24h settled-label embargo independently against preceding signals.
 cohort_source=trace[fee]
 by_strategy=defaultdict(list)
 for index,x in enumerate(cohort_source):
  ts=int(dt.datetime.fromisoformat(x["entry_utc"].replace("Z","+00:00")).timestamp()*1000)
  matured=sum(z["exitTs"]+24*3600000<ts and
   ts-180*86400000<=z["_ts"]<ts for z in by_strategy[x["strategy"]])
  assert matured==x["online"]["hist_n"],(fee,index,x["signal_id"],matured,x["online"]["hist_n"])
  by_strategy[x["strategy"]].append({**x,"_ts":ts})
 for s,vals in join[fee].items():
  assert vals["matched"]+sum(vals["unmatched"].values())==vals["original_fills"]
  assert vals["baseline"]["kept"]==vals["matched"]
  assert vals["baseline"]["portfolio_reexecuted"] is False
  for name in ("triple_countertrend_veto","three_of_four_confirmation","online_route_similarity_70_80","online_similarity_plus_regime"):
   z=vals[name];assert z["kept"]+z["rejected_winners"]+z["rejected_losers"]==vals["matched"]
   assert z["portfolio_reexecuted"] is False
print("COST_COHORT_CORRECTNESS_AND_MATURITY_EMBARGO_PASS",flush=True)

for stat in model["summary"]:
 n=stat["n"];baseline=stat["total_signal_candidates"]
 assert n<=baseline and n+stat["rejected_winners"]+stat["rejected_losers"]==baseline
 assert stat["target_pct"]==(80 if stat["strategy"]=="PENGU" else 70)
 if stat["target_met_wilson95"]:
  assert n>=10 and stat["wilson95pct"][0]>=stat["target_pct"]
assert model["rules"]["no_holdout_selection"]
assert len(model["summary"])==210

assert len(regime["regime_tests"])>0
for x in regime["regime_tests"]:
 assert 0<=x["p_fisher_exploratory"]<=1
 assert 0<=x["bh_fdr_q_exploratory"]<=1
 assert x["a_n"]>=8 and x["b_n"]>=8
assert all(len(x["regime_shift_tests"])<=2 for x in regime["all_route_strata"])
print("ALL_ROUTE_COVERAGE_AND_EXPLORATORY_FDR_PASS",flush=True)
print("RESEARCH_SUMMARY_VERIFIED",json.dumps({
 "fills10":report["runners"]["10"]["ALL"]["n"],
 "fills30":report["runners"]["30"]["ALL"]["n"],
 "candidates":model["observations"]["valid_unique_candidates"],
 "routes":len(report["per_route"]),
 "policies_times_cost_phases":len(model["summary"]),
 "regime_comparisons":len(regime["regime_tests"])},ensure_ascii=False),flush=True)
