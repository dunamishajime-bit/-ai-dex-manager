#!/usr/bin/env python3
"""Y06 exposure-overlap episode audit; descriptive, read-only, no rule optimization."""
from pathlib import Path
import numpy as np
import json, gzip, hashlib, datetime as dt, collections, os
R=Path(os.environ.get("DISDEX_BT_ROOT",r"C:\tmp\disdex-bt-20251001-20261001"))
d=R/"DIRECTION_RESEARCH_20261109"
source=R/"V4_Y06_HISTORICAL_DUALSIDE_20261109"/"y06-dualside-modeled.jsonl"
ev=sorted((r for r in (json.loads(z) for z in source.open(encoding="utf8") if z.strip()) if r["mode"]=="NATIVE"),
          key=lambda r:(r["entryTs"],r["candidateIndex"]))
assert len(ev)==352
H=3600000
price={}
for sym in {x["symbol"] for x in ev}:
 with gzip.open(R/"aster-public-v3-h1"/(sym+"-1h-20250924-20261001.jsonl.gz"),"rt",encoding="utf8") as f:
  price[sym]={int(x[0]):float(x[1]) for x in (json.loads(z) for z in f if z.strip())}
feat={}
for z in (json.loads(z) for z in (d/"direction_features_long_confirmation.jsonl").open(encoding="utf8") if z.strip()):
 if z.get("strategy")=="V4" and z.get("native_route")=="REC_Y06_REV_D0_T72":
  feat.setdefault((z["entryTs"],z["symbol"]),[]).append(z)
matched=[]
for x in ev:
 key=(x["entryTs"],x["symbol"])
 found=feat.get(key,[])
 matched.append(found.pop(0) if found else None)
assert sum(x is not None for x in matched)==352, sum(x is not None for x in matched)
def month(t):return dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).strftime("%Y-%m")
def iso(t):return dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).isoformat()
deltas=[]
for x in ev:
 t=x["entryTs"]+60*H
 if t<x["exitTs"]:
  pp=price[x["symbol"]].get(t)
  assert pp is not None
  deltas.append((x["entryPrice"]-pp)/x["entryPrice"]-x["rawReturn"])
 else:deltas.append(0.)
clusters=[]
for i,x in enumerate(ev):
 if not clusters or x["entryTs"]>=clusters[-1]["end"]:
  clusters.append({"start":x["entryTs"],"end":x["exitTs"],"members":[i]})
 else:
  clusters[-1]["end"]=max(clusters[-1]["end"],x["exitTs"])
  clusters[-1]["members"].append(i)
# Ignore artificial train/test independent trial count: overlapping cohort is unit of evidence.
for c in clusters:
 idx=c["members"];c.update({"n":len(idx),
 "start_utc":iso(c["start"]),"end_utc":iso(c["end"]),
 "native_return_sum":sum(ev[i]["rawReturn"] for i in idx),
 "h60_delta_sum":sum(deltas[i] for i in idx),
 "negative_native":sum(ev[i]["rawReturn"]<0 for i in idx),
 "y06_symbols":sorted({ev[i]["symbol"] for i in idx})})
# Whole-episode block bootstrap only describes sampling uncertainty under IID episodes (unproven).
rng=np.random.default_rng(20261110)
values=np.array([c["h60_delta_sum"] for c in clusters],dtype=float)
sampling=values[rng.integers(0,len(values),(10000,len(values)))].sum(axis=1)
bootstrap={"episode_count":len(clusters),"total_route_60h_delta_sum":float(sum(values)),
 "episode_positive":int((values>0).sum()),"episode_negative":int((values<0).sum()),
 "episode_zero":int((values==0).sum()),
 "resampled_total_ci95_raw_return_sum":[float(z) for z in np.quantile(sampling,[.025,.975])],
 "bootstrap_positive_fraction":float((sampling>0).mean()),
 "assumption":"Illustrative IID-episode bootstrap; time/regime nonstationarity means this is NOT a validated confidence interval for future performance."}
monthly={}
for m in sorted({month(x["entryTs"]) for x in ev}):
 ids=[i for i,x in enumerate(ev) if month(x["entryTs"])==m]
 monthly[m]={"n":len(ids),"native_win":sum(ev[i]["rawReturn"]>0 for i in ids),
 "native_return_sum":sum(ev[i]["rawReturn"] for i in ids),
 "native_60h_delta_sum":sum(deltas[i] for i in ids),
 "pct_wrong_direction":sum(ev[i]["rawReturn"]<0 for i in ids)/len(ids),
 "btc24_mean":sum(matched[i]["btc_ret24"] for i in ids)/len(ids),
 "sym12_mean":sum(matched[i]["sym_ret12"] for i in ids)/len(ids),
 "btc_regime_count":dict(collections.Counter(ev[i]["btcRegime"] for i in ids)),
 "native_exit_reason":dict(collections.Counter(ev[i]["exitReason"] for i in ids))}
# Predefined structural regime buckets: descriptive, no conditional gate accepted.
def b24(f):
 v=f["btc_ret24"]
 return ("BTC24_BELOW_MINUS1PCT" if v<-.01 else "BTC24_ABOVE_PLUS1PCT" if v>.01 else "BTC24_NEAR_FLAT")
def s12(f):
 v=f["sym_ret12"]
 return ("SYM12_BELOW_MINUS1PCT" if v<-.01 else "SYM12_ABOVE_PLUS1PCT" if v>.01 else "SYM12_NEAR_FLAT")
regimes={}
for kind,get in [("btc24",b24),("sym12",s12)]:
 regimes[kind]={}
 for key in sorted({get(f) for f in matched}):
  ids=[i for i,f in enumerate(matched) if get(f)==key]
  regimes[kind][key]={"n":len(ids),"native_wins":sum(ev[i]["rawReturn"]>0 for i in ids),
   "native_net_raw_sum":sum(ev[i]["rawReturn"] for i in ids),
   "native_60h_delta_sum":sum(deltas[i] for i in ids)}
# Count split-overlap episodes, without double counting overlapping fills.
splits={"train":set(range(211)),"validation":set(range(211,281)),"test":set(range(281,352))}
split_episode_counts={k:sum(any(i in ids for i in c["members"]) for c in clusters) for k,ids in splits.items()}
cross_split=[{"start":c["start_utc"],"end":c["end_utc"],"count":c["n"]}
 for c in clusters if sum(any(i in ids for i in c["members"]) for ids in splits.values())>1]
report={"study":"Y06 non-IID exposure episodes, descriptive regime shifts","source_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
 "feature_source_sha256":hashlib.sha256((d/"direction_features_long_confirmation.jsonl").read_bytes()).hexdigest(),
 "events":len(ev),"matched_feature_rows":len(matched),"episode_bootstrap":bootstrap,
 "split_episode_counts_nonexclusive":split_episode_counts,"split_crossing_episodes":cross_split,
 "monthly":monthly,"regime_bins":regimes,
 "episodes":clusters,
 "warnings":["Cannot treat each trade as an independent trial","Bootstrap cannot validate a preselected H60 hypothesis on already inspected data",
 "Gross, funding, fee and portfolio path effects excluded: refer to integrated A/B","Actual native STOP/profit guard model exits were preserved"]}
out=d/"v4_y06_episodes_non_iid_regime_audit_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("OUTPUT",out,"SHA256",hashlib.sha256(out.read_bytes()).hexdigest())
print("BOOTSTRAP",json.dumps(bootstrap))
print("SPLIT_EPISODES",split_episode_counts,"CROSS",cross_split)
print("REGIMES",json.dumps(regimes))
print("MONTHS",json.dumps(monthly))
