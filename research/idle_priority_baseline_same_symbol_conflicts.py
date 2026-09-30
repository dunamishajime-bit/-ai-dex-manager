#!/usr/bin/env python3
import argparse,json
from pathlib import Path
def jl(p): return [json.loads(x) for x in Path(p).read_text().splitlines() if x.strip()]
a=argparse.ArgumentParser();a.add_argument("--baseline-trades",required=True);a.add_argument("--idle-intents",required=True);a.add_argument("--output",required=True);z=a.parse_args()
base=jl(z.baseline_trades); idle=json.loads(Path(z.idle_intents).read_text())
conf=[]
for b in base:
    bt=int(b["entry_ts_ms"]); sym=str(b["symbol"])
    hits=[i for i in idle if i["symbol"]==sym and int(i["entry_ts_ms"])<=bt<int(i["exit_ts_ms"])]
    if hits:
        conf.append({"candidate_id":b.get("candidate_id"),"position_id":b.get("position_id"),"strategy_id":b.get("strategy_id"),"symbol":sym,
                     "baseline_entry_ts_ms":bt,"baseline_exit_ts_ms":int(b["exit_ts_ms"]),"baseline_accepted_gross":b.get("accepted_gross"),
                     "idle_hits":hits})
overlap=[]
for b in base:
    bt=int(b["entry_ts_ms"])
    hits=[i for i in idle if int(i["entry_ts_ms"])<bt<int(i["exit_ts_ms"])]
    if hits:
        overlap.append({"candidate_id":b.get("candidate_id"),"position_id":b.get("position_id"),"strategy_id":b.get("strategy_id"),"symbol":b.get("symbol"),
                        "baseline_entry_ts_ms":bt,"baseline_exit_ts_ms":int(b["exit_ts_ms"]),"baseline_accepted_gross":b.get("accepted_gross"),
                        "idle_hits":hits})
out={"status":"DIAGNOSTIC","baseline_rows":len(base),"idle_rows":len(idle),
     "same_symbol_baseline_entry_conflicts":len(conf),"conflicts":conf,
     "baseline_entries_during_any_idle_hold":len(overlap),"baseline_overlap_entries":overlap}
Path(z.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
print(json.dumps({"baseline_rows":len(base),"idle_rows":len(idle),"same_symbol_baseline_entry_conflicts":len(conf),"baseline_entries_during_any_idle_hold":len(overlap)}))
print("CONFLICTS="+json.dumps(conf,sort_keys=True))\nprint("OVERLAP_ENTRIES="+json.dumps(overlap,sort_keys=True))
