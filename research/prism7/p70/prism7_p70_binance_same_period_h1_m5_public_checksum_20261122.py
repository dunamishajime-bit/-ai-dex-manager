#!/usr/bin/env python3
"""P70 matching-calendar Binance UM historic archive collection / verification.

UTC July 2025 warmup; exact common research Aug 2025-Nov 17 2026.
Binance Futures USD-M public monthly July25-Oct26 + daily Nov1-17 2026.
PENGUUSDT & BTCUSDT: 1h and 5m. ETHUSDT: 1h macro market.
Verify published sha256 per ZIP, ZIP CRC, H1/M5 time-grain, candle OHLCV,
time continuity + PENGU/BTC and ETH H1 intersection and native53 Aster UTC coverage.
No API key, account, trade or production modifications.

Source data is a DIFFERENT venue from Aster, never mix prices and exits.
Research ONLY. Archive file will NOT be considered validated until all archive,
checksums and calendar predicates succeed.
"""
from __future__ import annotations
from pathlib import Path
import urllib.request,urllib.error,hashlib,re,zipfile,io,csv,json,gzip
import concurrent.futures,datetime,calendar,os,time,collections,sys
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
RAW=ROOT/"p70_binance_same_aster_period_202507_202611"/"verified_zip"
MERGED=ROOT/"p70_binance_same_aster_period_202507_202611"/"verified_series"
RESULT=ROOT/"results"
H=3600000;M5=300000
START="2025-07-01T00:00:00+00:00"
END_EXCLUSIVE="2026-11-18T00:00:00+00:00"
MATCH_START="2025-08-01T00:00:00+00:00"
NATIVE=RESULT/"PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json"
MANIFEST=RESULT/"PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_PUBLIC_ARCHIVE_MANIFEST_20261122.json"
SUMMARY=RESULT/"PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_SOURCE_COVERAGE_20261122.md"
SERIES=(("PENGUUSDT","1h"),("PENGUUSDT","5m"),
 ("BTCUSDT","1h"),("BTCUSDT","5m"),("ETHUSDT","1h"))
TS_START=int(datetime.datetime.fromisoformat(START).timestamp()*1000)
TS_END=int(datetime.datetime.fromisoformat(END_EXCLUSIVE).timestamp()*1000)
TS_MATCH=int(datetime.datetime.fromisoformat(MATCH_START).timestamp()*1000)
DATA_BASE="https://data.binance.vision/data/futures/um/"
MONTHS=[f"{yr:04d}-{m:02d}" for yr in (2025,2026)
 for m in range(1,13) if (yr,m)>=(2025,7) and (yr,m)<=(2026,10)]
DAYS=[f"2026-11-{d:02d}" for d in range(1,18)]
assert len(MONTHS)==16 and len(DAYS)==17 and len(SERIES)==5

def sha(b):return hashlib.sha256(b).hexdigest()
def tstamp(ms):return datetime.datetime.fromtimestamp(ms/1000,datetime.timezone.utc).isoformat()
def fetch(url):
 req=urllib.request.Request(url,headers={"User-Agent":"DisDex-BT-Public-ReadOnly/1.0","Accept":"*/*"})
 err=None
 for k in range(3):
  try:
   with urllib.request.urlopen(req,timeout=24) as response:
    if response.status!=200:raise ValueError("HTTP_NOT_OK:"+str(response.status))
    return response.read()
  except (urllib.error.URLError,TimeoutError,ConnectionError) as e:
   err=e
   if k<2:time.sleep(.6*(k+1))
 raise RuntimeError("FETCH_FAILED "+url+" "+repr(err))
def task_list():
 tasks=[]
 for sym,tf in SERIES:
  for mo in MONTHS:
   name=f"{sym}-{tf}-{mo}.zip"
   url=DATA_BASE+f"monthly/klines/{sym}/{tf}/{name}"
   tasks.append((sym,tf,mo,"monthly",name,url))
  for d in DAYS:
   name=f"{sym}-{tf}-{d}.zip"
   url=DATA_BASE+f"daily/klines/{sym}/{tf}/{name}"
   tasks.append((sym,tf,d,"daily",name,url))
 return tasks
def get_one(t):
 sym,tf,period,gran,name,url=t
 local=RAW/sym/tf/gran/name
 checksum=local.with_name(local.name+".CHECKSUM")
 local.parent.mkdir(parents=True,exist_ok=True)
 a=local.read_bytes() if local.exists() else fetch(url)
 txt=checksum.read_bytes() if checksum.exists() else fetch(url+".CHECKSUM")
 published=txt.decode("utf8").strip().split()[0].strip().lower()
 if not re.fullmatch(r"[a-f0-9]{64}",published):
  raise RuntimeError("BAD_OFFICIAL_CHECKSUM_TEXT:"+name)
 actual=sha(a)
 if actual!=published:
  # Never silently trust stale downloaded local ZIP on mismatch
  if local.exists():
   a=fetch(url)
   actual=sha(a)
  if actual!=published:raise RuntimeError("PUBLIC_SHA256_MISMATCH:"+name)
 with zipfile.ZipFile(io.BytesIO(a)) as z:
  if z.testzip() is not None:raise RuntimeError("ZIP_CRC_FAILED:"+name)
  names=[k for k in z.namelist() if k.lower().endswith(".csv")]
  if len(names)!=1:raise RuntimeError("ZIP_CSV_COUNT_INVALID:"+name)
  raw=z.read(names[0])
  header=raw[:100]
  if not(raw and len(raw)>80):raise RuntimeError("ZIP_CSV_EMPTY:"+name)
  # Check exactly 11+ Binance futures OHLCV CSV fields and expected timestamp
  headrow=next(csv.reader(io.StringIO(raw[:180].decode("utf-8-sig",errors="strict"))))
  if not headrow[0].isdigit():
   # some published CSV has a header row: allow under strict parser
   if headrow[0].strip().lower() not in ("open_time","opentime","open time"):
    raise RuntimeError("ZIP_UNEXPECTED_HEADER:"+name+":"+repr(headrow[0]))
  else:
   if len(headrow)<11:raise RuntimeError("ZIP_TOO_FEW_FIELDS:"+name)
 if not local.exists():
  tmp=local.with_name(local.name+".P70-INCOMPLETE")
  tmp.write_bytes(a);tmp.replace(local)
 if not checksum.exists():
  tmp=checksum.with_name(checksum.name+".P70-INCOMPLETE")
  tmp.write_bytes(txt);tmp.replace(checksum)
 return {"symbol":sym,"interval":tf,"granularity":gran,"period":period,
  "name":name,"url":url,"sha256Expected":published,
  "sha256Actual":actual,"rawZIPBytes":len(a),"csvBytes":len(raw),
  "localZIPPath":str(local)}

def parse_archive(task,stats):
 local=Path(task["localZIPPath"])
 with zipfile.ZipFile(local) as z:
  name=next(k for k in z.namelist() if k.lower().endswith(".csv"))
  raw=z.read(name).decode("utf-8-sig")
 step=H if task["interval"]=="1h" else M5
 key=(task["symbol"],task["interval"])
 out=stats[key]
 period=task["period"]
 if task["granularity"]=="monthly":
  y,m=map(int,period.split("-"))
  lo=int(datetime.datetime(y,m,1,tzinfo=datetime.timezone.utc).timestamp()*1000)
  y2,m2=(y+1,1) if m==12 else (y,m+1)
  hi=int(datetime.datetime(y2,m2,1,tzinfo=datetime.timezone.utc).timestamp()*1000)
 else:
  y,m,d=map(int,period.split("-"))
  lo=int(datetime.datetime(y,m,d,tzinfo=datetime.timezone.utc).timestamp()*1000)
  hi=lo+24*H
 rows=0
 for source in csv.reader(io.StringIO(raw)):
  if not source or not source[0].isdigit():continue
  if len(source)<11:raise ValueError("CSV_FIELD_COUNT_LT11:"+local.name)
  ts=int(source[0])
  if ts<lo or ts>=hi or ts%step!=0:raise ValueError("CSV_WRONG_PERIOD_OR_TIMESTEP:"+local.name+":"+str(ts))
  op,high,low,close,vol=map(float,source[1:6])
  if not(0<low<=min(op,close)<=max(op,close)<=high and vol>=0):
   raise ValueError("CSV_OHLCV_INCONSISTENT:"+local.name+":"+str(ts))
  if ts in out:
   if out[ts]!=source:raise ValueError("CSV_CONFLICTING_SOURCE_DUPLICATE:"+local.name)
   raise ValueError("CSV_DUPLICATE_BAR:"+local.name)
  out[ts]=source;rows+=1
 expected=(hi-lo)//step
 if rows!=expected:raise ValueError("CSV_MONTH_OR_DAY_INCOMPLETE:"+local.name+":"+str(rows)+"/"+str(expected))
 return rows

def main():
 RAW.mkdir(parents=True,exist_ok=True);MERGED.mkdir(parents=True,exist_ok=True)
 tasks=task_list()
 print("P70_START",len(tasks),"archive ZIPs plus CHECKSUM","source",START,"until",END_EXCLUSIVE,flush=True)
 errors=[];downloaded=[]
 # Bounds max 10 threads, moderate request load, no user secrets.
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
  futures={executor.submit(get_one,t):t for t in tasks}
  for k,f in enumerate(concurrent.futures.as_completed(futures),1):
   t=futures[f]
   try:downloaded.append(f.result())
   except Exception as e:
    errors.append({"archive":t[4],"error":str(e)})
    print("P70_ARCHIVE_FAILED",t[4],str(e)[:190],flush=True)
   if k%25==0 or k==len(tasks):
    print("P70_PROGRESS",k,"/",len(tasks),"verifiedZIP",len(downloaded),"failed",len(errors),flush=True)
 if errors:
  target=RESULT/"PRISM7_P70_ARCHIVE_DOWNLOAD_ERROR_20261122.json"
  target.write_text(json.dumps({"failedArchives":errors,"downloadedVerified":len(downloaded),
   "requested":len(tasks)},ensure_ascii=False,indent=2),encoding="utf8")
  raise RuntimeError("P70_FAIL_CLOSED_UNVERIFIED_ARCHIVES "+str(len(errors))+" "+str(target))
 downloaded.sort(key=lambda x:(x["symbol"],x["interval"],x["granularity"],x["period"]))
 states=collections.defaultdict(dict)
 for k,t in enumerate(downloaded,1):
  num=parse_archive(t,states)
  t["validatedRows"]=num
  if k%40==0 or k==len(downloaded):print("P70_PARSE",k,"/",len(downloaded),flush=True)
 sourceSummary={}
 expectedCount={}
 for sym,tf in SERIES:
  interval=H if tf=="1h" else M5
  v=states[(sym,tf)]
  times=sorted(v)
  expect=(TS_END-TS_START)//interval
  if len(times)!=expect or times[0]!=TS_START or times[-1]+interval!=TS_END:
   raise ValueError("P70_PERIOD_COVERAGE_MISMATCH:"+sym+":"+tf+":"+str(len(times))+"/"+str(expect))
  if any(times[i]-times[i-1]!=interval for i in range(1,len(times))):
   raise ValueError("P70_BAR_HOLE_OR_DUPLICATE:"+sym+":"+tf)
  output=MERGED/(f"{sym}-{tf}-20250701-20261118-FUTURES_UM_VERIFIED.jsonl.gz")
  # Deterministic gzip with mtime0 (gzip.GzipFile wrapper), portable SHA for source audit.
  import io
  with output.open("wb") as f:
   with gzip.GzipFile(filename="",mode="wb",compresslevel=6,mtime=0,fileobj=f) as gz:
    for ts in times:
     gz.write((json.dumps(v[ts],ensure_ascii=True,separators=(",",":"))+"\n").encode("ascii"))
  common=sum(t>=TS_MATCH for t in times)
  sourceSummary[f"{sym}|{tf}"]={"timeframe":tf,"symbol":sym,
    "bars":len(times),"commonBars":common,
    "firstTs":times[0],"lastTs":times[-1],"lastExclusiveTs":times[-1]+interval,
    "bytesCompressed":output.stat().st_size,"sha256Gzip":sha(output.read_bytes()),"path":str(output),
    "headerOrDuplicateSourceRows":False,"OHLCVPlausible":True,"minuteBarClockContiguous":True}
  expectedCount[f"{sym}|{tf}"]=expect
  print("P70_SERIES_COMPLETE",sym,tf,"bars",len(times),"matching",common,"sha",sourceSummary[f"{sym}|{tf}"]["sha256Gzip"],flush=True)
 # H1 aligned across PENGU/BTC/ETH, M5 aligned across PENGU/BTC, timestamp H1 covers every 12th M5.
 assert sorted(states[("PENGUUSDT","1h")])==sorted(states[("BTCUSDT","1h")])==sorted(states[("ETHUSDT","1h")])
 assert sorted(states[("PENGUUSDT","5m")])==sorted(states[("BTCUSDT","5m")])
 assert all(ts in states[("PENGUUSDT","5m")] and ts in states[("BTCUSDT","5m")] for ts in states[("PENGUUSDT","1h")])
 original=json.loads(NATIVE.read_text(encoding="utf8"))
 assert len(original)==53 and sum(z["net30pct"]>0 for z in original)==29
 nativeBegin=min(z["entryTs"] for z in original)
 nativeEnd=max(z["exitTs"] for z in original)
 assert TS_MATCH<nativeBegin<nativeEnd<TS_END
 for z in original:
  for sym,tf in SERIES:
   assert z["entryTs"] in states[(sym,tf)] and z["exitTs"] in states[(sym,tf)],(z["id"],sym,tf)
 # The same timestamps available for direct venue-to-venue comparison. NOT same price, entry or fill.
 comparison={"nativeSource53EntryCount":53,"originalAsterFirstEntryTs":nativeBegin,
  "originalAsterLastExitTs":nativeEnd,
  "all53SourceEntriesAndExitsPresentInEachBinanceSeries":True,
  "exactTimestampJoinPossible":True,"originalAsterOHLCVDifferentFromBinance":True,
  "sameClockDoesNotMeanSameExchangeEntrySignalOrSignedFill":True}
 manifest={"schema":"prism7-p70-binance-aster-common-calendar-official-public-verified-h1-m5/v1",
  "status":"SOURCE_ACQUISITION_AND_VERIFICATION_COMPLETE_NOT_CROSS_VENUE_OUTCOME_BT",
  "utcWarmupStartInclusive":START,"commonResearchStartInclusive":MATCH_START,
  "sourceEndExclusiveUTC":END_EXCLUSIVE,
  "monthlyDates":MONTHS,"dailyDates":DAYS,
  "officialArchiveCount":len(downloaded),"checksumsIndividuallyVerified":True,
  "archiveManifest":downloaded,"sourceSeries":sourceSummary,
  "AsterOriginalNative53CoverageAndJoin":comparison,
  "sourceSeriesExactlyTimeAligned":True,"noSourceBarHoles":True,
  "pinnedV20Source53NotRecalculatedOnBinanceYet":True,
  "priorBinanceJanJulResearchIsDifferentPeriod":True,
  "sourceNative53AsterNotVenueSignedFills":True,
  "productionMasterRunnerOrdersSTOPGrossUnchanged":True,
  "sourceReference":"https://data.binance.vision/data/futures/um",
  "limitations":["Binance Futures USD-M OHLCV can differ from original Aster research price; cross-venue comparison must use same timestamps but distinct prices.",
    "Native V20 source55 from previous Jan-Jul study is a different period, do not mix with this common-period data.",
    "Check Binance official source SHA and exact interval continuity. Matching timestamps do not prove native signal/STOP/funding/fees/venue fill identical.",
    "The terminal portion of November is daily archive assembled. Nov18 onward excluded; original Aster source53 exits all before excluded boundary.",
    "ETH available only H1 for broad market trend; BTC+PENGU both 1h and 5m for native stop replay.",
    "No live orders, credentials, margin, native V20 production STOP or risk change."]}
 tmp=MANIFEST.with_suffix(".json.tmp")
 tmp.write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 tmp.replace(MANIFEST)
 lines=["# P70 | Binance vs Aster same-calendar source data ready (official verified)",
  "",
  "Official public Binance Futures USD-M H1 & M5 for PENGUUSDT/BTCUSDT, ETHUSDT H1 only. Monthly July2025-Oct2026 plus daily Nov1-17 2026, "+str(len(downloaded))+" ZIP and published SHA256 verification, complete time continuity.",
  "",
  "**UTC warm-up:** "+START+" to "+END_EXCLUSIVE+" (exclusive). **Comparison:** "+MATCH_START+" to "+END_EXCLUSIVE+" (exclusive). All original Aster Native53 entry and exit timestamps exist for all Binance series.",
  "",
  "| Series | Bars incl warm-up | Comparison bars | ZIP checksums verified |",
  "|---|---:|---:|---:|"]
 for key,z in sourceSummary.items():
  lines.append("| "+key+" | "+str(z["bars"])+" | "+str(z["commonBars"])+" | YES |")
 lines+=["","Price/volume across Binance and Aster DIFFER. Direct timestamp join is now possible, but native PENGU SHORT V20 must be replayed on same UTC and matched separately. Collection and verification is NOT a confirmed same-time win-rate comparison.",
  "","Manifest: "+str(MANIFEST),"",
  "Production/Runner/STOP/Orders/Gross not modified.",""]
 SUMMARY.write_text("\n".join(lines),encoding="utf8")
 print("P70_ALL_OFFICIAL_ARCHIVES_SHA256_AND_TIME_ALIGNMENT_COMPLETE",json.dumps({
  "officialZipChecksums":len(downloaded),
  "sourceSeries":{k:{"bars":z["bars"],"common":z["commonBars"]} for k,z in sourceSummary.items()},
  "native53TimestampsAllAvailable":True,
  "manifest":str(MANIFEST),"summary":str(SUMMARY)},ensure_ascii=False),flush=True)
if __name__=="__main__":main()
