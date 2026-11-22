#!/usr/bin/env python3
"""P61 read-only Binance official FUTURES USD-M PENGU/BTC H1 2024Dec-2025Jul.

Fetch published monthly public klines + .CHECKSUM, verify SHA256, zip CRC,
source monotonicity, shared calendar and OHLC. No keys or exchange trades.
Store in the user-owned DisDex Research P61 work area only.
Do not modify pinned adapter, LIVE, master, orders, Runner, STOP or kill-switch.
"""
from __future__ import annotations
import hashlib,urllib.request,zipfile,io,csv,json,gzip,datetime,re,os,time
from pathlib import Path
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
DST=ROOT/"p61_new_prebaseline_archive_futures_um_202412_202507"
MONTHS=("2024-12","2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07")
SYMBOLS=("PENGUUSDT","BTCUSDT")
URL="https://data.binance.vision/data/futures/um/monthly/klines"
H=3600000
WARM=int(datetime.datetime(2024,12,18,tzinfo=datetime.timezone.utc).timestamp()*1000)
ENDS=int(datetime.datetime(2025,8,1,tzinfo=datetime.timezone.utc).timestamp()*1000)
def sha(b):return hashlib.sha256(b).hexdigest()
def fetch(url):
 q=urllib.request.Request(url,headers={"User-Agent":"DisDexResearchPublicReadOnly/1.0","Accept":"*/*"})
 with urllib.request.urlopen(q,timeout=24) as r:
  if r.status!=200:raise ValueError("P61_BAD_HTTP_STATUS")
  return r.read()
def main():
 DST.mkdir(parents=True,exist_ok=True)
 records={}
 hashes={}
 file_manifest=[]
 for sym in SYMBOLS:
  merged={}
  for month in MONTHS:
   base=f"{URL}/{sym}/1h/{sym}-1h-{month}.zip"
   filename=f"{sym}-1h-{month}.zip"
   zip_path=DST/filename
   if zip_path.exists():
    data=zip_path.read_bytes()
   else:
    data=fetch(base)
    if len(data)>1000000:raise ValueError("P61_UNEXPECTED_ARCHIVE_SIZE:"+filename)
    zip_path.write_bytes(data)
   actual=sha(data)
   checksum=fetch(base+".CHECKSUM").decode("utf8").strip()
   published=checksum.split()[0].strip().lower()
   if not re.fullmatch(r"[a-f0-9]{64}",published):raise ValueError("P61_BAD_PUBLISHED_CHECKSUM:"+base)
   if actual!=published:raise ValueError("P61_SHA256_MISMATCH:"+base)
   z=zipfile.ZipFile(io.BytesIO(data))
   bad=z.testzip()
   if bad is not None:raise ValueError("P61_ZIP_CRC_FAIL:"+str(bad))
   csvnames=[f for f in z.namelist() if f.lower().endswith(".csv")]
   if len(csvnames)!=1:raise ValueError("P61_ARCHIVE_CSV_COUNT")
   content=z.read(csvnames[0]).decode("utf-8-sig").splitlines()
   sourceCount=0
   for line in csv.reader(content):
     if not line or not line[0].isdigit():continue
     if len(line)<11:raise ValueError("P61_FUTURES_H1_COLUMNS_MISSING")
     ts=int(line[0])
     if not(10**12<=ts<10**13):raise ValueError("P61_EXPECT_MILLISECONDS_FUTURES")
     o,h,l,c,v=map(float,line[1:6])
     if not (0<l<=min(o,c)<=max(o,c)<=h and v>=0):
       raise ValueError("P61_INVALID_H1_BAR:"+sym+":"+str(ts))
     row=[ts,*line[1:]]
     if ts in merged and row!=merged[ts]:raise ValueError("P61_CONFLICT_DUPLICATE")
     merged[ts]=row
     sourceCount+=1
   if sourceCount<200:raise ValueError("P61_MONTH_H1_TOO_FEW:"+sym+":"+month)
   file_manifest.append({"symbol":sym,"month":month,"url":base,
    "publishedSHA256":published,"actualSHA256":actual,
    "zipLength":len(data),"sourceRows":sourceCount})
   print("P61_VERIFIED_MONTH",sym,month,sourceCount,actual,flush=True)
  records[sym]=merged
  period=[ts for ts in sorted(merged) if WARM<=ts<ENDS]
  if period[0]!=WARM or period[-1]+H!=ENDS:
   raise ValueError("P61_SOURCE_MONTH_COVERAGE_GAP:"+sym)
  if any(period[i]-period[i-1]!=H for i in range(1,len(period))):
   raise ValueError("P61_UNEXPECTED_H1_GAP:"+sym)
  outfile=DST/(sym+"-1h-20241218-20250801-VERIFIED_FUTURES_UM.jsonl.gz")
  with gzip.open(outfile,"wt",encoding="utf8") as f:
   for ts in period:f.write(json.dumps(merged[ts],ensure_ascii=False,separators=(",",":"))+"\n")
  hashes[sym]={"rows":len(period),"calendarFirst":period[0],"calendarLastExclusive":period[-1]+H,
     "sourceGzSha256":sha(outfile.read_bytes()),"path":str(outfile)}
  print("P61_PERIOD_COMPLETE",sym,len(period),flush=True)
 if sorted(t for t in records["PENGUUSDT"] if WARM<=t<ENDS)!=sorted(t for t in records["BTCUSDT"] if WARM<=t<ENDS):
  raise ValueError("P61_BTC_PENGU_H1_UNALIGNED")
 manifest={"schema":"prism7-p61-binance-official-h1-archive-public-checksum-source/v1",
  "source":"Binance Data Vision Futures USD-M monthly PENGUUSDT & BTCUSDT",
  "monthlyOfficialChecksumVerified":True,"calendarFullContiguousAndAligned":True,
  "startUTC":"2024-12-18T00:00:00Z","endExclusiveUTC":"2025-08-01T00:00:00Z",
  "sourceMonths":list(MONTHS),"symbols":list(SYMBOLS),
  "sourceManifest":file_manifest,"derivedSource":hashes,
  "noAuthOrSignedVenueFills":True,"sourceLiveOrdersAndProductionChanged":False,
  "historicalSourcePriorResearchInspectionNotGuaranteedNew":True,
  "previouslySourceH1DatasetIncludedDatesPriorTo2025AugUnknown":True,
  "originalPinnedSignalRuntimeStillToReproduce":True,
  "originalSource53AlreadyStudiedAug2025Nov2026":True}
 outfile=ROOT/"results"/"PRISM7_P61_NEW_EARLIER_H1_ARCHIVE_SOURCE_MANIFEST_20261122.json"
 outfile.write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 print("P61_SOURCE_DATA_COMPLETE_VERIFIED",json.dumps({"sourceMonths":16,"alignedHours":hashes["PENGUUSDT"]["rows"],"manifest":str(outfile)},ensure_ascii=False),flush=True)
if __name__=="__main__":main()
