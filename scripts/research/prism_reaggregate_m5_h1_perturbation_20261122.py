#!/usr/bin/env python3
"""Research-only M5-reaggregated PENGU H1 source perturbation.

Historical source H1 remains immutable. PENGU open/high/low values are
reconstructed from twelve complete public M5 candles; close and volume
must match the original H1 source. Warmup without M5 is kept H1-native.
A large change in native signal candidates establishes DATA SENSITIVITY,
not permission to change Production feeds or orders.
"""
from __future__ import annotations
import datetime as dt,gzip,hashlib,json,sys
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
FWD=WORK/"forward_public_20261001_20261118"
OUT=WORK/"phase2_results"
OUT.mkdir(parents=True,exist_ok=True)
CUTOFF=int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
def load(paths):
 r={}
 for p in paths:
  if not p.exists():raise ValueError("FILE_MISSING:"+str(p))
  with gzip.open(p,"rt",encoding="utf8") as f:
   for l in f:
    x=json.loads(l);ts=int(x[0])
    v=tuple(float(x[i]) for i in (1,2,3,4,5))
    if ts in r and v!=r[ts]:raise ValueError("DUPLICATE_PRICE_DISAGREEMENT:"+str(ts))
    r[ts]=v
 return r
p_h=next((ROOT/"aster-public-v3-h1").glob("PENGUUSDT-1h-*.jsonl.gz"))
q_h=FWD/"PENGUUSDT-1h-20261001-20261118.jsonl.gz"
m5=[
 *sorted((ROOT/"aster-public-v3-5m-prefix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 *sorted((ROOT/"aster-public-v3-5m-suffix").glob("PENGUUSDT-5m-*.jsonl.gz")),
 FWD/"PENGUUSDT-5m-20261001-20261118.jsonl.gz"
]
h=load([p_h,q_h]);m=load(m5)
rows=[];unchanged=0;rebuilt=0;price_delta=[];failed=[]
for t,h1 in sorted(h.items()):
 if t<dt.datetime(2025,10,1,tzinfo=dt.timezone.utc).timestamp()*1000:
  rows.append([t,*h1]);unchanged+=1;continue
 series=[m.get(t+5*60000*i) for i in range(12)]
 if any(v is None for v in series):
  failed.append(t);continue
 o=series[0][0];hi=max(v[1] for v in series);lo=min(v[2] for v in series);cl=series[-1][3];vol=sum(v[4] for v in series)
 if abs(h1[3]-cl)>1e-12 or abs(h1[4]-vol)>max(1e-6,abs(h1[4])*1e-7):
  raise ValueError("H1_M5_CLOSE_VOLUME_PARITY_FAILED:"+str(t))
 if not lo<=min(o,cl) or not hi>=max(o,cl):raise ValueError("AGGREGATED_BAR_IMPOSSIBLE")
 price_delta.append(100*abs(h1[0]-o)/h1[0])
 rows.append([t,o,hi,lo,h1[3],h1[4]])
 rebuilt+=1
if failed:raise RuntimeError("REAGGREGATED_PERIOD_GAPS:"+str(failed[:8]))
assert rebuilt==9912 and unchanged==168,(rebuilt,unchanged)
o=OUT/"PENGU_H1_PUBLIC_M5_REAGGREGATED_READONLY.jsonl"
payload="\n".join(json.dumps(a,separators=(",",":")) for a in rows)+"\n"
o.write_text(payload,encoding="utf8")
sha=hashlib.sha256(payload.encode()).hexdigest()
manifest={"schema":"disdex-pengu-m5-aggregated-h1-source-perturbation/v1","retained_original_H1_warmup":unchanged,
  "rebuilt_complete_M5_H1_hours":rebuilt,"h1_open_delta_gt_5bps":sum(x>.05 for x in price_delta),
  "h1_close_and_volume_exactly_coherent":True,"m5_aggregated_sha256":sha,
  "source_original_h1_sha256":[hashlib.sha256(p.read_bytes()).hexdigest() for p in (p_h,q_h)],
  "source_m5_sha256":[hashlib.sha256(p.read_bytes()).hexdigest() for p in m5],
  "output_file":o.name,"no_live":True,
  "limitations":["This intentionally changes the native H1 signal data. A different signal population is an economic-model sensitivity, not the original pinned Runner.",
  "No actual venue fills, shared risk, Gross, or STOP executions are represented.",
  "Do not mix reaggregated M5 bar entry candidates with the original portfolio modeled fills."] }
(OUT/"PENGU_H1_M5_REAGGREGATE_MANIFEST.json").write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
print("REAGGREGATED_PENGU_H1",json.dumps({"rows":len(rows),"rebuilt":rebuilt,"changed_open_gt5bps":manifest["h1_open_delta_gt_5bps"],"sha256":sha}),flush=True)
