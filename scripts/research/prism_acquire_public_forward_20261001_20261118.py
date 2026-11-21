#!/usr/bin/env python3
"""Research-only unsigned public Aster 2026-10/11 forward market acquisition.

No authentication or account endpoints; never changes LIVE, Orders, STOP,
state or wallet. Refuses partial/gapped candle sequences and writes SHA256.
"""
from __future__ import annotations
import datetime as dt,gzip,hashlib,json,sys,time,urllib.parse,urllib.request
from pathlib import Path
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd()/"PRISM_FORWARD_PUBLIC"
OUT.mkdir(parents=True,exist_ok=True)
BASE="https://fapi.asterdex.com/fapi/v3/klines"
START=int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2026,11,18,tzinfo=dt.timezone.utc).timestamp()*1000)
CHARTS={"1h":3600000,"5m":300000}
SETS={"1h":("PENGUUSDT","BTCUSDT"),"5m":("PENGUUSDT","BTCUSDT")}
assert END<dt.datetime.now(dt.timezone.utc).timestamp()*1000-3*24*3600000
def query(symbol,interval,start,end):
 args=urllib.parse.urlencode({"symbol":symbol,"interval":interval,"startTime":start,
     "endTime":end-1,"limit":1000})
 url=BASE+"?"+args
 for n in range(4):
  try:
   req=urllib.request.Request(url,headers={"User-Agent":"DisDex-PRISM-ReadOnly-Historical/1.0"})
   with urllib.request.urlopen(req,timeout=30) as response:
    if response.status!=200:raise RuntimeError("HTTP_NOT_OK")
    data=json.loads(response.read(2_000_000).decode("utf8"))
    if not isinstance(data,list):raise ValueError("PUBLIC_API_UNEXPECTED_RESPONSE")
    return data
  except (OSError,TimeoutError) as exc:
   if n==3:raise
   time.sleep(1.5*(n+1))
 raise RuntimeError("UNREACHABLE")
def acquire(symbol,interval):
 bar_ms=CHARTS[interval]
 expected=(END-START)//bar_ms
 cursor=START;values={};requests=0
 while cursor<END:
  lines=query(symbol,interval,cursor,END);requests+=1
  if len(lines)==0:raise ValueError("EMPTY_PUBLIC_DATA:"+symbol+":"+interval+":"+str(cursor))
  newest=cursor-bar_ms
  for row in lines:
   if not isinstance(row,list) or len(row)<11:raise ValueError("BAD_CANDLE_LAYOUT")
   t=int(row[0])
   if t<cursor or t>=END or (t-START)%bar_ms:raise ValueError("OUTSIDE_OR_NON_ALIGNED_TIME")
   o,h,l,c,v=(float(row[i]) for i in (1,2,3,4,5))
   if not min(o,h,l,c)>0 or not h>=max(o,l,c) or not l<=min(o,h,c) or v<0:raise ValueError("INVALID_OHLCV")
   if t in values:raise ValueError("DUPLICATE_TIME")
   values[t]=row
   newest=max(newest,t)
  if newest<cursor:raise ValueError("CURSOR_NO_PROGRESS")
  cursor=newest+bar_ms
  if requests>100:raise ValueError("TOO_MANY_REQUESTS")
  time.sleep(.08)
 times=sorted(values)
 if len(times)!=expected or times[0]!=START or times[-1]!=END-bar_ms:
  raise ValueError("MISSING_PUBLIC_CANDLES:"+json.dumps({"expected":expected,"actual":len(times),"first":times[0],"last":times[-1]}))
 if any(times[i]-times[i-1]!=bar_ms for i in range(1,len(times))):
  raise ValueError("GAPPED_PUBLIC_CANDLES")
 raw=("\n".join(json.dumps(values[t],ensure_ascii=False,separators=(",",":")) for t in times)+"\n").encode("utf8")
 sha=hashlib.sha256(raw).hexdigest()
 dest=OUT/f"{symbol}-{interval}-20261001-20261118.jsonl.gz"
 with gzip.open(dest,"wb",compresslevel=6) as f:f.write(raw)
 with gzip.open(dest,"rb") as f:
  verify=hashlib.sha256(f.read()).hexdigest()
 if verify!=sha:raise ValueError("DATA_WRITE_HASH_MISMATCH")
 return {"symbol":symbol,"interval":interval,"rows":len(times),"expectedRows":expected,
   "firstOpenMs":times[0],"lastOpenMs":times[-1],"uncompressedSha256":sha,
   "gzipFileSha256":hashlib.sha256(dest.read_bytes()).hexdigest(),
   "file":dest.name,"requests":requests,"status":"COMPLETE_COVERAGE"}
manifest={"schema":"disdex-prism-new-public-forward-h1-m5/v1",
 "beginUTC":"2026-10-01T00:00:00Z","endExclusiveUTC":"2026-11-18T00:00:00Z",
 "provider":"Aster public unsigned futures v3 /fapi/v3/klines",
 "scope":"independent forward check ONLY; does not modify the original fixed 2025-2026 BT",
 "orders_sent":0,"data_access":"unsigned public GET","files":{},
 "limitations":["No actual exchange order execution or funding is verified",
 "Historical market candles are separate from executable book/mark prices",
 "Research forward data may not be fully unseen to other researchers; ensure signal freeze"] }
for interval,symbols in SETS.items():
 for symbol in symbols:
  k=f"{symbol}:{interval}"
  try:
   result=acquire(symbol,interval)
   manifest["files"][k]=result
   print("PUBLIC_DATA",k,result["rows"],"SHA",result["uncompressedSha256"],flush=True)
  except Exception as ex:
   manifest["files"][k]={"status":"BLOCKED_INCOMPLETE","error":repr(ex)}
   print("DATA_BLOCKED",k,repr(ex),flush=True)
(OUT/"PUBLIC_FORWARD_MANIFEST.json").write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
if any(x["status"]!="COMPLETE_COVERAGE" for x in manifest["files"].values()):
 raise SystemExit("FAIL_CLOSED_MARKET_DATA_INCOMPLETE")
print("PUBLIC_FORWARD_FULL_COVERAGE_PASS",len(manifest["files"]),flush=True)
