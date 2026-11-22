#!/usr/bin/env python3
"""P96: verify official Binance Futures UM 1h OHLCV for all non-V52 DisDex
crypto research symbols; 2025-07 .. 2026-09 inclusive (last exclusive Oct1).
No private API key. Each exchange-published monthly ZIP SHA256 .CHECKSUM
checked before parsing. Missing/delisted symbols or incomplete candles fail
closed per symbol/time interval; never fill absent closes with fabricated data.
"""
from __future__ import annotations
from pathlib import Path
import urllib.request,urllib.error,concurrent.futures,hashlib,gzip,json,io,zipfile,csv
import collections,datetime,time,re,os,sys
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
RAW=ROOT/"p96_non_v52_binance_verified"/"official_zip"
MERGED=ROOT/"p96_non_v52_binance_verified"/"verified_h1"
OUT=ROOT/"results"/"PRISM7_P96_NONV52_ALL_SOURCES_BINANCE_USDM_H1_202507_202610_OFFICIAL_SHA_MANIFEST_20261122.json"
SYMS=("AAVEUSDT","ADAUSDT","NEARUSDT","DOGEUSDT","SOLUSDT","XRPUSDT","BNBUSDT",
 "AVAXUSDT","INJUSDT","LINKUSDT","ATOMUSDT","LTCUSDT","FETUSDT","APTUSDT",
 "UNIUSDT","RENDERUSDT","JUPUSDT","TIAUSDT","TAOUSDT","DOTUSDT","HYPEUSDT")
PRE_VERIFIED=("BTCUSDT","ETHUSDT","PENGUUSDT")
MONTHS=[f"{y:04d}-{m:02d}" for y in (2025,2026) for m in range(1,13) if (y,m)>=(2025,7) and (y,m)<=(2026,9)]
T0=1751328000000;T1=1790812800000;H=3600000
assert len(MONTHS)==15 and len(SYMS)==21
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def url(sym,mo):
 return f"https://data.binance.vision/data/futures/um/monthly/klines/{sym}/1h/{sym}-1h-{mo}.zip"
def fetch(u):
 err=None
 for attempt in range(3):
  try:
   req=urllib.request.Request(u,headers={"User-Agent":"DisDex-Research-P96-PublicReadOnly/1.0","Accept":"*/*"})
   with urllib.request.urlopen(req,timeout=22) as r:
    assert r.status==200
    data=r.read(5_000_000)
    if r.read(1):raise RuntimeError("ZIP_SIZE_OVER5MB")
    return data
  except urllib.error.HTTPError as ex:
   if ex.code in (404,410):return None
   err=str(ex)
  except (urllib.error.URLError,TimeoutError,ConnectionError) as ex:err=str(ex)
  if attempt<2:time.sleep(.5*(attempt+1))
 raise RuntimeError("BINANCE_SOURCE_FETCH_FAILURE "+u+" "+str(err))
def task(sym,mo):
 name=f"{sym}-1h-{mo}.zip"
 p=RAW/sym/name
 c=p.with_name(name+".CHECKSUM")
 p.parent.mkdir(exist_ok=True,parents=True)
 if p.exists() and c.exists():
  z=p.read_bytes();body=c.read_bytes()
 else:
  z=fetch(url(sym,mo))
  if z is None:return {"sym":sym,"mo":mo,"status":"MISSING_PUBLISHED_ARCHIVE"}
  body=fetch(url(sym,mo)+".CHECKSUM")
  if body is None:raise RuntimeError("OFFICIAL_CHECKSUM_MISSING "+name)
 checksum=body.decode("utf-8").strip().split()[0]
 if not re.fullmatch(r"[a-f0-9]{64}",checksum):raise ValueError("BAD_OFFICIAL_CHECKSUM "+name)
 if hashlib.sha256(z).hexdigest()!=checksum:raise ValueError("CHECKSUM_MISMATCH "+name)
 with zipfile.ZipFile(io.BytesIO(z)) as arc:
  assert arc.testzip() is None
  src=[x for x in arc.namelist() if x.endswith(".csv")]
  assert len(src)==1
  b=arc.read(src[0])
 start=int(datetime.datetime.fromisoformat(mo+"-01T00:00:00+00:00").timestamp()*1000)
 y,m=map(int,mo.split("-")); y2,m2=(y+1,1) if m==12 else (y,m+1)
 end=int(datetime.datetime(y2,m2,1,tzinfo=datetime.timezone.utc).timestamp()*1000)
 bars=[];seen=set()
 for row in csv.reader(io.StringIO(b.decode("utf-8-sig"))):
  if not row or not row[0].isdigit():continue
  if len(row)<11:raise ValueError("CSV_FIELDS_LT11 "+name)
  ts=int(row[0]);op,hi,lo,close,volume=map(float,row[1:6])
  if not(start<=ts<end and ts%H==0 and 0<lo<=min(op,close)<=max(op,close)<=hi and volume>=0):raise ValueError("SOURCE_BAD_ROW "+name)
  if ts in seen:raise ValueError("SOURCE_DUPLICATE_TIME "+name)
  seen.add(ts);bars.append([ts,op,hi,lo,close,volume])
 bars.sort(key=lambda z:z[0])
 if not bars:raise ValueError("EMPTY_SOURCE_CSV "+name)
 if not p.exists():p.write_bytes(z)
 if not c.exists():c.write_bytes(body)
 return {"sym":sym,"mo":mo,"status":"VERIFIED_OFFICIAL","zipSHA256":checksum,
  "zipPath":str(p),"rows":len(bars),"startTs":bars[0][0],"endTs":bars[-1][0],
  "monthsHours":(end-start)//H,"missingHourlyRows":(end-start)//H-len(bars),
  "bars":bars}
def main():
 RAW.mkdir(parents=True,exist_ok=True);MERGED.mkdir(parents=True,exist_ok=True)
 inputs=[(sym,mo) for sym in SYMS for mo in MONTHS]
 print("P96_BINANCE_SOURCE_VERIFY_START",len(inputs),"official ZIP+CHECKSUM pairs; concurrency6; no keys",flush=True)
 out=[];bad=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
  future={pool.submit(task,*z):z for z in inputs}
  for k,f in enumerate(concurrent.futures.as_completed(future),1):
   sym,mo=future[f]
   try:out.append(f.result())
   except Exception as ex:
    bad.append({"symbol":sym,"month":mo,"type":type(ex).__name__,"error":str(ex)[:220]})
   if k%25==0 or k==len(inputs):
    print("P96_DOWNLOAD_PROGRESS",k,len(inputs),
      "verified",sum(z["status"]=="VERIFIED_OFFICIAL" for z in out),
      "missing",sum(z["status"]!="VERIFIED_OFFICIAL" for z in out),"errors",len(bad),flush=True)
 bysym=collections.defaultdict(list)
 for z in out:bysym[z["sym"]].append(z)
 summaries={}
 for sym in SYMS:
  months=sorted(bysym[sym],key=lambda z:z["mo"])
  records=[z for z in months if z["status"]=="VERIFIED_OFFICIAL"]
  rows={}
  for record in records:
   for bar in record["bars"]:
    ts=bar[0]
    if ts in rows:raise ValueError("CROSS_MONTH_DUPLICATE "+sym)
    rows[ts]=bar
  timeline=sorted(rows)
  if timeline:
   assert timeline[0]>=T0 and timeline[-1]<T1
   missing=sum(timeline[i]-timeline[i-1]>H for i in range(1,len(timeline)))
   fp=MERGED/f"{sym}-1h-20250701-20261001-FUTURES_UM_VERIFIED.jsonl.gz"
   with fp.open("wb") as f:
    with gzip.GzipFile(fileobj=f,mode="wb",filename="",mtime=0,compresslevel=6) as gz:
     for ts in timeline:gz.write((json.dumps(rows[ts],ensure_ascii=True,separators=(",",":"))+"\n").encode("ascii"))
  else:fp=None;missing=None
  summaries[sym]={"verifiedArchiveMonths":[z["mo"] for z in records],
    "missingArchiveMonths":[z["mo"] for z in months if z["status"]!="VERIFIED_OFFICIAL"],
    "unverifiedErrorMonths":[z["month"] for z in bad if z["symbol"]==sym],
    "validatedHourBars":len(timeline),
    "betweenListedBarGaps":missing,
    "earliestTs":timeline[0] if timeline else None,
    "lastTs":timeline[-1] if timeline else None,
    "seriesGzip":str(fp) if fp else None,
    "seriesSHA256":sha(fp) if fp else None,
    "completeCalendar":len(timeline)==(T1-T0)//H and len(records)==len(MONTHS),
    "missingHoursNotForwardFilled":True}
  print("P96_SYMBOL",sym,len(records),"/15months","H1",len(timeline),
    "gapCount",missing,"gzip_sha",summaries[sym]["seriesSHA256"],flush=True)
 manifest={"schema":"prism7-p96-all-nonV52-SHA-verified-binance-UM-H1-2025July-2026Sept/v1",
  "status":"BINANCE_PUBLIC_SOURCE_COVERAGE_RESEARCH_ONLY",
  "referenceUSDMarket":"BINANCE_FUTURES_UM","userKeysNeeded":False,
  "months":MONTHS,"startTsInclusive":T0,"endTsExclusive":T1,
  "officialArchiveRequested":len(inputs),
  "officialArchiveVerified":sum(z["status"]=="VERIFIED_OFFICIAL" for z in out),
  "officialMissingArchives":[{k:z[k] for k in ("sym","mo","status")} for z in out if z["status"]!="VERIFIED_OFFICIAL"],
  "errors":bad,
  "perSymbol":summaries,
  "archives":[{k:v for k,v in z.items() if k!="bars"} for z in out],
  "alreadyP70VerifiedBTCETHPenguH1":True,
  "missingBinanceSymbolOrMissingAsOfTimeMustBlockDualScore":True,
  "noRealOrderOrProductionMutation":True,
  "provenance":"https://data.binance.vision/data/futures/um/monthly/klines",
  "sourceRole":"Binance as independent *context* for all nonV52 original Aster native signals. Binance-source native trade conditions not yet independently verified for nonPENGU."}
 OUT.write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 print("P96_DOWNLOAD_SOURCE_VALIDATION_DONE",json.dumps({
  "archivesVerified":manifest["officialArchiveVerified"],"requests":manifest["officialArchiveRequested"],
  "errors":len(bad),"missing":len(manifest["officialMissingArchives"]),
  "symbolsComplete":sum(x["completeCalendar"] for x in summaries.values())},ensure_ascii=False),flush=True)
 print("MANIFEST",OUT)
if __name__=="__main__":main()
