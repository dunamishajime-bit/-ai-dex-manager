from pathlib import Path
import urllib.request,hashlib,zipfile,io,csv,datetime,json,gzip,re,time
root=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122\binance_fet_1h_fill_20261123")
rawdir=root/"raw_archive";rawdir.mkdir(parents=True,exist_ok=True)
months=[f"2025-{m:02}" for m in range(3,13)]+["2026-01"]
M=3600000
allrows={};manifest=[];got=0
for month in months:
 name=f"FETUSDT-1h-{month}.zip"
 url=f"https://data.binance.vision/data/futures/um/monthly/klines/FETUSDT/1h/{name}"
 archive=rawdir/name
 checksum=rawdir/(name+".CHECKSUM")
 if not archive.exists():
  req=urllib.request.Request(url,headers={"User-Agent":"DisDex-P107-PublicMarketData/1.0"},method="GET")
  with urllib.request.urlopen(req,timeout=25) as r:
   if r.status!=200:raise RuntimeError("BINANCE_HTTP")
   b=r.read(850000)
  if not b.startswith(b"PK\x03\x04"):raise RuntimeError("NON_ZIP_OFFICIAL_SOURCE")
  archive.write_bytes(b)
 try:
  with urllib.request.urlopen(urllib.request.Request(url+".CHECKSUM",headers={"User-Agent":"DisDex-P107-PublicData/1.0"},method="GET"),timeout=13) as r:
   c=r.read(1000).decode("utf8","replace")
  m=re.search(r"\b([a-fA-F0-9]{64})\b",c)
  if not m:raise RuntimeError("CHECKSUM_FORMAT")
  checksum.write_text(c,encoding="utf8")
  expected=m.group(1).lower()
  if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise RuntimeError("BINANCE_OFFICIAL_CHECKSUM_MISMATCH:"+month)
  integrity="OFFICIAL_SHA256_CHECKSUM_VERIFIED"
 except urllib.error.HTTPError as e:
  if e.code!=404:raise
  integrity="ARCHIVE_SHA256_ONLY_OFFICIAL_CHECKSUM_UNAVAILABLE"
 raw=archive.read_bytes()
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  if z.testzip() is not None:raise RuntimeError("ARCHIVE_CRC_FAIL")
  files=z.namelist();assert len(files)==1 and files[0].endswith('.csv'),files
  text=z.read(files[0]).decode("utf-8-sig")
  count=0;first=None;last=None
  for x in csv.reader(io.StringIO(text)):
   if not x:continue
   try:ts=int(x[0])
   except ValueError:
    if x[0].strip().lower()=="open_time":continue
    raise
   if len(x)<11:raise RuntimeError("ROW_TOO_SHORT")
   ts2=int(x[6])
   a=[ts,str(x[1]),str(x[2]),str(x[3]),str(x[4]),str(x[5]),ts2,str(x[7]),str(x[8]),str(x[9]),str(x[10])]
   if ts%M or not ts2>=ts+M-1:raise RuntimeError("TIME_INTERVAL_INVALID")
   op,hi,lo,cl=[float(x[i]) for i in (1,2,3,4)]
   if min(op,hi,lo,cl)<=0 or hi<max(op,cl) or lo>min(op,cl) or hi<lo:raise RuntimeError("BINANCE_OHLC_INVALID")
   prev=allrows.get(ts)
   if prev is not None and prev!=a:raise RuntimeError("CONFLICTING_HISTORICAL_SOURCES")
   allrows[ts]=a;count+=1
   if first is None:first=ts
   last=ts
 manifest.append({"month":month,"archive_url":url,"archive_file":str(archive.relative_to(root)),"archive_sha256":hashlib.sha256(raw).hexdigest(),
                  "archive_integrity":integrity,"rows":count,"firstUTC":datetime.datetime.fromtimestamp(first/1000,datetime.timezone.utc).isoformat(),
                  "lastUTC":datetime.datetime.fromtimestamp(last/1000,datetime.timezone.utc).isoformat()})
 got+=count
 print("DOWNLOADED",month,"rows",count,"integrity",integrity,flush=True)
rows=[allrows[t] for t in sorted(allrows)]
bad=[(a[0],b[0]) for a,b in zip(rows,rows[1:]) if b[0]-a[0]!=M]
if bad:raise RuntimeError("BINANCE_H1_MISSING_OR_GAPPED:"+repr(bad[:10]))
path=root/"FETUSDT_BINANCE_UM_1H_202503_202601.jsonl.gz"
with gzip.open(path,"wt",encoding="utf8") as out:
 for x in rows:out.write(json.dumps(x,separators=(",",":"))+"\n")
result={"schema":"P107_FET_BINANCE_OFFICIAL_USDM_UM_FUTURES_MONTHLY_H1_DOWNLOAD_V1",
        "venue":"Binance","product":"USDⓈ-M perpetual FETUSDT","intendedUse":"OFFICIAL_CROSS_VENUE_INDICATOR_BACKFILL_COMPARISON_ONLY","notAnAsterSignedFill":True,
        "monthlyInputs":manifest,"uniqueHourBars":len(rows),"firstUTC":datetime.datetime.fromtimestamp(rows[0][0]/1000,datetime.timezone.utc).isoformat(),
        "lastUTC":datetime.datetime.fromtimestamp(rows[-1][0]/1000,datetime.timezone.utc).isoformat(),"hourlyMissingGaps":len(bad),
        "gzipSource":{"filename":path.name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"bytes":path.stat().st_size}}
(root/"P107_FET_OFFICIAL_BINANCE_H1_SOURCE_MANIFEST_20261123.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print("FINISHED_BARS",len(rows),"MISSING",len(bad),"FIRST",result["firstUTC"],"LAST",result["lastUTC"],"ZIP_SHA_VERIFIED",sum(x["archive_integrity"].startswith("OFFICIAL") for x in manifest),"DATA_HASH",result["gzipSource"]["sha256"])
