import json,re,subprocess
from pathlib import Path
root=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
git=root/"master-checkout"
pin="c7310d34ba1b6de07071d8883a2ed0de8dcce2a7"
p=subprocess.run(["git","-C",str(git),"show",pin+":config/disdexQuality102CausalV4Model.ts"],capture_output=True,text=True,timeout=12)
assert p.returncode==0
actual=set(re.findall(r'\bsymbol:\s*"([A-Z0-9]+USDT)"',p.stdout))
all_json=json.loads((root/"P107_ASTER_1H_Q102_181DAY_SOURCE_COVERAGE_20261122.json").read_text(encoding="utf-8"))
by={x["symbol"]:x for x in all_json["sources"]}
missing=sorted(s for s in actual if not by.get(s,{}).get("q102_181d_warmup_available_at_start",False))
coverage={s:{k:by.get(s,{}).get(k) for k in ("earliestH1","latestH1","q102_181d_warmup_available_at_start","q102_earliest_theoretical_entry_utc","covers_entire_BT_prices","continuityBreakCount")} for s in sorted(actual)}
out={
 "schema":"p107-q102-pin-s34-11-symbol-181d-source-coverage/v1",
 "sourceCommit":pin,"modelSourceFile":"config/disdexQuality102CausalV4Model.ts",
 "marketDataCoverageShaSource":root.joinpath("P107_ASTER_1H_Q102_181DAY_SOURCE_COVERAGE_20261122.json").name,
 "S34_symbols":sorted(actual),
 "count":len(actual),
 "S34_missing_required_181d_prewarm_asof_2025_10_01":missing,
 "data":coverage,
 "highVol_symbols_not_yet_included":True,
 "full_STABLE4_parity":False
}
path=root/"P107_Q102_PIN_S34_EXACT_SYMBOL_COVERAGE_20261122.json"
path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("S34",len(actual),"MISSING",len(missing),missing)
print("DETAIL",[(s,coverage[s]["earliestH1"],coverage[s]["q102_earliest_theoretical_entry_utc"]) for s in missing])
