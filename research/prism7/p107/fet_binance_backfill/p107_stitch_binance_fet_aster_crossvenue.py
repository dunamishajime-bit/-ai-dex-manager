from pathlib import Path
import json,gzip,hashlib,statistics,datetime
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
SRC=ROOT/"binance_fet_1h_fill_20261123"
DATA=Path(r"C:\tmp\disdex-bt-20251001-20261001")
A=DATA/"aster-public-v3-h1/FETUSDT-1h-20250924-20261001.jsonl.gz"
B=SRC/"FETUSDT_BINANCE_UM_1H_202503_202601.jsonl.gz"
assert A.is_file() and B.is_file()
def fetch(p):
 out={}
 with gzip.open(p,"rt",encoding="utf8") as f:
  for line in f:
   if not line.strip():continue
   z=json.loads(line)
   t=int(z[0]);assert t%3600000==0
   if t in out:raise RuntimeError("DUPLICATE_HOUR:"+str(t))
   out[t]=z
 return out
bn=fetch(B);aster=fetch(A)
started=min(aster)
assert started==1767981600000,started
before={t:v for t,v in bn.items() if t<started}
overlap=sorted(set(bn).intersection(aster))
assert len(overlap)>300 and overlap[0]==started
priceDist=[];returnDist=[];badA=0;badB=0;priceMax=None
for t in overlap:
 x=bn[t];y=aster[t]
 bp=float(x[4]);ap=float(y[4])
 pct=100*(ap/bp-1)
 priceDist.append(abs(pct))
 if priceMax is None or abs(pct)>priceMax["absoluteCloseDiffPct"]:priceMax={"utc":datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat(),"absoluteCloseDiffPct":abs(pct),"signedCloseDiffPct":pct,"asterClose":ap,"binanceClose":bp}
 def bad(z):
  o,h,l,c=map(float,z[1:5])
  return o<=0 or c<=0 or l<=0 or h<max(o,c) or l>min(o,c) or h<l
 badB+=bad(x);badA+=bad(y)
combined={**before,**aster}
times=sorted(combined)
gaps=[(t,u) for t,u in zip(times,times[1:]) if u-t!=3600000]
assert not gaps,repr(gaps[:4])
now=lambda t:datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat()
p=SRC/"FETUSDT_BINANCE_WARMUP_ASTERV3_ENTRY_1H_MIXED_PROVENANCE_20261123.jsonl.gz"
with gzip.open(p,"wt",encoding="utf8") as w:
 for t in times:w.write(json.dumps(combined[t],separators=(",",":"))+"\n")
ordered=sorted(priceDist)
def q(percent):
 ix=min(len(ordered)-1,int((len(ordered)-1)*percent))
 return ordered[ix]
cut=started
model=SRC/"P107_FET_BINANCE_ASTERV3_CROSSVENUE_OVERLAP_AND_HYBRID_MANIFEST_20261123.json"
manifest={
 "schema":"p107-fet-binance-official-h1-only-before-first-ASTER-FET-hour-research/v1",
 "instrument":"FETUSDT","futuresReferenceVenue":"Binance USDⓈ-M","executionVenue":"ASTER",
 "fromSource":"Official monthly Binance futures raw H1 archive verified 11/11 SHA256",
 "toSource":"Original ASTER public V3 1H dataset",
 "notAsterNativeHistoricalParity":True,
 "notAsterExecutionBeforeFirstAsterFETCandle":True,
 "cutoverUtc":now(cut),
 "binanceUsedForHoursBeforeCutover":len(before),
 "asterUsedAtOrAfterCutover":len(aster),
 "sourceOverlapCount":len(overlap),
 "firstOverlapUtc":now(overlap[0]),"lastOverlapUtc":now(overlap[-1]),
 "absClosePriceCrossVenueDifferencePct":{
  "median":statistics.median(ordered),"p95":q(.95),"p99":q(.99),"max":max(ordered)},
 "maxAbsPriceDifference":priceMax,
 "invalidOHLCInOverlap":{"binance":badB,"aster":badA},
 "combinedTotalHours":len(times),"combinedHourGaps":len(gaps),
 "combinedStartUtc":now(times[0]),"combinedEndUtc":now(times[-1]),
 "sourceSHA256":{"binanceSourceGzip":hashlib.sha256(B.read_bytes()).hexdigest(),
               "asterSourceGzip":hashlib.sha256(A.read_bytes()).hexdigest()},
 "mixedDataset":{"filename":p.name,"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"bytes":p.stat().st_size},
 "marketDataFillingPolicy":"Before ASTER first FET candle, Binance source may support indicators but may NOT serve as a historical ASTER executable fill. At and after first ASTER candle use ASTER OHLC. Source must be marked MIXED_CROSS_VENUE; never silently label ASTER native.",
 "accountBTComplete":False,"productionChanges":0}
model.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print("COMPLETE",json.dumps({k:v for k,v in manifest.items() if k in ["cutoverUtc","binanceUsedForHoursBeforeCutover","asterUsedAtOrAfterCutover","sourceOverlapCount","combinedTotalHours","combinedHourGaps","absClosePriceCrossVenueDifferencePct","maxAbsPriceDifference","invalidOHLCInOverlap"]},ensure_ascii=False))
