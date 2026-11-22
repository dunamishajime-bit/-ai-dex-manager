#!/usr/bin/env python3
"""Read-only inventory of ASTER H1 local tapes and 181-day Q102 warmup coverage."""
import gzip,hashlib,json,re,datetime as dt
from pathlib import Path
BASE=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUTPUT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122\P107_ASTER_1H_Q102_181DAY_SOURCE_COVERAGE_20261122.json")
H=3600000;D=24*H;START=1759276800000;END=1790812800000
dirs=[BASE/"aster-public-v3-h1-early",BASE/"aster-public-v3-h1",BASE/"aster-public-v3-h1-q102-warmup"]
symbols=sorted(set(p.name.split("-")[0] for d in dirs if d.is_dir() for p in d.glob("*USDT-1h-*") if p.suffix==".gz"))
def iso(t):return dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).isoformat().replace("+00:00","Z")
summaries=[]
for symbol in symbols:
 entries=[]
 for folder in dirs:
  for f in folder.glob(symbol+"-1h-*.jsonl.gz"):
   times=[]
   with gzip.open(f,"rt",encoding="utf-8",errors="replace") as z:
    for line in z:
     if not line.strip():continue
     row=json.loads(line);times.append(int(row[0]))
   if times:
    entries.append({"folder":folder.name,"file":f.name,"count":len(times),"first":min(times),"last":max(times),"sha256":hashlib.sha256(f.read_bytes()).hexdigest(),"timestamps":times})
 if not entries:continue
 # Do not count overlapping warmup and early+recent rows as independent candles.
 uniq=sorted(set(t for e in entries for t in e["timestamps"]))
 gaps=[{"previous":iso(a),"next":iso(b),"missingHours":(b-a)//H-1} for a,b in zip(uniq,uniq[1:]) if b-a!=H]
 earliest=max(START,uniq[0]+181*D)
 start_possible=uniq[0]<=START-181*D
 full_period=uniq[0]<=START and uniq[-1]>=END-H and not gaps
 summaries.append({
 "symbol":symbol,"observedUniqueH1":len(uniq),
 "earliestH1":iso(uniq[0]),"latestH1":iso(uniq[-1]),
 "continuityBreakCount":len(gaps),"gaps":gaps[:8],
 "q102_181d_warmup_available_at_start":start_possible,
 "q102_earliest_theoretical_entry_utc":iso(earliest),
 "covers_entire_BT_prices":full_period,
 "inputFiles":[{k:v for k,v in e.items() if k!="timestamps"} for e in entries]
 })
missing=[x["symbol"] for x in summaries if not x["q102_181d_warmup_available_at_start"]]
incomplete=[x["symbol"] for x in summaries if not x["covers_entire_BT_prices"]]
result={
 "schema":"p107-aster-h1-q102-181d-source-audit/v1",
 "period":[iso(START),iso(END)],"warmup_hours":181*24,
 "claim":"Input inventory only, not full native-signal reconstruction",
 "all_runner_parity_verified":False,
 "data_volumes":len(summaries),"missing_initial_Q102_181d_history_symbols":missing,
 "incomplete_BT_price_coverage_symbols":incomplete,
 "sources":summaries
}
OUTPUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print("COVERAGE",len(summaries),"warmup_missing",len(missing),missing)
print("NOT_FULL_HISTORY",len(incomplete),incomplete)
for sym in ["FETUSDT","BTCUSDT","AVAXUSDT","UNIUSDT","HYPEUSDT"]:
 m=next((x for x in summaries if x["symbol"]==sym),None)
 if m:print("SYMBOL",sym,m["earliestH1"],m["q102_earliest_theoretical_entry_utc"],len(m["inputFiles"]),"GAPS",m["continuityBreakCount"])
print("OUTPUT",OUTPUT,"BYTES",OUTPUT.stat().st_size)
