#!/usr/bin/env python3
from pathlib import Path
import json,hashlib,math
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P="Y06_NATIVE_LIFECYCLE_M5_AB_"
cases={
"BASELINE_PINNED":"VPS_DD_V4_SORT_PINNED_STOCK15_20261110",
"3GATE":"VPS_DD_COMBINED_IDLEJUP_PENGUV8_Q102FET_RET14_STOCK15_20261110",
"4GATE_IDLE_TAO":"VPS_DD_COMBINED_4GATE_IDLETao_STOCK15_20261110",
"3GATE_V4Y_FAMILY_CAP_0P6":"VPS_DD_3GATE_V4RECY_FAMILY_CAP_0P6_STOCK15_20261110",
"3GATE_V4Y_FAMILY_CAP_0P9":"VPS_DD_3GATE_V4RECY_FAMILY_CAP_0P9_STOCK15_20261110",
"3GATE_V4Y_FAMILY_CAP_1P2":"VPS_DD_3GATE_V4RECY_FAMILY_CAP_1P2_STOCK15_20261110",
"3GATE_DYNAMIC_DD12":"VPS_DD_3GATE_DYNAMIC_CONCENTRATION_0P12_STOCK15_20261110",
"BEST_BALANCED_HARD_CAP":"VPS_DD_3GATE_STATIC_V4Y06_DYNAMIC_FRAGILE12_STOCK15_20261110",
"STATIC_FRAGILE_2P0":"VPS_DD_3GATE_V4Y06_FRAGILE_CAP_2P0_STOCK15_20261110",
"CLIPPED_CAPACITY":"VPS_DD_3GATE_CLIPPED_CAPACITY_V4Y06_FRAGILE12_STOCK15_20261110",
"DYNAMIC_FRAGILE_1P5":"VPS_DD_3GATE_STATIC_V4Y06_DYNAMIC_FRAGILE_1P5_STOCK15_20261110",
"DYNAMIC_FRAGILE_1P0":"VPS_DD_3GATE_STATIC_V4Y06_DYNAMIC_FRAGILE_1P0_STOCK15_20261110",
"3GATE_PLUS_PENGU_V20_GATE":"VPS_DD_COMBINED_3GATE_PLUS_PENGUV20_STOCK15_20261110",
}
rows={}
for name,folder in cases.items():
 d=R/folder
 if not d.exists():continue
 z={}
 for cost in (10,30):
  p=d/f"{P}{cost}BPS_SUMMARY.json"
  if not p.exists():continue
  a=json.loads(p.read_text(encoding="utf8"))
  z[str(cost)]={"finalJpy":a["final_compounded_jpy"],"ddPct":a["max_hourly_dd_pct"],"winRatePct":a["win_rate_pct"],
                "pf":a["profit_factor"],"fills":a["modeled_fills"],"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}
 if len(z)==2:rows[name]=z
base=rows["BASELINE_PINNED"]
for name,z in rows.items():
 z["profitAboveBaselineBoth"]=all(z[str(c)]["finalJpy"]>=base[str(c)]["finalJpy"] for c in (10,30))
 z["ddImprovedBoth"]=all(z[str(c)]["ddPct"]>base[str(c)]["ddPct"] for c in (10,30))
 z["meetsDD20Both"]=all(z[str(c)]["ddPct"]>=-20 for c in (10,30))
 z["meetsWR70Both"]=all(z[str(c)]["winRatePct"]>=70 for c in (10,30))
 z["worstAbsDD"]=max(abs(z["10"]["ddPct"]),abs(z["30"]["ddPct"]))
 z["deltaFinalVsBaselinePct"]={str(c):(z[str(c)]["finalJpy"]/base[str(c)]["finalJpy"]-1)*100 for c in (10,30)}
eligible=[(n,z) for n,z in rows.items() if z["profitAboveBaselineBoth"] and n!="BASELINE_PINNED"]
best=min(eligible,key=lambda kv:(kv[1]["worstAbsDD"],-min(kv[1]["10"]["winRatePct"],kv[1]["30"]["winRatePct"])))
# pareto across worstDD (lower), min cost-case final/baseline (higher), min WR (higher)
front=[]
for n,z in rows.items():
 if n=="BASELINE_PINNED":continue
 quality=(z["worstAbsDD"],min(z["10"]["finalJpy"]/base["10"]["finalJpy"],z["30"]["finalJpy"]/base["30"]["finalJpy"]),min(z["10"]["winRatePct"],z["30"]["winRatePct"]))
 dominated=False
 for m,w in rows.items():
  if m in (n,"BASELINE_PINNED"):continue
  q=(w["worstAbsDD"],min(w["10"]["finalJpy"]/base["10"]["finalJpy"],w["30"]["finalJpy"]/base["30"]["finalJpy"]),min(w["10"]["winRatePct"],w["30"]["winRatePct"]))
  if q[0]<=quality[0] and q[1]>=quality[1] and q[2]>=quality[2] and q!=quality:dominated=True;break
 if not dominated:front.append(n)
out={"status":"RESEARCH_FRONTIER_NOT_PRODUCTION_CERTIFIED","baseline":"BASELINE_PINNED",
     "bestProfitPreservingWorstDD":best[0],"bestWorstAbsDDPct":best[1]["worstAbsDD"],
     "paretoFront":front,"cases":rows,
     "conclusions":{
      "dd20BothReached":any(z["meetsDD20Both"] for z in rows.values()),
      "wr70BothReached":any(z["meetsWR70Both"] for z in rows.values()),
      "profitPreservingDD20Reached":any(z["meetsDD20Both"] and z["profitAboveBaselineBoth"] for z in rows.values()),
      "note":"No tested candidate reaches maxDD<=20% in both cost cases or win-rate>=70% in both. BEST_BALANCED_HARD_CAP has 10bps -25.19%, 30bps -28.90% and stays above baseline final equity in both cost cases; 3GATE_DYNAMIC_DD12 has the same worst-cost DD 28.90% with higher 30bps/10bps wealth but 10bps DD -28.61%. Static 2.0 fragile cap lowers DD further but sacrifices baseline profit."
     },
     "limitations":["Integrated model still contains V52 price-model proxy and residual coverage gaps; not full Production parity",
                    "V4 historical V2 candidate population contains retrospective filtering; new gates are research counterfactuals",
                    "Final equity is reported as accounting, not used as a fixed profit target",
                    "Candidate selection used multiple research experiments; independent future validation remains mandatory before acceptance"]}
p=R/"DIRECTION_RESEARCH_20261109"/"LATEST_RESEARCH_FRONTIER_20261110.json"
p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("BEST",best[0],best[1]["worstAbsDD"])
for n,z in sorted(rows.items(),key=lambda kv:kv[1]["worstAbsDD"]):
 print(n,"DD",round(z["10"]["ddPct"],2),round(z["30"]["ddPct"],2),"FINAL",round(z["10"]["finalJpy"]),round(z["30"]["finalJpy"]),"WR",round(z["10"]["winRatePct"],2),round(z["30"]["winRatePct"],2),"PROFIT_KEEP",z["profitAboveBaselineBoth"])
print("PARETO",front)
print("FILE",p)
