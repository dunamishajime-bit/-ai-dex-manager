#!/usr/bin/env python3
"""PRISM IV price-feed/entry-time forensic for historical DisDex BT fills.

Read-only evidence, NOT a trade simulator and never a claim about real market
order executability or quotes. A zero-print hour means the historical price
feed contains no trades without OUR hypothetical order, not that an order
could not create the first print.

For each admitted fill and runner, inspect the 12 same-hour Aster public M5
bars, identify positive-volume print times, compare model entry to
H1/source first print, and flag stale artificial zero-volume M5 opens.

Original pinned source, fee model, accounting and production remain unchanged.
"""
from __future__ import annotations
from pathlib import Path
from collections import defaultdict,Counter
from datetime import datetime, timezone
import gzip,json,csv,hashlib,statistics,sys
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
O=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
O.mkdir(exist_ok=True)
RUNS={"BASE_GROSS425":R/"DD_MLX_COHERENT_CONTROL_20261121",
      "PENGU_NO_PRINT":R/"DD_PRISM3_PENGU_TRADEABLE_H1_ENTRY_20261122",
      "PENGU_IDLE_FIRST_PRINT":R/"DD_PRISM3_PENGU_IDLE_VOLUME_AWARE_20261122"}
H=3600000;M=300000
def to_ms(iso):
 return int(datetime.fromisoformat(iso.replace("Z","+00:00")).timestamp()*1000)
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
rows=[]
for case,folder in RUNS.items():
 for fee in (10,30):
  files=list(folder.glob(f"*_{fee}BPS_FILLS.csv"))
  if len(files)!=1:raise ValueError("FILLS_MISSING_OR_DUPLICATE")
  with files[0].open(encoding="utf-8-sig",newline="") as f:
   for t in csv.DictReader(f):
    if t["strategy"]=="V52":continue
    r={"case":case,"fee":fee,"source_file":files[0].name,
       "trade_id":t["trade_id"],"signal":t["source_signal_id"],
       "runner":t["strategy"],"symbol":t["symbol"],
       "route":t["route"],"entry_ts":to_ms(t["entry_utc"]),
       "model_entry_price":float(t["model_entry_price"]),
       "net_pnl_jpy":float(t["net_pnl_jpy"]),
       "notional_jpy":float(t["notional_jpy"])}
    rows.append(r)
assert len(rows)>1000
idle_source=(R/"DIRECTION_RESEARCH_20261109/IDLE_CURRENT_PRODUCTION_REPLAY_20261110/idle-production-candidates-with-m5-exits.jsonl")
idle_rows=[json.loads(x) for x in idle_source.open(encoding="utf8") if x.strip()]
idle_by_id={x["id"]:x for x in idle_rows}
assert len(idle_by_id)==849
for r in rows:
 r["signal_hour_ts"]=int(idle_by_id[r["signal"]]["entryTs"]) if r["runner"]=="IDLE" else r["entry_ts"]//H*H
 r["signal_hour_ts"]=int(r["signal_hour_ts"])//H*H
targets=defaultdict(set)
for r in rows:targets[r["symbol"]].add(r["signal_hour_ts"])
cache={};source_hashes={};sources={}
for sym,timestamps in sorted(targets.items()):
 paths=[*sorted((R/"aster-public-v3-5m-prefix").glob(f"{sym}-5m-*.gz")),
        *sorted((R/"aster-public-v3-5m-suffix").glob(f"{sym}-5m-*.gz"))]
 h1=list((R/"aster-public-v3-h1").glob(f"{sym}-1h-*.gz"))
 if not h1:raise ValueError("NO_NATIVE_H1:"+sym)
 hdata={}
 for p in h1:
  for x in gzip.open(p,"rt",encoding="utf8"):
   z=json.loads(x);t=int(z[0])
   if t in timestamps:hdata[t]=(float(z[1]),float(z[2]),float(z[3]),float(z[4]),float(z[5]))
 needed=set(t+j*M for t in timestamps for j in range(12))
 bars={}
 for p in paths:
  for x in gzip.open(p,"rt",encoding="utf8"):
   z=json.loads(x);t=int(z[0])
   if t in needed:
    v=(float(z[1]),float(z[2]),float(z[3]),float(z[4]),float(z[5]))
    if t in bars and bars[t]!=v:raise ValueError("M5_CONFLICT")
    bars[t]=v
 source_hashes[sym]={"H1":{p.name:sha(p) for p in h1},
                     "M5":{p.name:sha(p) for p in paths}}
 rec={}
 for t in timestamps:
  b=[bars.get(t+j*M) for j in range(12)]
  h=hdata.get(t)
  if not h or any(v is None for v in b):
   rec[t]={"status":"MISSING_H1_OR_M5","bars_present":sum(x is not None for x in b)}
   continue
  active=[(j,x) for j,x in enumerate(b) if x[4]>0]
  if not active:
   rec[t]={"status":"NO_PRINT_IN_ENTRY_H1","native_H1_open":h[0],
           "native_H1_volume":h[4],"m5_first":b[0][0]}
  else:
   av=active[0][1];j=active[0][0]
   rec[t]={"status":"POSITIVE_PRINT_H1",
     "first_print_5m_timestamp":t+j*M,
     "first_print_delay_mins":j*5,
     "first_print_open":av[0],
     "native_H1_open":h[0],
     "native_H1_volume":h[4],
     "m5_first_open":b[0][0],
     "m5_first_volume":b[0][4],
     "source_volume_coherent":abs(h[4]-sum(x[4] for x in b))<max(1e-9,1e-8*h[4]),
     "source_open_coherent":abs(h[0]-av[0])<max(1e-10,h[0]*1e-8)}
 cache[sym]=rec
 print("LOADED",sym,"HOURS",len(timestamps),"SOURCE_PARTS",len(paths),
       "INSPECTABLE",sum(x["status"]!="MISSING_H1_OR_M5" for x in rec.values()),
       flush=True)
audit=[]
for r in rows:
 d=cache[r["symbol"]][r["signal_hour_ts"]]
 x={**r,**d}
 if d["status"]=="POSITIVE_PRINT_H1":
  x["entry_diff_first_print_pct"]=100*(r["model_entry_price"]/d["first_print_open"]-1)
  x["entry_source_stale"]=abs(x["entry_diff_first_print_pct"])>.05
  x["model_entered_before_first_traded_M5"]=r["entry_ts"]<d["first_print_5m_timestamp"]
 else:
  x["entry_diff_first_print_pct"]=None;x["entry_source_stale"]=None
  x["model_entered_before_first_traded_M5"]=None
 audit.append(x)
with (O/"PRISM4_ALL_RUNNER_ENTRY_PRICE_PRINT_INTEGRITY.csv").open("w",newline="",encoding="utf-8-sig") as f:
 fields=list(dict.fromkeys(z for x in audit for z in x))
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
 for x in audit:w.writerow({k:v for k,v in x.items()})
summaries=[]
for case in RUNS:
 for fee in (10,30):
  group=[x for x in audit if x["case"]==case and x["fee"]==fee]
  for runner in sorted({x["runner"] for x in group}):
   rr=[x for x in group if x["runner"]==runner]
   mismatch=[x for x in rr if x["entry_source_stale"]]
   no=[x for x in rr if x["status"]=="NO_PRINT_IN_ENTRY_H1"]
   missing=[x for x in rr if x["status"]=="MISSING_H1_OR_M5"]
   deferred=[x for x in rr if x["model_entered_before_first_traded_M5"]]
   summaries.append({"case":case,"fee_bps":fee,"runner":runner,
     "fills":len(rr),"entry_price_diff_gt_5bps":len(mismatch),
     "zero_print_entry_hour":len(no),"source_price_unknown":len(missing),
     "entry_before_first_M5_print":len(deferred),
     "max_entry_diff_pct":round(max([abs(x["entry_diff_first_print_pct"]) for x in rr
          if x["entry_diff_first_print_pct"] is not None] or [0]),6),
     "largest_abs_entry_diff_rows":[{k:x[k] for k in
          ("signal","symbol","route","entry_ts","model_entry_price",
           "entry_diff_first_print_pct","net_pnl_jpy")}
          for x in sorted(mismatch,key=lambda x:-abs(x["entry_diff_first_print_pct"]))[:5]],
     "zero_print_trade_ids":[x["signal"] for x in no][:100]})
print("RUNNER_SUMMARIES")
for x in summaries:print(json.dumps({k:v for k,v in x.items() if k not in ("largest_abs_entry_diff_rows","zero_print_trade_ids")}),flush=True)
manifest={"schema":"disdex-prism4-all-runner-m5-print-reconciliation/v1",
 "status":"RESEARCH_SOURCE_FEED_AUDIT_ONLY","trade_samples":len(rows),
 "summary":summaries,"source_file_hashes":source_hashes,
 "constraints":[
 "Zero-volume candle means no printed historical trades in that interval. A hypothetical user order could itself create a print; quotes/orderbook are unknown.",
 "The first positive-volume M5 *open* is the historical first print of that five-minute bar, whose existence is not known until after bar completion; it is not automatically a causal executable fill.",
 "Most source candidates use entry at beginning of H1; this tests their evidence against H1/M5 trade data only, no signed venue execution.",
 "Historical paper trading, future fundings, gross caps, and candidate admission are not re-implemented by this audit.",
 "V52 basis/stock proxies intentionally excluded. History missing for some symbols before Aug 2026; report missing instead of pretending no prints.",
 "All studies are 2025-10 to 2026-09 and observed, not a new blind walk-forward."
 ]}
(O/"PRISM4_ALL_RUNNER_ENTRY_PRICE_PRINT_INTEGRITY_SUMMARY.json").write_text(
 json.dumps(manifest,indent=2,sort_keys=True,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf8")
print("PRISM4_SOURCE_RECONCILIATION_DONE",len(audit),flush=True)
