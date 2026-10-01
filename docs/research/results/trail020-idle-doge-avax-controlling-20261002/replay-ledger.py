#!/usr/bin/env python3
import argparse, json, math
from collections import defaultdict
from pathlib import Path

ap=argparse.ArgumentParser(description="Replay/verify Trail0.20 + Idle + DOGE/AVAX frozen ledger.")
ap.add_argument("cost", nargs="?", default="10bps", choices=["8bps","10bps","20bps","30bps"])
args=ap.parse_args()
root=Path(__file__).resolve().parent/args.cost
rows=[json.loads(x) for x in (root/"portfolio-trades.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
metrics=json.loads((root/"metrics.json").read_text(encoding="utf-8"))
by=defaultdict(list)
for row in rows:
    by[str(row["strategy"])].append(float(row["trade_pnl_settlement"]))
def stats(vals):
    gp=sum(x for x in vals if x>0); gl=-sum(x for x in vals if x<0)
    return {
        "trades":len(vals),
        "wins":sum(x>0 for x in vals),
        "win_rate":sum(x>0 for x in vals)/len(vals) if vals else 0.0,
        "profit_factor":gp/gl if gl else math.inf,
        "pnl_settlement":sum(vals),
    }
all_vals=[float(r["trade_pnl_settlement"]) for r in rows]
out={
    "cost":args.cost,
    "trades":len(rows),
    "win_rate":stats(all_vals)["win_rate"],
    "profit_factor":stats(all_vals)["profit_factor"],
    "strategy_counts":{k:len(v) for k,v in sorted(by.items())},
    "by_strategy":{k:stats(v) for k,v in sorted(by.items())},
    "metrics_anchor":{
        "final_equity_jpy":metrics["final_equity_jpy"],
        "max_mtm_drawdown":metrics["max_mtm_drawdown"],
        "profit_factor":metrics["profit_factor"],
        "win_rate":metrics["win_rate"],
    },
}
assert out["trades"]==metrics["combined_completed"]
assert out["strategy_counts"]==metrics["strategy_counts"]
assert abs(out["win_rate"]-metrics["win_rate"])<1e-12
assert abs(out["profit_factor"]-metrics["profit_factor"])<1e-10
print(json.dumps(out,indent=2,ensure_ascii=False))
