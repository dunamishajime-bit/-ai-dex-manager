#!/usr/bin/env python3
"""Causal market-state tape from only completed H1 bars.
Thresholds are distributional quantiles fixed ONLY on 2025-03-01..2025-09-30 price history.
No trade outcomes are used to choose thresholds. Evaluation periods are target and forward.
Research-only; does not place orders or mutate Production.
"""
from pathlib import Path
import gzip,json,math,statistics,hashlib,datetime as dt
import numpy as np
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=R/"DIRECTION_RESEARCH_20261109"/"MARKET_STATE_CAUSAL_20261110"
OUT.mkdir(exist_ok=True)
SYMS=["BTC","ETH","BNB","SOL","LINK","AVAX","DOGE","INJ","XRP","ADA","LTC","ATOM","AAVE","NEAR"]
H=3600000
P0=int(dt.datetime(2025,3,1,tzinfo=dt.timezone.utc).timestamp()*1000)
TRAIN_END=int(dt.datetime(2025,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
TARGET_END=int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
FWD_END=int(dt.datetime(2026,11,8,20,tzinfo=dt.timezone.utc).timestamp()*1000)
def read_files(sym):
    rows=[]
    specs=[
      R/"aster-public-v3-h1-early"/f"{sym}USDT-1h-20250301-20250924.jsonl.gz",
      R/"aster-public-v3-h1"/f"{sym}USDT-1h-20250924-20261001.jsonl.gz",
    ]
    fwd=R/"FORWARD_HOLDOUT_20261001_20261108"/"aster-h1"
    if fwd.exists():
      cand=sorted(fwd.glob(f"{sym}USDT*"))
      specs+=cand
    seen={}
    hashes={}
    for p in specs:
      if not p.exists(): continue
      raw=p.read_bytes();hashes[str(p.relative_to(R))]=hashlib.sha256(raw).hexdigest()
      if p.suffix==".gz":
        text=gzip.decompress(raw).decode("utf8")
      else:text=raw.decode("utf8")
      for line in text.splitlines():
        if not line.strip():continue
        z=json.loads(line);t=int(z[0])
        if not P0<=t<FWD_END:continue
        seen[t]=(float(z[1]),float(z[2]),float(z[3]),float(z[4]),float(z[5]))
    ts=sorted(seen)
    # Strict continuity within available range; forward may have a break at target boundary only if file missing.
    for a,b in zip(ts,ts[1:]):
      if b-a!=H: raise RuntimeError(f"H1_GAP:{sym}:{a}:{b}")
    return seen,hashes
bars={};hashes={}
for s in SYMS:
    bars[s],hashes[s]=read_files(s)
common=set(bars["BTC"])
for s in SYMS[1:]: common &= set(bars[s])
common=sorted(common)
if not common: raise RuntimeError("NO_COMMON_H1")
def ret(s,t,h):
    a=bars[s].get(t-h*H);b=bars[s].get(t)
    if not a or not b:return None
    return b[3]/a[3]-1
def logvol(s,t,h):
    vals=[]
    for k in range(h,0,-1):
      a=bars[s].get(t-k*H);b=bars[s].get(t-(k-1)*H)
      if not a or not b:return None
      vals.append(math.log(b[3]/a[3]))
    return float(np.std(vals,ddof=0))
def state_at(decision_t):
    # decision_t is candidate/open boundary. Last causal H1 closes at decision_t, so use bar open decision_t-H.
    last=(decision_t//H)*H-H  # most recent H1 whose close is strictly <= decision time
    if last not in bars["BTC"]:return None
    b24=ret("BTC",last,24);b72=ret("BTC",last,72);v24=logvol("BTC",last,24)
    rs=[]
    for s in SYMS:
      x=ret(s,last,24)
      if x is None:return None
      rs.append(x)
    return dict(decisionTs=decision_t,lastClosedH1OpenTs=last,btc24=b24,btc72=b72,
      btcRv24=v24,breadth24=sum(x>0 for x in rs)/len(rs),
      medianRet24=float(np.median(rs)),dispersion24=float(np.std(rs,ddof=0)),
      crossRet24={s:rs[i] for i,s in enumerate(SYMS)})
# Train distribution hourly on preperiod, but sample one per hour; no outcomes.
train=[]
for t in common:
  decision=t+H
  if not (P0+73*H<=decision<TRAIN_END):continue
  x=state_at(decision)
  if x:train.append(x)
if len(train)<4000:raise RuntimeError("TRAIN_TOO_SMALL:"+str(len(train)))
metrics=["btcRv24","breadth24","dispersion24"]
quant={}
for m in metrics:
 vals=[x[m] for x in train]
 quant[m]={str(q):float(np.quantile(vals,q)) for q in [.1,.2,.25,.5,.75,.8,.9]}
# Fixed interpretable regime flags. Quantile thresholds are price-distribution-only.
rv_hi=quant["btcRv24"]["0.75"];rv_vhi=quant["btcRv24"]["0.9"]
breadth_lo=quant["breadth24"]["0.25"];breadth_vlo=quant["breadth24"]["0.1"]
disp_hi=quant["dispersion24"]["0.75"]
def flags(x):
 return {
  "BTC24_NEG":x["btc24"]<0,
  "BTC72_NEG":x["btc72"]<0,
  "BTC24_72_NEG":x["btc24"]<0 and x["btc72"]<0,
  "HIGH_VOL":x["btcRv24"]>=rv_hi,
  "VERY_HIGH_VOL":x["btcRv24"]>=rv_vhi,
  "LOW_BREADTH":x["breadth24"]<=breadth_lo,
  "VERY_LOW_BREADTH":x["breadth24"]<=breadth_vlo,
  "HIGH_DISP":x["dispersion24"]>=disp_hi,
  "STRESS_A":x["btc24"]<0 and x["btc72"]<0 and x["breadth24"]<=breadth_lo,
  "STRESS_B":x["btc24"]<0 and x["btcRv24"]>=rv_hi and x["breadth24"]<=.5,
  "STRESS_C":x["btc72"]<0 and x["btcRv24"]>=rv_hi and x["breadth24"]<=breadth_lo,
  "REVERSAL_RISK":x["btc72"]>0 and x["btc24"]<0 and x["btcRv24"]>=rv_hi,
  "BROAD_SELL":x["breadth24"]<=breadth_vlo,
 }
summary={"status":"PRICE_ONLY_CAUSAL_STATE_THRESHOLDS_FIXED_FROM_PREPERIOD_DISTRIBUTION_NO_OUTCOME_FIT",
 "train":{"start":"2025-03-01","endExclusive":"2025-10-01","hourlyStates":len(train)},
 "symbols":SYMS,"quantiles":quant,
 "fixedThresholds":{"rvHiQ75":rv_hi,"rvVeryHiQ90":rv_vhi,"breadthLowQ25":breadth_lo,
                    "breadthVeryLowQ10":breadth_vlo,"dispHiQ75":disp_hi},
 "definitions":"all entry state uses last completed H1; no current/open H1 or future trade outcome",
 "inputHashes":hashes,
 "caveats":["Flags are exploratory and the target/forward have already been inspected; no flag is fresh OOS.",
            "Threshold quantiles use price history only, but selecting a winning flag after evaluating target is still multiple-testing.",
            "This tape is for falsification and future-rule preregistration, not Production promotion."]}
(OUT/"state_thresholds.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
# Build a state cache only for all candidate/fill timestamps from baseline and forward files.
times=set()
import csv
for cost in [10,30]:
 folder=R/"VPS_DD_V4_SORT_PINNED_STOCK15_20261110"
 p=folder/f"Y06_NATIVE_LIFECYCLE_M5_AB_{cost}BPS_FILLS.csv"
 with p.open(encoding="utf-8-sig",newline="") as f:
  for z in csv.DictReader(f):times.add(int(dt.datetime.fromisoformat(z["entry_utc"].replace("Z","+00:00")).timestamp()*1000))
 d=folder/f"Y06_NATIVE_LIFECYCLE_M5_AB_{cost}BPS_DECISIONS.csv"
 with d.open(encoding="utf-8-sig",newline="") as f:
  for z in csv.DictReader(f):times.add(int(dt.datetime.fromisoformat(z["utc"].replace("Z","+00:00")).timestamp()*1000))
# Add forward strategy event times
for p in [
 R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl",
 R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_NATIVE_LIFECYCLE"/"pengu-native-lifecycle-modeled-exits.jsonl",
 R/"FORWARD_HOLDOUT_20261001_20261108"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl",
 R/"FORWARD_HOLDOUT_20261001_20261108"/"V4_DUALSIDE_LIFECYCLE"/"v4-forward-dualside-modeled-exits.jsonl"]:
 if p.exists():
  for line in p.open(encoding="utf8"):
   z=json.loads(line)
   if z.get("mode") not in (None,"NATIVE","NATIVE_SHORT"): continue
   times.add(int(z["entryTs"]))
rows=[]
missing=0
for t in sorted(times):
 x=state_at(t)
 if not x:missing+=1;continue
 rows.append({**x,"flags":flags(x)})
with (OUT/"candidate_entry_market_states.jsonl").open("w",encoding="utf8") as f:
 for x in rows:f.write(json.dumps(x,separators=(",",":"),ensure_ascii=False)+"\n")
summary["candidateTimes"]=len(times);summary["candidateStates"]=len(rows);summary["missingCandidateStates"]=missing
summary["stateTapeSha256"]=hashlib.sha256((OUT/"candidate_entry_market_states.jsonl").read_bytes()).hexdigest()
(OUT/"state_thresholds.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("MARKET_STATE_SUMMARY="+json.dumps({k:summary[k] for k in ["train","fixedThresholds","candidateTimes","candidateStates","missingCandidateStates","stateTapeSha256"]},separators=(",",":")))
