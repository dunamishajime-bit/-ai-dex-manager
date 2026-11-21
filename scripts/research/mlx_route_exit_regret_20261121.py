#!/usr/bin/env python3
"""Matched-signal route-level exit regret attribution. Evaluation only (uses outcomes).
This is not a future-data-free *decision* rule, not a causal portfolio A/B estimate.
"""
from pathlib import Path
import csv,statistics,json,collections,math
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=Path(__file__).parent
NAMES=[
"DD_MLX_COHERENT_ATR_ONLY_20261121",
"DD_MLX_COHERENT_FULL_LAYER_20261121",
"DD_MLX_COHERENT_RISK_SIZED_20261121",
"DD_MLX_COHERENT_PORTFOLIO_SIZED_20261121",
"DD_MLX_ABLATION_Q102_ONLY_20261121",
"DD_MLX_ABLATION_V4_ONLY_20261121",
"DD_MLX_ABLATION_IDLE_ONLY_20261121",
"DD_MLX_ABLATION_PENGU_ONLY_20261121",
"DD_MLX_ABLATION_FET_ONLY_20261121",
"DD_MLX_ABLATION_NO_V4_20261121",
]
BASE=ROOT/"DD_MLX_COHERENT_CONTROL_20261121"
def load(folder,fee):
 path=next(folder.glob(f"*{fee}BPS_FILLS.csv"))
 with path.open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
def metric(row):
 return float(row["net_pnl_jpy"])/float(row["notional_jpy"])
result={"schema":"disdex-mlx-matched-route-exit-evaluation/v1",
"caveats":["Only matched signals admitted to both path-dependent portfolio simulations are compared.",
"The evaluation uses future outcome labels, but the exit decision algorithms do not.",
"Different gross sizing and capital trajectories prevent interpreting summed normalized deltas as real portfolio return.",
"Counts below 10 per route are descriptive only.","Prices are modeled, not venue-executed."],
"cases":{}}
for fee in (10,30):
 original=load(BASE,fee)
 original_by={z["source_signal_id"]:z for z in original}
 for name in NAMES:
  case=ROOT/name
  if not (case/"RUN_MANIFEST.json").exists():continue
  rows=load(case,fee)
  total_ml=sum(z["exit_model_reason"].startswith("MLX_") for z in rows)
  groups=collections.defaultdict(list)
  miss=0;unmatched=0
  for row in rows:
   if not row["exit_model_reason"].startswith("MLX_"):continue
   sid=row["source_signal_id"]
   base=original_by.get(sid)
   if base is None:unmatched+=1;continue
   if any(row[z]!=base[z] for z in ("strategy","symbol","side","route","entry_utc")):
    miss+=1;continue
   delta=metric(row)-metric(base)
   groups[(row["strategy"],row["route"])].append(delta)
  dd={}
  for (runner,route),values in sorted(groups.items()):
   n=len(values)
   dd[f"{runner}|{route}"]={"n":n,"mean_normalized_pnl_delta_pct":100*statistics.mean(values),
        "median_pct":100*statistics.median(values),
        "fraction_early_exit_better":sum(v>0 for v in values)/n,
        "fraction_worse":sum(v<0 for v in values)/n,
        "worst_delta_pct":100*min(values),"best_delta_pct":100*max(values)}
  key=f"{name}|{fee}bps"
  result["cases"][key]=dict(modeled_early_exits=total_ml,
       matched_early_exits=sum(len(v) for v in groups.values()),
       missing_in_baseline=unmatched,mismatched_signal_identity=miss,
       per_route=dd)
  print("EVALUATED",key,"early",total_ml,"matched",result["cases"][key]["matched_early_exits"],
       "unmatched",unmatched,"routes",len(dd),flush=True)
dest=OUT/"MLX_MATCHED_ROUTE_EXIT_ATTRIBUTION.json"
dest.write_text(json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True,allow_nan=False)+"\n",encoding="utf-8")
print("SAVED",dest,"CASES",len(result["cases"]),flush=True)
