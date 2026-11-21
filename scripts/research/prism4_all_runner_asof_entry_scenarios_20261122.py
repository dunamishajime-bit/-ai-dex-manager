#!/usr/bin/env python3
"""PRISM IV: all-Runner audited as-of M5 entry-time scenario comparison.

No claim that historical no-print periods prove a user order could not fill.
No scenario is fed future bar data into a *decision*. The CONFIRMED scenario
may use a later first-trade price as a proxy outcome (never a signed fill).

V52 excluded: its paired-stock/crypto basis has a distinct execution model.
"""
from __future__ import annotations
import csv,gzip,json,hashlib,statistics,sys
from pathlib import Path
from collections import defaultdict,Counter
from datetime import datetime,timezone

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
SRC=OUT/"PRISM4_ALL_RUNNER_ENTRY_PRICE_PRINT_INTEGRITY.csv"
if not SRC.exists():raise ValueError("PRISM4_ALL_RUNNER_PRINT_AUDIT_MISSING")
sys.path.insert(0,str(Path(__file__).resolve().parent))
from prism4_causal_m5_execution_contract_20261122 import Bar,EntryDecision,choose_entry,M5_MS
H=12*M5_MS
with SRC.open(encoding="utf-8-sig",newline="") as f:
 ledger=list(csv.DictReader(f))
assert len(ledger)==5379,len(ledger)
by_symbol=defaultdict(set)
for x in ledger:by_symbol[x["symbol"]].add(int(x["signal_hour_ts"]))
cache={}
paths_sha={}
for symbol,hours in sorted(by_symbol.items()):
 need={t+i*M5_MS for t in hours for i in range(12)}
 raw={}
 files=[*sorted((ROOT/"aster-public-v3-5m-prefix").glob(symbol+"-5m-*.jsonl.gz")),
        *sorted((ROOT/"aster-public-v3-5m-suffix").glob(symbol+"-5m-*.jsonl.gz"))]
 paths_sha[symbol]=[f.name for f in files]
 for path in files:
  with gzip.open(path,"rt",encoding="utf8") as stream:
   for line in stream:
    a=json.loads(line);ts=int(a[0])
    if ts not in need:continue
    v=Bar(ts,float(a[1]),float(a[2]),float(a[3]),float(a[4]),float(a[5]))
    if ts in raw and raw[ts]!=v:raise ValueError("CONFLICTING_M5_SOURCE")
    raw[ts]=v
 cache[symbol]={t:([raw.get(t+i*M5_MS) for i in range(12)]) for t in hours}
 print("SOURCE",symbol,"H1",len(hours),"M5_AVAILABLE",len(raw),flush=True)

scenarios=("NATIVE_H1_PRICE","FIRST_PRINT_UPPER_INFORMATION_BOUND","CONFIRMED_NEXT_PRINT")
results=[]
for x in ledger:
 h=int(x["signal_hour_ts"]);bars=cache[x["symbol"]][h]
 key={"case":x["case"],"fee_bps":int(x["fee"]),"runner":x["runner"],
   "route":x["route"],"symbol":x["symbol"],"signal_id":x["signal"],"side":x.get("side") or "SHORT",
   "signal_hour_ts":h,"original_model_entry_ts":int(x["entry_ts"]),
   "original_model_entry_price":float(x["model_entry_price"])}
 if any(b is None for b in bars):
  results.append({**key,"scenario":"ALL","state":"UNKNOWN_SOURCE_INCOMPLETE","proxy_price":None,
    "model_vs_proxy_price_move_pct":None,"market_data_coverage":sum(b is not None for b in bars)})
  continue
 assert len(bars)==12
 state=EntryDecision(h,h+H,"LONG")
 native=float(x["native_H1_open"]) if x.get("native_H1_open") not in (None,"") else None
 for name in scenarios:
  r=choose_entry(state,bars,name,native_h1_open=native)
  price=r.reference_price
  results.append({**key,"scenario":name,"state":r.state,
   "proxy_price":price,"proxy_fill_ts":r.modeled_fill_ts,
   "asof_decision_ts":r.decision_or_order_ts,"first_print_ts":r.first_print_ts,
   "source_qualification":r.provenance,"observed_candle_count":r.seen_m5_bars,
   "model_vs_proxy_price_move_pct":round(100*(float(x["model_entry_price"])/price-1),6)
      if price is not None else None,
   "proxy_price_is_signed_fill":False})
def summary(data):
 n=len(data)
 return {
 "n":n,"scenario_state":dict(Counter(x["state"] for x in data)),
 "proxy_n":sum(x.get("proxy_price") is not None for x in data),
 "missing_price_n":sum(x.get("proxy_price") is None for x in data),
 "entry_price_diff_gt5bps":sum(x.get("model_vs_proxy_price_move_pct") is not None
           and abs(x["model_vs_proxy_price_move_pct"])>.05 for x in data),
 "nonimmediate_proxy_fills":sum(x.get("proxy_fill_ts") is not None
      and x["proxy_fill_ts"]>x["signal_hour_ts"] for x in data),
 "price_drift_pct_q50":round(statistics.median(
   [abs(x["model_vs_proxy_price_move_pct"]) for x in data
    if x.get("model_vs_proxy_price_move_pct") is not None]),4) if data else None,
 "unresolved_source_n":sum(x["state"]=="UNKNOWN_SOURCE_INCOMPLETE" for x in data)}
rollup=[]
for case in sorted(set(x["case"] for x in ledger)):
 for fee in (10,30):
  for runner in sorted(set(x["runner"] for x in ledger)):
   for scenario in scenarios:
    group=[z for z in results if z["case"]==case and z["fee_bps"]==fee
        and z["runner"]==runner and z["scenario"]==scenario]
    if not group:continue
    rollup.append({"case":case,"fee_bps":fee,"runner":runner,"scenario":scenario,
                   **summary(group)})
for x in rollup:
 if x["case"]=="BASE_GROSS425" and x["fee_bps"]==30:
  print("CAUSAL_AUDIT",json.dumps(x,ensure_ascii=False),flush=True)
def write_csv(path,items):
 keys=list(dict.fromkeys(k for x in items for k in x))
 with path.open("w",encoding="utf-8-sig",newline="") as f:
  w=csv.DictWriter(f,keys);w.writeheader();w.writerows(items)
write_csv(OUT/"PRISM4_ASOF_ALL_RUNNER_ENTRY_SCENARIO_5379.csv",results)
write_csv(OUT/"PRISM4_ASOF_ALL_RUNNER_ENTRY_SCENARIO_ROLLUP.csv",rollup)
manifest={"schema":"disdex-prism4-asof-all-runner-entry-5379/v1",
 "source":"original PRISM4 5379 non-V52 modeled fills, own M5 source reconstructed by 1h window",
 "record_count":len(ledger),"scenario_record_count":len(results),
 "scenario_descriptions":{
  "NATIVE_H1_PRICE":"H1 opening price optimistic reference; hypothetical order may create its own print",
  "FIRST_PRINT_UPPER_INFORMATION_BOUND":"ex-post first M5 with positive volume; not causal as a decision model",
  "CONFIRMED_NEXT_PRINT":"first traded M5 AFTER the prior positive-volume M5 closes; order could be considered after confirmation but price is an uncertain proxy"},
 "summary":rollup,"source_files":paths_sha,
 "guardrails":["Never classify an all-zero-print hour as inherently unfillable",
 "Never use same confirming M5 OHLCV to claim its OPEN was already known",
 "Do not recalculate native exits, PF, DD, or select the best scenario using these prices alone",
 "No venue order book, signed fills or actual liquidity proof",
 "Current Production Gross cap and native SHA mismatch the STABLE3 Gross425 research baseline",
 "All 2025/10-2026/09 periods have been used in research, NOT untouched OOS"]}
(OUT/"PRISM4_ASOF_ALL_RUNNER_ENTRY_SCENARIO_SUMMARY.json").write_text(
 json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("PRISM4_ASOF_SCENARIO_EVIDENCE_PASS",len(ledger),len(results),flush=True)
