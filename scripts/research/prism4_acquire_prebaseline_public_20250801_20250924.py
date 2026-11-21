#!/usr/bin/env python3
"""PRISM IV: obtain a temporally separate PRE-baseline PENGU/BTC data slice.

2025-08-01 00:00Z to 2025-09-24 00:00Z exclusive, prior to the pinned
BT start 2025-10-01. This data MUST NOT be used to tune the candidate
strategy and call the same slice blind OOS afterward.

Only Aster public unsigned GET historical bars, deterministic source SHA.
No account API or real trade calls. Fail-closed on any data hole.
"""
from __future__ import annotations
from pathlib import Path
import datetime as dt,gzip,hashlib,json,sys,time,urllib.request,urllib.parse,math
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd()/"PRISM_PREBASELINE_PUBLIC"
OUT.mkdir(parents=True,exist_ok=True)
START=int(dt.datetime(2025,8,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2025,9,24,tzinfo=dt.timezone.utc).timestamp()*1000)
URL="https://fapi.asterdex.com/fapi/v3/klines"
INTERVALS={"1h":3600000,"5m":300000}
SYMS=("PENGUUSDT","BTCUSDT")
def request(sym,interval,cursor):
 params=urllib.parse.urlencode({
  "symbol":sym,"interval":interval,"startTime":cursor,
  "endTime":END-1,"limit":1000})
 req=urllib.request.Request(URL+"?"+params,headers={"User-Agent":"DisDex-PRISM-ReadOnly-Historical-Verification/1.0"})
 for attempt in range(4):
  try:
   with urllib.request.urlopen(req,timeout=35) as response:
    if response.status!=200:raise ValueError("NON_200")
    a=json.loads(response.read(1200000))
   if not isinstance(a,list):raise ValueError("BAD_PUBLIC_RESPONSE")
   return a
  except (OSError,TimeoutError) as exc:
   if attempt==3:raise
   time.sleep(attempt+1)
 raise RuntimeError("UNREACHABLE")
def acquire(sym,interval,bar):
 data={};cursor=START;calls=0;anomalies=[]
 while cursor<END:
  a=request(sym,interval,cursor)
  calls+=1
  if not a:raise RuntimeError("MISSING_PUBLIC_HISTORY:"+sym+interval+str(cursor))
  n=cursor-bar
  for x in a:
   if not isinstance(x,list) or len(x)<11:raise ValueError("BAR_FIELD_COUNT")
   t=int(x[0])
   if not START<=t<END or (t-START)%bar:raise ValueError("INVALID_BAR_TIME")
   o,h,l,c,v=(float(x[i]) for i in (1,2,3,4,5))
   if not all(map(math.isfinite,(o,h,l,c,v))) or min(o,h,l,c)<=0 or v<0:
    raise ValueError("BAD_PRICE_OR_VOLUME")
   if not(l<=min(o,c,h) and h>=max(o,c,l)):
    if sym!="BTCUSDT":raise ValueError("NON_BTC_MALFORMED_OHLC")
    anomalies.append({"ts":t,"open":o,"high":h,"low":l,"close":c})
   if t in data:raise ValueError("DUPLICATED_PUBLIC_BAR")
   data[t]=x;n=max(t,n)
  if n<cursor:raise ValueError("STUCK_CURSOR")
  cursor=n+bar
  time.sleep(.06)
 expected=(END-START)//bar
 times=sorted(data)
 if len(times)!=expected or times[0]!=START or times[-1]!=END-bar:
  raise ValueError("MISSING_PREBASELINE_COVERAGE:"+str({"got":len(times),"expected":expected}))
 if any(times[i]!=START+i*bar for i in range(len(times))):
  raise ValueError("INTRA_DAY_TIME_HOLES")
 payload=("\n".join(json.dumps(data[t],ensure_ascii=False,separators=(",",":")) for t in times)+"\n").encode()
 file=OUT/f"{sym}-{interval}-20250801-20250924.jsonl.gz"
 with gzip.open(file,"wb",compresslevel=6) as f:f.write(payload)
 with gzip.open(file,"rb") as f:
  if f.read()!=payload:raise ValueError("ROUNDTRIP_FILE_CORRUPT")
 return {"symbol":sym,"interval":interval,"rows":expected,
  "begin":START,"endExclusive":END,
  "sha256_uncompressed":hashlib.sha256(payload).hexdigest(),
  "sha256_gzip":hashlib.sha256(file.read_bytes()).hexdigest(),
  "file":file.name,"requests":calls,"status":"COMPLETE_COVERAGE","malformed_BTC_OHLCV_bars":anomalies}
manifest={"schema":"disdex-prism-prebaseline-public-20250801-20250924/v1",
 "provider":"Aster /fapi/v3/klines, unsigned public GET","intervals":{},
 "research_only":True,"source_does_not_include_private_fills":True}
for interval,bar in INTERVALS.items():
 for sym in SYMS:
  key=sym+":"+interval
  try:
   z=acquire(sym,interval,bar)
   manifest["intervals"][key]=z
   print("PREBASELINE_SOURCE_COMPLETE",key,z["rows"],z["sha256_uncompressed"],flush=True)
  except Exception as exc:
   manifest["intervals"][key]={"status":"BLOCKED_INCOMPLETE","error":repr(exc)}
   print("PREBASELINE_SOURCE_FAILURE",key,repr(exc),flush=True)
(OUT/"PREBASELINE_SHA256_MANIFEST.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
if any(z["status"]!="COMPLETE_COVERAGE" for z in manifest["intervals"].values()):
 raise SystemExit("FAIL_CLOSED_PREBASELINE_DATA_NOT_COMPLETE")
print("PREBASELINE_H1_M5_DATA_VERIFIED",len(manifest["intervals"]),flush=True)
