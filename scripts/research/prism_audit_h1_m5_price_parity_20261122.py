#!/usr/bin/env python3
"""PRISM II independent Aster H1-to-M5 candle-aggregation data-quality audit.

No private credentials, no exchange trading; compare source provider OHLCV
on precisely identical UTC hour intervals before treating M5 STOP as native.
"""
from __future__ import annotations
import csv,gzip,hashlib,json,math,statistics,sys
from collections import defaultdict,Counter
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
FORWARD=WORK/"forward_public_20261001_20261118"
OUT=WORK/"phase2_results"
OUT.mkdir(parents=True,exist_ok=True)
START=1759276800000;CUT=1790812800000;END=1794960000000
SYMBOLS=("BTCUSDT","PENGUUSDT")
# Check actual END rather than guessing date from timestamp.
import datetime as dt
END=int(dt.datetime(2026,11,18,tzinfo=dt.timezone.utc).timestamp()*1000)
def hashfile(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(2**17),b""):h.update(b)
 return h.hexdigest()
def get(sym):
 paths_h=[*list((ROOT/"aster-public-v3-h1").glob(f"{sym}-1h-*.jsonl.gz")),
  FORWARD/f"{sym}-1h-20261001-20261118.jsonl.gz"]
 paths_m=[*list((ROOT/"aster-public-v3-5m-prefix").glob(f"{sym}-5m-*.jsonl.gz")),
  *list((ROOT/"aster-public-v3-5m-suffix").glob(f"{sym}-5m-*.jsonl.gz")),
  FORWARD/f"{sym}-5m-20261001-20261118.jsonl.gz"]
 values={}
 for path,container,indices in ((p,values,(1,2,3,4,5)) for p in paths_h):pass
 def files(paths):
  r={}
  for p in paths:
   if not p.is_file():raise ValueError("SOURCE_FILE_MISSING:"+str(p))
   with gzip.open(p,"rt",encoding="utf8") as f:
    for line in f:
     x=json.loads(line);t=int(x[0])
     v=tuple(float(x[i]) for i in (1,2,3,4,5))
     if t in r and r[t]!=v:raise ValueError("DUPLICATE_WITH_CONFLICT:"+str(t))
     r[t]=v
  return r
 return files(paths_h),files(paths_m),{str(p):hashfile(p) for p in paths_h+paths_m}
def summary(values):
 if not values:return {"n":0}
 y=sorted(values)
 def quant(p):
  return round(y[min(len(y)-1,max(0,int((len(y)-1)*p)))],6)
 return {"n":len(y),"median":quant(.5),"p95":quant(.95),"p99":quant(.99),
 "max":round(y[-1],6),"n_gt_5bps":sum(x>.05 for x in y),
 "n_gt_50bps":sum(x>.5 for x in y)}
body={"schema":"disdex-prism-h1-m5-source-consistency/v1","period":"2025-10-01 through 2026-11-18 UTC",
 "source":"unsigned Aster V3 klines only","symbols":{},
 "comparisons":[],"limitations":["M5 and H1 may differ due to provider corrections or live bar construction; not signed venue proof",
 "An H1-vs-M5 disagreement invalidates claims that M5 intrabar STOP values are a faithful replay of H1 strategy source",
 "Do not infer exact order fill price from either public candle series"]}
for sym in SYMBOLS:
 h,m,sha=get(sym)
 rows=[]
 for ts,hbar in sorted(h.items()):
  if ts<START or ts>=END:continue
  mbar=[m.get(ts+i*300000) for i in range(12)]
  if any(x is None for x in mbar):continue
  oh=hbar
  agg=(mbar[0][0],max(x[1] for x in mbar),min(x[2] for x in mbar),mbar[-1][3],sum(x[4] for x in mbar))
  delta={name:100*abs(x-y)/max(1e-15,abs(x)) for name,x,y in zip(("open","high","low","close","volume"),oh,agg)}
  rows.append({"utc":dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat(),
    "epoch_ms":ts,"period":"baseline" if ts<CUT else "forward",**delta})
 for period in ("baseline","forward"):
  z=[x for x in rows if x["period"]==period]
  hist={k:summary([x[k] for x in z]) for k in ("open","high","low","close","volume")}
  body["comparisons"].append({"symbol":sym,"period":period,"checked_hours":len(z),"delta_pct":hist})
 body["symbols"][sym]={"h1_bars":len(h),"m5_bars":len(m),"source_sha256":sha,
     "checked_hours":len(rows),
     "first_disagreements":sorted(rows,key=lambda x:-max(x["open"],x["close"]))[:20]}
 print("H1_M5_CHECK",sym,"n",len(rows),
       "baseline_open5bps",next(z["delta_pct"]["open"]["n_gt_5bps"] for z in body["comparisons"] if z["symbol"]==sym and z["period"]=="baseline"),
       "forward_open5bps",next(z["delta_pct"]["open"]["n_gt_5bps"] for z in body["comparisons"] if z["symbol"]==sym and z["period"]=="forward"),flush=True)
(OUT/"PRISM_H1_M5_SOURCE_COHERENCE_AUDIT.json").write_text(
 json.dumps(body,indent=2,sort_keys=True,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf8")
print("H1_M5_AUDIT_DONE",flush=True)
