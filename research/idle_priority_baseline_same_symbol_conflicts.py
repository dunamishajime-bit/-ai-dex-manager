#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

def load_jsonl(path):
    return [json.loads(x) for x in Path(path).read_text(encoding="utf-8").splitlines() if x.strip()]

ap=argparse.ArgumentParser()
ap.add_argument("--baseline-trades",required=True)
ap.add_argument("--idle-intents",required=True)
ap.add_argument("--output",required=True)
args=ap.parse_args()

base=load_jsonl(args.baseline_trades)
idle=json.loads(Path(args.idle_intents).read_text(encoding="utf-8"))

same_symbol=[]
any_overlap=[]
for b in base:
    bt=int(b["entry_ts_ms"])
    sym=str(b["symbol"])
    hits=[i for i in idle if int(i["entry_ts_ms"]) < bt < int(i["exit_ts_ms"])]
    if hits:
        row={
            "candidate_id":b.get("candidate_id"),
            "position_id":b.get("position_id"),
            "strategy_id":b.get("strategy_id"),
            "symbol":sym,
            "baseline_entry_ts_ms":bt,
            "baseline_exit_ts_ms":int(b["exit_ts_ms"]),
            "baseline_accepted_gross":b.get("accepted_gross"),
            "idle_hits":hits,
        }
        any_overlap.append(row)
        if any(i["symbol"]==sym for i in hits):
            same_symbol.append(row)

out={
    "status":"DIAGNOSTIC",
    "baseline_rows":len(base),
    "idle_rows":len(idle),
    "same_symbol_baseline_entry_conflicts":len(same_symbol),
    "baseline_entries_during_any_idle_hold":len(any_overlap),
    "same_symbol_conflicts":same_symbol,
    "baseline_overlap_entries":any_overlap,
}
Path(args.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
print(json.dumps({
    "baseline_rows":len(base),
    "idle_rows":len(idle),
    "same_symbol_baseline_entry_conflicts":len(same_symbol),
    "baseline_entries_during_any_idle_hold":len(any_overlap),
},sort_keys=True))
print("SAME_SYMBOL_CONFLICTS="+json.dumps(same_symbol,sort_keys=True))
print("OVERLAP_ENTRIES="+json.dumps(any_overlap,sort_keys=True))
