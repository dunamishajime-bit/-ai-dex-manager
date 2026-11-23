#!/usr/bin/env python3
import argparse,json,math
from collections import Counter,defaultdict
from pathlib import Path

ap=argparse.ArgumentParser()
ap.add_argument("--root",default="docs/research/results/v12-trail020-20261002/10bps")
a=ap.parse_args()
root=Path(a.root)
tr=[json.loads(x) for x in (root/"portfolio-trades.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
m=json.loads((root/"metrics.json").read_text(encoding="utf-8"))
def stats(rows):
 pn=[float(x.get("modeled_realized_pnl_jpy_at_exit_fx") or x.get("total_pnl_jpy") or 0) for x in rows]
 gp=sum(x for x in pn if x>0);gl=-sum(x for x in pn if x<0)
 return {"trades":len(rows),"wins":sum(x>0 for x in pn),"win_rate":sum(x>0 for x in pn)/len(rows) if rows else 0,
         "profit_factor":gp/gl if gl else math.inf,"pnl_jpy":sum(pn)}
out={"final_equity_jpy":m["final_equity_jpy"],"maximum_mtm_drawdown":m["maximum_mtm_drawdown"],"profit_factor":m["profit_factor"],
     "closed_trades":m["closed_trades"],"by_strategy":{}}
for s in sorted(set(x["strategy_id"] for x in tr)):
 out["by_strategy"][s]=stats([x for x in tr if x["strategy_id"]==s])
print(json.dumps(out,indent=2,ensure_ascii=False))
