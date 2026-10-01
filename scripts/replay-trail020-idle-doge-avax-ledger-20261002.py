#!/usr/bin/env python3
import argparse, hashlib, json, math
from collections import Counter
from pathlib import Path

ap=argparse.ArgumentParser()
ap.add_argument("--root",default="docs/research/results/trail020-idle-doge-avax-controlling-20261002")
ap.add_argument("--bps",type=int,choices=[8,10,20,30],default=10)
args=ap.parse_args()
root=Path(args.root)
manifest=json.loads((root/"manifest.json").read_text(encoding="utf-8"))
for row in manifest["files"]:
    path=root/row["path"]
    actual=hashlib.sha256(path.read_bytes()).hexdigest()
    if actual!=row["sha256"]:
        raise SystemExit(f"MANIFEST_SHA_MISMATCH:{row['path']}:{actual}:{row['sha256']}")
case=root/f"{args.bps}bps"
integrated=json.loads((case/"integrated-result.json").read_text(encoding="utf-8"))
trades=[json.loads(x) for x in (case/"portfolio-trades.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
if len(trades)!=int(integrated["combined_completed"]):
    raise SystemExit(f"TRADE_COUNT_MISMATCH:{len(trades)}:{integrated['combined_completed']}")
counts=dict(sorted(Counter(str(x["strategy"]) for x in trades).items()))
expected=dict(sorted((str(k),int(v)) for k,v in integrated["strategy_counts"].items()))
if counts!=expected:
    raise SystemExit(f"STRATEGY_COUNT_MISMATCH:{counts}:{expected}")
pnl=[float(x["trade_pnl_settlement"]) for x in trades]
wins=sum(x>0 for x in pnl)
wr=wins/len(pnl) if pnl else 0.0
gp=sum(x for x in pnl if x>0); gl=-sum(x for x in pnl if x<0)
pf=gp/gl if gl else math.inf
if abs(wr-float(integrated["win_rate"]))>1e-12:
    raise SystemExit(f"WIN_RATE_MISMATCH:{wr}:{integrated['win_rate']}")
if abs(pf-float(integrated["profit_factor"]))>1e-9:
    raise SystemExit(f"PF_MISMATCH:{pf}:{integrated['profit_factor']}")
contract=json.loads((root/"controlling-contract.json").read_text(encoding="utf-8"))
contract_case=contract["costs"][str(args.bps)]
if abs(float(contract_case["finalJpy"])-float(integrated["final_equity_jpy"]))>1e-6:
    raise SystemExit("CONTRACT_FINAL_JPY_MISMATCH")
out={
    "status":"TRAIL020_IDLE_DOGE_AVAX_LEDGER_REPLAY_PASS",
    "bps":args.bps,
    "final_equity_jpy":integrated["final_equity_jpy"],
    "trades":len(trades),
    "wins":wins,
    "win_rate":wr,
    "profit_factor":pf,
    "max_mtm_drawdown":integrated["max_mtm_drawdown"],
    "strategy_counts":counts,
    "priority":contract["priority"],
}
print(json.dumps(out,ensure_ascii=False,indent=2))
