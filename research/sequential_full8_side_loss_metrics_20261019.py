#!/usr/bin/env python3
"""Post-process separate sequential full8 scenario ledgers into per-side losses.
Output only; never changes entry eligibility or LIVE. Historical settlement PnL
is unit-specific, so normalize per trade by contemporaneous entry equity.
"""
from __future__ import annotations
from collections import defaultdict,Counter
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/"research_runs/long_two_axis_latest_full8_20261019"
RES=ROOT/"docs/research/results/long-loss-research-20261019"
H=3600000
def ledger(policy,cost):
 f=SRC/policy/f"{cost}bps"/"cases/V2_M150_D05_CORE_NATIVE/runs"/f"PRICE_MODEL_{cost}BPS/portfolio-trades.jsonl"
 if not f.is_file():raise FileNotFoundError(str(f))
 return [json.loads(s) for s in f.read_text("utf8").splitlines() if s.strip()]
def losses(rows):
 d=defaultdict(list)
 for x in rows:d[x["strategy_id"]+"_"+x["side"]].append(x)
 out={}
 for name,rs in sorted(d.items()):
  win=[x for x in rs if float(x["total_pnl_jpy"])>0]
  los=[x for x in rs if float(x["total_pnl_jpy"])<0]
  denom=lambda x:float(x["entry_equity"]) if float(x["entry_equity"])>0 else 1.
  out[name]={"n":len(rs),"wins":len(win),"losses":len(los),
    "negative_realized_sum_pnl_units":round(sum(float(x["total_pnl_jpy"]) for x in los),4),
    "positive_realized_sum_pnl_units":round(sum(float(x["total_pnl_jpy"]) for x in win),4),
    "sum_negative_wallet_contributions_pp":round(100*sum(float(x["total_pnl_jpy"])/denom(x) for x in los),4),
    "worst_trade_wallet_pct":round(100*min((float(x["total_pnl_jpy"])/denom(x) for x in los),default=0),4),
    "exit_reasons":dict(Counter(x["exit_reason_actual"] for x in rs))}
 return out
def main():
 chain=RES/"SEQUENTIAL_FULL8_ACCEPTED_CHAIN_20261019.json"
 if not chain.is_file():raise FileNotFoundError(chain)
 data=json.loads(chain.read_text('utf8'))
 summary={}
 for stage in data["stages"]:
  for trial in stage["trials"]:
   policy=trial["policy"]
   costs={}
   for cost in (10,30):
    costs[str(cost)]=losses(ledger(policy,cost))
   summary[policy]=costs
 for cost in (10,30):
  summary.setdefault("LATEST_20261017_BASELINE",{})[str(cost)]=losses(ledger("LATEST_20261017_BASELINE",cost))
 report={"status":"PER_SIDE_LOSS_MEASURES_FOR_CAUSAL_FROZEN_EIGHT_STRATEGY_CUMULATIVE_TRIALS",
  "selection_manifest":str(chain),"values":summary}
 out=RES/"SEQUENTIAL_SIDE_LOSS_METRICS_20261019.json"
 out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding='utf8')
 print("WRITTEN",out,"policies",len(summary))
 for stage in data["stages"]:
  print("STAGE",stage["stage"],"TARGET",stage["side_scope"],
   "RESEARCH_CUMULATIVE",stage["output_cumulative_ids"])
  target=stage["side_scope"].replace(" ","_")
  if target=="HYPE_LONG":target="HYPE_LONG_LONG"
  for trial in stage["trials"]:
   name=trial["policy"]
   for cost in (10,30):
    a=summary[name][str(cost)].get(target)
    old=summary["LATEST_20261017_BASELINE"][str(cost)].get(target)
    if a and old:
     print("CASE",name,"cost",cost,"DD",trial["metrics"][cost//20]["full8_max_dd_pct"],
       "saved_loss_pp",round(a["sum_negative_wallet_contributions_pp"]-old["sum_negative_wallet_contributions_pp"],4),
       "worst_loss_diff",round(a["worst_trade_wallet_pct"]-old["worst_trade_wallet_pct"],4),
       "old_losses",old["losses"],"new_losses",a["losses"])
if __name__=="__main__":main()
