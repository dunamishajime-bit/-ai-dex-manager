#!/usr/bin/env python3
"""Research only: frozen 61-entry nominal STOP-at-risk grid; not a live or full portfolio BT."""
import argparse, json
from pathlib import Path
from idle_short_cluster_guard_frozen_replay_20261019 import load, replay, sha256

ROOT=Path(__file__).resolve().parents[1]
SOURCES=["research/idle_priority_61_intents.json",
         "research/idle_priority_61_target_net.json",
         "research/idle_priority_393_generic_candidate_features.csv"]
BUDGETS=[10.,12.5,15.,17.5,20.,22.5]
GAPS=[0.,1.,2.]
WALLET=61.82
LEGS=[("JUPUSDT",22*0.2803),("TAOUSDT",.241*256.08),("TIAUSDT",103*.5947)]

def analyze():
    rows=load(ROOT)
    base=replay(rows)
    cases=[]
    for gap in GAPS:
        for b in BUDGETS:
            # Gross proxy equals risk-budget / (static 10% initial STOP + stress gap).
            result=replay(rows,gross_cap=b/(10+gap))
            ex=result["excluded"]
            cases.append({"budget_pct":b,"gap_pct":gap,"max_gross_proxy":round(b/(10+gap),6),
                          "trades":result["10bps"]["trades"],"wins":result["10bps"]["wins"],
                          "pf10":result["10bps"]["pf"],
                          "sum10":result["10bps"]["weighted_sum_return_pct"],
                          "sum20":result["20bps"]["weighted_sum_return_pct"],
                          "sum30":result["30bps"]["weighted_sum_return_pct"],
                          "historical_max_gross":result["highest_open_gross"],
                          "max_proxy_initial_stop_risk_pct":round(result["highest_open_gross"]*(10+gap),4),
                          "excluded_winners":sum(r["gross_weighted_10bps_return_pct"]>0 for r in ex),
                          "excluded_losers":sum(r["gross_weighted_10bps_return_pct"]<0 for r in ex),
                          "excluded":ex})
    live=[]
    for gap in GAPS:
        leg_risk=[(name, notion*(10+gap)/100) for name,notion in LEGS]
        decisions=[]
        for b in BUDGETS:
            for order in [(0,1,2),(0,2,1)]:
                risk=0; allowed=[]; blocked=[]
                for index in order:
                    name,value=leg_risk[index]
                    if (risk+value)/WALLET*100<=b+1e-9:
                        risk+=value;allowed.append(name)
                    else:blocked.append(name)
                decisions.append({"budget_pct":b,"order":[LEGS[i][0] for i in order],
                                  "allowed":allowed,"blocked":blocked,
                                  "admitted_nominal_risk_pct":round(risk/WALLET*100,4)})
        live.append({"stress_gap_pct":gap,
                     "all_notionals_usdt":round(sum(n for _,n in LEGS),6),
                     "all_three_nominal_stop_risk_usdt":round(sum(v for _,v in leg_risk),6),
                     "all_three_nominal_stop_risk_pct":round(sum(v for _,v in leg_risk)/WALLET*100,4),
                     "decisions":decisions})
    return {
      "status":"RESEARCH_PROXY_ONLY_NOT_SIGNED_STOP_NOT_INTEGRATED_BT",
      "head_sha":"4d422b5f54c6e0efb349d1906cf7d7168c3bd800",
      "source_hashes":{s:sha256(ROOT/s) for s in SOURCES},
      "base":base["10bps"],"historical":cases,
      "oct19_scenario":{"wallet_usdt_approx":WALLET,"reported_pre_entry_unrealized_usdt":.055,
                        "signed_stop_prices_unknown":True,"trade_lineage_pending":True,
                        "legs_initial_notional_usdt":{n:round(v,6) for n,v in LEGS},
                        "stress":live},
      "limitations":["Frozen historical accepted-intent replay; no alternate baseline re-admission",
                     "Risk proxy uses original notional and assumed 10% price STOP, not actual resident STOP or live mark",
                     "No actual fees, slippage distribution, partial fills or correlation-adjusted stress",
                     "No historical locked-profit, opening/closing hourly MTM marks, current-V4 portfolio DD",
                     "Oct-19 event illustrative only, not venue-confirmed order lineage"]
    }

if __name__=="__main__":
    pa=argparse.ArgumentParser()
    pa.add_argument("--output",type=Path)
    args=pa.parse_args()
    d=analyze()
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"status":d["status"],"base":d["base"],
       "cases":[{k:v[k] for k in ("budget_pct","gap_pct","trades","wins","sum10",
                                 "historical_max_gross","excluded_winners","excluded_losers")}
                for v in d["historical"]],
       "oct19":[{"gap":x["stress_gap_pct"],"loss_pct":x["all_three_nominal_stop_risk_pct"]}
                for x in d["oct19_scenario"]["stress"]]},ensure_ascii=False))
