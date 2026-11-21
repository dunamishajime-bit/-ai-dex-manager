#!/usr/bin/env python3
"""Independent QA of PRE-baseline H1 BTC/PENGU against 12 traded M5 bars.

Never alter raw downloaded files. When BTC source H1 is invalid (e.g. high
below open), construct a SEPARATE research H1 copy solely using confirmed
OHLCV of positive-volume 5m prints. Every repair is logged by timestamp
with original fields, derived M5 fields, and SHA256. Any missing/invalid
M5 source leaves an entry unresolved and FAILS CLOSED.

This is not a production quote/venue fill, nor a deployable runner change.
"""
from __future__ import annotations
import datetime as dt,gzip,hashlib,json,math,sys
from pathlib import Path
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd()/"PRISM_PREBASELINE_PUBLIC"
START=int(dt.datetime(2025,8,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2025,9,24,tzinfo=dt.timezone.utc).timestamp()*1000)
def load(path):
 a={}
 with gzip.open(path,"rt",encoding="utf8") as f:
  for line in f:
   x=json.loads(line);ts=int(x[0])
   if ts in a:raise ValueError("DUPLICATED_BAR")
   a[ts]=x
 return a
def assertbar(x):
 o,h,l,c,v=(float(x[i]) for i in (1,2,3,4,5))
 if not all(math.isfinite(n) for n in (o,h,l,c,v)) or min(o,h,l,c)<=0 or v<0:
  raise ValueError("NEGATIVE_NONFINITE_PRICE")
 if l>min(o,c,h) or h<max(o,c,l):
  raise ValueError("INVALID_PRICE_ENVELOPE")
 return o,h,l,c,v
report={"schema":"disdex-prism-prebaseline-H1-M5-QA/v1","period":[START,END],
 "symbol":{},"status":"FAIL_CLOSED_PENDING_VALIDATION","research_only":True}
for symbol in ("PENGUUSDT","BTCUSDT"):
 hp=OUT/f"{symbol}-1h-20250801-20250924.jsonl.gz"
 mp=OUT/f"{symbol}-5m-20250801-20250924.jsonl.gz"
 h=load(hp);m=load(mp)
 if len(h)!=1296 or len(m)!=15552:raise ValueError("HISTORY_INCOMPLETE:"+symbol)
 allout=[];fixes=[];price_diffs=0;totalhours=0;zeroH=0;invalid_m5=0;quarantined_m5=[]
 for t in sorted(h):
  if not START<=t<END or t%3600000:raise ValueError("BAD_H1_ALIGNMENT")
  z=h[t];p=[m.get(t+j*300000) for j in range(12)]
  if any(x is None for x in p):raise ValueError("INCOMPLETE_HOUR_M5")
  qa_bars=[]
  for k in p:
   v=list(k)
   if float(v[5])>0:
    try:assertbar(v)
    except ValueError as exc:
     if symbol!="BTCUSDT" or int(v[0])!=1757771400000 or t!=1757768400000:
      raise ValueError("M5_UNREPAIRABLE:"+symbol+":"+str(t)+":"+str(exc))
     invalid_m5+=1
     quarantined_m5.append({"ts":int(v[0]),"raw_OHLCV":[float(v[i]) for i in (1,2,3,4,5)],"status":"M5_HIGH_BELOW_ITS_OWN_OPEN_SOURCE_AMBIGUOUS"})
     v[2]=str(max(float(v[1]),float(v[2]),float(v[3]),float(v[4])))
     v[3]=str(min(float(v[1]),float(v[2]),float(v[3]),float(v[4])))
     assertbar(v)
   qa_bars.append(v)
  active=[x for x in qa_bars if float(x[5])>0]
  old=[float(z[i]) for i in (1,2,3,4,5)]
  if active:
   new=[float(active[0][1]),max(float(x[2]) for x in active),
    min(float(x[3]) for x in active),float(active[-1][4]),
    sum(float(x[5]) for x in active)]
  else:
   zeroH+=1
   new=[float(p[0][1]),max(float(x[2]) for x in p),
        min(float(x[3]) for x in p),float(p[-1][4]),0.0]
  if abs(old[3]-new[3])>max(1e-8,abs(old[3])*1e-8) or abs(old[4]-new[4])>max(1e-7,abs(old[4])*1e-7):
   raise ValueError("H1_M5_CLOSE_VOLUME_CONFLICT:"+symbol+":"+str(t))
  if any(abs(a-b)>max(1e-8,abs(a)*1e-8) for a,b in zip(old,new)):price_diffs+=1
  entry=list(z)
  valid=(old[2]<=min(old[0],old[3]) and old[1]>=max(old[0],old[3]))
  if not valid:
   if symbol!="BTCUSDT":raise ValueError("MALFORMED_PENGU_H1")
   if not (new[2]<=min(new[0],new[3]) and new[1]>=max(new[0],new[3])):
    raise ValueError("M5_DOES_NOT_CURE_MALFORMED_BTC_H1")
   entry[2]=str(new[1]);entry[3]=str(new[2])
   fixes.append({"ts":t,"UTC":dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).isoformat(),
     "raw_OHLCV":old,"from_positive_volume_M5":new,
     "fields_changed":["high","low"]})
  totalhours+=1;allout.append(entry)
 if totalhours!=1296:raise ValueError("H1_COUNT_WRONG")
 payload=("\n".join(json.dumps(x,ensure_ascii=False,separators=(",",":")) for x in allout)+"\n").encode()
 name=f"{symbol}-1h-20250801-20250924-RESEARCH_M5QA.jsonl.gz"
 with gzip.open(OUT/name,"wb",compresslevel=6) as f:f.write(payload)
 with gzip.open(OUT/name,"rb") as f:
  if f.read()!=payload:raise ValueError("RESEARCH_REPAIR_OUTPUT_CORRUPT")
 report["symbol"][symbol]={"checked":totalhours,"raw_H1_OHLCV_malformed":len(fixes),
  "fixed_bars":fixes,"hours_m5_vs_native_any_field_different":price_diffs,
  "fully_zero_volume_hours":zeroH,"m5_unverifiable_intrabar_extremes":invalid_m5,
  "quarantined_M5_raw":quarantined_m5,
  "source_ohlc_quality":"AMBIGUOUS_ONE_M5_EXTREME_BOUNDED_IN_RESEARCH" if invalid_m5 else "ALL_M5_VALID",
  "qa_file":name,
  "raw_sha256":hashlib.sha256(hp.read_bytes()).hexdigest(),
  "m5_sha256":hashlib.sha256(mp.read_bytes()).hexdigest(),
  "research_qa_sha256":hashlib.sha256(payload).hexdigest()}
 print("QA_SOURCE",symbol,"checked",totalhours,"fixed_H1",len(fixes),
   "field_differences",price_diffs,"zero_trade_hours",zeroH,flush=True)
report["status"]="H1_M5_SOURCE_QA_COMPLETE"
(OUT/"PREBASELINE_H1_M5_COHERENCE_QA.json").write_text(
 json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")
print("PREBASELINE_H1_M5_QUALITY_GATE_PASS",flush=True)
