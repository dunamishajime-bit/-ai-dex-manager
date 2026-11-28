"""Read-only V52 stock underlying 5-minute ASTER and Yahoo hourly coverage audit.

Never converts an archived candle into a certified quote or native source fill.
Gaps/zero-volume bars stay visible. No order, position, network or credential IO.
"""
from __future__ import annotations
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys
UTC=dt.timezone.utc
START=int(dt.datetime(2025,10,1,tzinfo=UTC).timestamp()*1000)
END=int(dt.datetime(2026,10,1,tzinfo=UTC).timestamp()*1000)
FIVE=300_000
SYMBOLS=("AMZN","META","MSFT","NVDA","TSLA")

def sha(p:Path)->str:
 h=hashlib.sha256()
 with p.open("rb") as stream:
  for b in iter(lambda:stream.read(1<<20),b""):
   h.update(b)
 return h.hexdigest()

def ast(symbol:str,path:Path)->dict:
 if not path.is_file() or path.is_symlink():
  raise ValueError("V52_ASTER_M5_DATA_UNAVAILABLE:"+symbol)
 rows=0; invalid=0; gaps=0; dup=0; zero=0
 first=last=None; previous=None
 counts={}
 with gzip.open(path,"rt",encoding="utf8") as data:
  for line in data:
   a=json.loads(line)
   if not isinstance(a,list) or len(a)<8:raise ValueError("V52_ASTER_H1_M5_SHAPE_INVALID:"+symbol)
   timestamp=int(a[0])
   o,h,l,c,v=[float(a[i]) for i in (1,2,3,4,5)]
   if first is None:first=timestamp
   if previous is not None:
    if timestamp<=previous:dup+=1
    if timestamp>previous+FIVE:gaps+=(timestamp-previous)//FIVE-1
   previous=last=timestamp
   rows+=1
   if v==0:zero+=1
   if (timestamp%FIVE or timestamp<START or timestamp>=END or int(a[6])!=timestamp+FIVE-1
       or not all(math.isfinite(x) for x in (o,h,l,c,v)) or min(o,l,c)<=0
       or h<max(o,c) or l>min(o,c) or v<0):
    invalid+=1
 return {"file":path.name,"sha256":sha(path),"rows":rows,
  "firstUtc":dt.datetime.fromtimestamp(first/1000,UTC).isoformat() if first else None,
  "lastUtc":dt.datetime.fromtimestamp(last/1000,UTC).isoformat() if last else None,
  "missingBarSlots":gaps,"duplicateOrReversed":dup,"invalidOHLC":invalid,
  "zeroVolumeBars":zero,"zeroVolumeRatio":round(zero/max(1,rows),6),
  "completeClockCoverage":first==START and last==END-FIVE and rows==(END-START)//FIVE and gaps==0 and dup==0 and invalid==0}

def yahoo(symbol:str,path:Path)->dict:
 if not path.is_file() or path.is_symlink():
  raise ValueError("V52_YAHOO_H1_REFERENCE_UNAVAILABLE:"+symbol)
 rows=json.loads(path.read_text(encoding="utf8"))
 if not isinstance(rows,list) or not rows:raise ValueError("V52_YAHOO_HISTORY_EMPTY")
 bad=0; out=0; duplicate=0; last=None
 for b in rows:
  t=b["tsSeconds"]
  if last is not None and t<=last:duplicate+=1
  last=t
  if not START<=t*1000<END:out+=1
  o,h,l,c,v=[float(b[k]) for k in ("open","high","low","close","volume")]
  if not all(math.isfinite(x) for x in (o,h,l,c,v)) or min(o,l,c)<=0 or h<max(o,c) or l>min(o,c) or v<0:
   bad+=1
 return {"file":path.name,"sha256":sha(path),"rows":len(rows),
  "badOHLC":bad,"outsideWindow":out,"nonascendingTime":duplicate,
  "firstUtc":dt.datetime.fromtimestamp(rows[0]["tsSeconds"],UTC).isoformat(),
  "lastUtc":dt.datetime.fromtimestamp(rows[-1]["tsSeconds"],UTC).isoformat()}

def main()->None:
 if len(sys.argv)!=3:raise ValueError("RESEARCH_DATA_ROOT_AND_NEW_OUTPUT_REQUIRED")
 root=Path(sys.argv[1]).resolve()
 out=Path(sys.argv[2]).resolve()
 if not root.is_dir() or not out.parent.is_dir():raise ValueError("RESEARCH_PATH_INVALID")
 detailed={}
 for sym in SYMBOLS:
  m5=root/"V11_ASTER_5M_FULLPERIOD_20261111"/f"{sym}USDT-5m-20251001-20261001.jsonl.gz"
  ref=root/"yahoo-public-stock-h1"/f"{sym}-Yahoo-H1-20251001-20261001.json"
  detailed[sym]={"asterM5":ast(sym,m5),"yahooH1":yahoo(sym,ref)}
 status="COVERAGE_REVIEW_ONLY"
 if any(not x["asterM5"]["completeClockCoverage"] or x["yahooH1"]["badOHLC"]
        or x["yahooH1"]["nonascendingTime"] for x in detailed.values()):
  status="BLOCKED_MARKET_DATA_GAPS_OR_INVALID"
 payload={
  "schema":"stable4-v52-stock-m5-h1-coverage-audit/v1",
  "status":status,
  "source":"archived ASTER public market 5m and Yahoo public stock reference H1; no signed quote provenance",
  "windowUtc":["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"],
  "perTicker":detailed,
  "limitations":[
   "Data coverage inspection only; V52 native source strategy, stock session and venue quote validity not yet replayed",
   "M5 zero-volume bars are NOT evidence of executable prices; off-session/holidays must be independently masked",
   "Yahoo hourly public reference cannot attest signed stock venue quote/fill",
   "No paired depth, ASTER executable fills, basis/spread/slippage, order cancels, positions, fees, funding or resident STOP",
  ],
  "allSevenNativeReplay":False,"sourceFillParityProven":False,
  "portfolioGrossDdProven":False,"orderAuthority":False,
  "rootCertificateIssued":False,"productionEligible":False}
 with out.open("x",encoding="utf8") as f:json.dump(payload,f,indent=2)
 print(json.dumps({"status":status,"summary":{
  s:{"asterM5":{k:v for k,v in x["asterM5"].items() if k in ("rows","zeroVolumeBars","missingBarSlots","duplicateOrReversed","invalidOHLC","completeClockCoverage")},
     "yahooH1":{k:v for k,v in x["yahooH1"].items() if k in ("rows","badOHLC","outsideWindow","nonascendingTime")}}
  for s,x in detailed.items()},"orderAuthority":False}))

if __name__=="__main__":
 main()
