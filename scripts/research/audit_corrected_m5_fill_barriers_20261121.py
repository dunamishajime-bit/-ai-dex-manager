#!/usr/bin/env python3
"""Independent 5-minute initial adverse-stop barrier audit for STABLE4 research fills.

Research ONLY: this checks whether a modeled position remained open *after*
historical M5 OHLC crossed its original adverse-price barrier. This does not
verify a venue-resident STOP, bid/ask, latency, fill quantity, or production SHA.
For native exit-spec ATR, partial/reversal, and V52 basis exits, avoid false
inference by only auditing supported fixed initial barriers.
"""
from pathlib import Path
import datetime as dt,collections,csv,json,gzip,bisect,math,hashlib,statistics
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=ROOT/"DD_STOP_CORRECTED_5M_VALIDATION_20261121"
OUT.mkdir(exist_ok=True)
CASES=["DD_STOP_COHERENCE_STOP_M5_SUFFIX_20261121",
       "DD_STOP_COHERENCE_STOP_M5_SUFFIX_V52_EXIT_INDEPENDENT_20261121"]
M5_MS=300000
def rows_csv(p):
 with p.open(newline="",encoding="utf-8-sig") as f:return list(csv.DictReader(f))
def jl(p):
 with p.open(encoding="utf-8-sig") as f:return [json.loads(x) for x in f if x.strip()]
def when(x):
 return round(dt.datetime.fromisoformat(x.replace("Z","+00:00")).timestamp()*1000)
def date(t):
 return dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
path_v4=ROOT/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"
src_v4={r["id"]:r for r in jl(path_v4)}
src_pengu={r["id"]:r for r in jl(ROOT/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl")}
src_q102={f"Q102P_{i:05d}":r for i,r in enumerate(
 jl(ROOT/"DIRECTION_RESEARCH_20261109"/"Q102_PRODUCTION_PARITY_CORRECTED_20261110"/"q102-production-candidates-adopted-ON.jsonl"),1)}
src_idle={f"IDLEP_{i:05d}":r for i,r in enumerate(
 jl(ROOT/"DIRECTION_RESEARCH_20261109"/"IDLE_CURRENT_PRODUCTION_REPLAY_20261110"/"idle-production-candidates-with-m5-exits.jsonl"),1)}
src_fet={f"FET_{i:05d}":r for i,r in enumerate(
 jl(ROOT/"native-new-signal-20251001-20261001"/"native-FET-raw-intentions.jsonl"),1)}
native={"V4":src_v4,"PENGU":src_pengu,"Q102":src_q102,"IDLE":src_idle,"FET":src_fet}
def source_expected(trade):
 s=trade["strategy"];sid=trade["source_signal_id"]
 if s=="HYPE":return (None,"HYPE_H48_TIME_ONLY_NO_ATTACHED_STOP")
 if s=="V52":return (None,"V52_BASIS_STOP_NOT_PRICE_STOP")
 if s=="Q102" and sid.startswith("Q102Q01365"):
  return (.05,"Q102Q01365_5P_FROM_ROUTE_NAME_NOT_IN_NATIVE_ROW")
 r=native.get(s,{}).get(sid)
 if r is None:return (None,"SOURCE_ID_UNMAPPED")
 if s=="V4":
  if r.get("reversal"):return (None,"V4_REVERSAL_REQUIRES_DYNAMIC_SIDE")
  if r.get("exitSpec",{}).get("kind")!="TIME":return (None,"V4_ATR_OR_NATIVE_DYNAMIC_STOP_NOT_FIXED")
  return (.08,"V4_TIME_ROUTE_HARDSTOP_8P")
 if s=="PENGU":
  if r.get("reversal"):return (None,"PENGU_REVERSAL_REQUIRES_DYNAMIC_SIDE")
  return ((.06 if r["route"]=="RECOVERY_V8" else .08),"PENGU_ROUTED_HARDSTOP")
 if s=="Q102":return (float(r["hardStop"]),"Q102_ROUTE_HARDSTOP")
 if s=="IDLE":return (.10,"IDLE_INITIAL_SHORT_STOP10")
 if s=="FET":return (.05,"FET_LONG_HARDSTOP5")
 return (None,"UNSUPPORTED_STRATEGY")
records=[]
for case in CASES:
 for fee in (10,30):
  p=next((ROOT/case).glob(f"*_{fee}BPS_FILLS.csv"))
  for r in rows_csv(p):
   ratio,status=source_expected(r)
   rec={"case":case,"fee_bps":fee,"signal_id":r["source_signal_id"],
        "runner":r["strategy"],"route":r["route"],"symbol":r["symbol"],
        "side":r["side"],"entry":float(r["model_entry_price"]),
        "entry_ms":when(r["entry_utc"]),"exit_ms":when(r["exit_utc"]),
        "modeled_exit":r["exit_model_reason"],
        "stop_ratio":ratio,"stop_basis":status,
        "source_reason":(native.get(r["strategy"],{}).get(r["source_signal_id"]) or {}).get("exitReason"),
        "source_exit_ms":(native.get(r["strategy"],{}).get(r["source_signal_id"]) or {}).get("exitTs")}
   records.append(rec)
sym_dict=collections.defaultdict(list)
for row in records:
 if row["stop_ratio"] is not None or row["runner"]=="HYPE":sym_dict[row["symbol"]].append(row)
# Decode and audit one symbol at a time; never assume missing bars are a pass.
coverage=collections.Counter();skipped=collections.Counter()
for symbol,Rs in sorted(sym_dict.items()):
 lo=min(x["entry_ms"] for x in Rs)-M5_MS
 hi=max(x["exit_ms"] for x in Rs)+M5_MS
 candles={}
 paths=[]
 for d in ("aster-public-v3-5m-prefix","aster-public-v3-5m-suffix"):
  paths.extend((ROOT/d).glob(symbol+"-5m-*.jsonl.gz"))
 for path in paths:
  with gzip.open(path,"rt",encoding="utf-8") as f:
   for line in f:
    x=json.loads(line);tm=int(x[0])
    if lo<=tm<=hi:
     candles[tm]=(float(x[1]),float(x[2]),float(x[3]),float(x[4]))
 for rec in Rs:
  start=rec["entry_ms"];end=rec["exit_ms"]
  rec["observed_bars"]=0
  rec["missing_bars"]=0
  rec["first_barrier_cross_ms"]=None
  rec["min_model_long_adverse_pct"]=None
  rec["max_model_short_adverse_pct"]=None
  mx=0.
  barrier=rec["stop_ratio"]
  if barrier is not None:
   stop=rec["entry"]*(1-barrier if rec["side"]=="LONG" else 1+barrier)
   rec["initial_stop_price"]=stop
  for tm in range(start,end,M5_MS):
   z=candles.get(tm)
   if z is None:
    rec["missing_bars"]+=1;continue
   op,high,low,close=z
   rec["observed_bars"]+=1
   adv=(1-low/rec["entry"]) if rec["side"]=="LONG" else (high/rec["entry"]-1)
   mx=max(mx,adv)
   if barrier is not None and rec["first_barrier_cross_ms"] is None:
    touched=low<=stop if rec["side"]=="LONG" else high>=stop
    if touched:rec["first_barrier_cross_ms"]=tm
  rec["worst_intrabar_adverse_pct"]=100*mx
  rec["full_5m_path"]=rec["observed_bars"]>0 and rec["missing_bars"]==0
  if rec["missing_bars"]>0:coverage["gapped_paths"]+=1
  if rec["observed_bars"]==0:coverage["missing_paths"]+=1
  if rec["stop_ratio"] is not None and rec["first_barrier_cross_ms"] is not None:
   rec["first_barrier_cross_utc"]=date(rec["first_barrier_cross_ms"])
   rec["minutes_between_touch_and_exit"]=(rec["exit_ms"]-rec["first_barrier_cross_ms"]-M5_MS)/60000
   rec["early_cross_before_modeled_exit"]=rec["minutes_between_touch_and_exit"]>=5
   coverage["touched_barrier"]+=1
   if rec["early_cross_before_modeled_exit"]:coverage["crossed_5min_before_exit"]+=1
  else:rec["early_cross_before_modeled_exit"]=False
 print("SYMBOL_DONE",symbol,"trades",len(Rs),"m5",len(candles),flush=True)
# Source-dependent model parity: compare exit time/price for exact source-admitted signals.
for r in records:
 if r["runner"] not in native:continue
 v=native[r["runner"]].get(r["signal_id"])
 if v is None or "exitTs" not in v:continue
 if r["modeled_exit"] in {"SHARED_RISK_FLATTEN","FORMAL_PRIORITY","IDLE_SHORT_PRIORITY"}:continue
 r["expected_native_exit_utc"]=date(int(v["exitTs"]))
 r["model_native_exit_same_time"]=r["exit_ms"]==int(v["exitTs"])
 r["model_native_exit_same_price"]=abs(float(v["exitPrice"])-float(next(
  z["model_exit_price"] for z in rows_csv(next((ROOT/r["case"]).glob(f"*_{r['fee_bps']}BPS_FILLS.csv")))
  if z["source_signal_id"]==r["signal_id"])))<1e-9 if False else None
summary={}
for case in CASES:
 summary[case]={}
 for fee in (10,30):
  sample=[z for z in records if z["case"]==case and z["fee_bps"]==fee]
  cc={}
  for strat in ["V4","PENGU","Q102","IDLE","FET","HYPE","V52"]:
   a=[z for z in sample if z["runner"]==strat]
   audited=[z for z in a if z["stop_ratio"] is not None]
   touch=[z for z in audited if z.get("first_barrier_cross_ms") is not None]
   early=[z for z in touch if z["early_cross_before_modeled_exit"] and z["full_5m_path"]]
   not_covered=[z for z in audited if not z.get("full_5m_path",False)]
   native_time=[z for z in a if z.get("model_native_exit_same_time") is not None]
   changed=[z for z in native_time if z.get("model_native_exit_same_time") is False]
   cc[strat]=dict(fills=len(a),fixed_stop_auditable=len(audited),touches=len(touch),
       crosses_more_than_5min_before_model_exit=len(early),
       missing_or_gapped_5m_paths=len(not_covered),native_exit_time_comparable=len(native_time),
       native_exit_time_differs=len(changed),examples=early[:8])
  summary[case][str(fee)]=cc
out=dict(schema="disdex-stable4-initial-stop-5m-causal-barrier-audit/v1",
 caveats=["Research 5m barrier check is NOT production venue execution parity.",
 "An earlier stop-touch than modeled exit is a potential economic inconsistency, not proof a real venue STOP failed.",
 "No conclusion drawn for missing data, reversals, V4 dynamic ATR/native exits, V52 basis, or HYPE time-only research.",
 "Time comparisons are to stored native price model for same source signal, not production live order."],
 count=len(records),coverage=dict(coverage),summary=summary,
 anomalies=[r for r in records if r.get("early_cross_before_modeled_exit") and r.get("full_5m_path")],
 missing=[r for r in records if r["stop_ratio"] is not None and not r.get("full_5m_path",False)],
 hype_path=[r for r in records if r["runner"]=="HYPE"])
P=OUT/"STOP_M5_VS_MODELED_EXIT_AUDIT.json"
P.write_text(json.dumps(out,ensure_ascii=False,indent=2,default=str)+"\n",encoding="utf-8")
for case,c in summary.items():
 for fee,d in c.items():
  print("SUMMARY",case,fee,
    [(s,x["fills"],x["fixed_stop_auditable"],x["touches"],x["crosses_more_than_5min_before_model_exit"],x["missing_or_gapped_5m_paths"],x["native_exit_time_differs"]) for s,x in d.items()])
print("AUDIT_SAVED",P,"bytes",P.stat().st_size,"ANOMALIES",len(out["anomalies"]))
for v in out["anomalies"][:15]:print("VIOLATION",v["case"],v["fee_bps"],v["runner"],v["signal_id"],v["route"],v["first_barrier_cross_utc"],date(v["exit_ms"]),v["modeled_exit"],"adverse_pct",round(v["worst_intrabar_adverse_pct"],2))
