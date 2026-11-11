#!/usr/bin/env python3
from pathlib import Path
import json,gzip,datetime as dt,hashlib,collections

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
BTC=R/"PREPERIOD_TRAIN_20250301_20251001"/"IDLE_ALL_BINANCE_PROXY"/"BTCUSDT-1h-20250301-20251001.jsonl.gz"
OUT=R/"DIRECTION_RESEARCH_20261109"/"global_btc24_72_direction_consistency_pretarget_20261111.json"
COST=.003; H=3600000
START=int(dt.datetime(2025,3,22,tzinfo=dt.timezone.utc).timestamp()*1000)
T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2025,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)

with gzip.open(BTC,"rt",encoding="utf-8") as f:
    bars=[json.loads(x) for x in f if x.strip()]
close={int(z[0]):float(z[4]) for z in bars}

def btc_ret(entry_ts,hours):
    now=entry_ts-H
    old=now-hours*H
    if now not in close or old not in close:return None
    return close[now]/close[old]-1

sources=[
 ("HYPE",R/"PREPERIOD_TRAIN_20250501_20251001"/"HYPE_BINANCE_PROXY"/"hype-preperiod-proxy-candidates-with-m5-exits.jsonl",None),
 ("IDLE",R/"PREPERIOD_TRAIN_20250301_20251001"/"IDLE_ALL_BINANCE_PROXY"/"idle-all-preperiod-proxy-candidates-with-m5-exits.jsonl",None),
 ("Q102_S34",R/"PREPERIOD_TRAIN_20250322_20251001"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl",None),
 ("Q102_HIGH_VOL",R/"PREPERIOD_TRAIN_20240101_20251001"/"Q102_HIGHVOL_BINANCE_PROXY"/"q102-highvol-pretarget-proxy-exits.jsonl",None),
 ("V4",R/"PREPERIOD_TRAIN_20250322_20251001"/"V4_DUALSIDE_LIFECYCLE"/"v4-pre-dualside-modeled-exits.jsonl","NATIVE"),
 ("PENGU_V20",R/"PREPERIOD_TRAIN_20250101_20251001"/"PENGU_V20_BINANCE_PROXY"/"pengu-v20-preperiod-proxy-candidates-with-native-exits.jsonl",None),
]
rows=[];hashes={}
for strategy,p,mode in sources:
    hashes[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip():continue
        z=json.loads(line)
        if mode and z.get("mode")!=mode:continue
        t=int(z["entryTs"])
        if not (START<=t<END):continue
        side=z.get("side")
        if isinstance(side,str): side=1 if side.upper()=="LONG" else -1
        else: side=int(side)
        raw=z.get("rawReturn",z.get("grossReturn"))
        if raw is None:continue
        r24=btc_ret(t,24);r72=btc_ret(t,72)
        if r24 is None or r72 is None:continue
        block=(side*r24<0 and side*r72<0)
        rows.append({"strategy":strategy,"entryTs":t,"side":side,"rawReturn":float(raw),
                     "btc24":r24,"btc72":r72,"block":block,"symbol":z.get("symbol"),"route":z.get("route")})

def metric(a):
    v=[z["rawReturn"]-COST for z in a]
    gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
    return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
            "mean":sum(v)/len(v) if v else None,"sum":sum(v),
            "pf":gp/gl if gl else (999.0 if gp>0 else None)}

def parts(a):
    return {"train":[z for z in a if z["entryTs"]<T1],
            "validation":[z for z in a if T1<=z["entryTs"]<T2],
            "prehold":[z for z in a if z["entryTs"]>=T2]}
def eval_group(a):
    out={}
    for k,v in parts(a).items():
        kept=[z for z in v if not z["block"]]
        blocked=[z for z in v if z["block"]]
        out[k]={"baseline":metric(v),"kept":metric(kept),"blocked":metric(blocked)}
    return out

by_strategy={}
for s in sorted({z["strategy"] for z in rows}):
    by_strategy[s]=eval_group([z for z in rows if z["strategy"]==s])
overall=eval_group(rows)

# Anti-overfit acceptance is fixed before any target-year portfolio replay.
# Require aggregate validation and prehold mean+PF not worse, with >=70% retention,
# and at least 4 strategies with >=5 observations in each split showing non-worse mean.
checks={}
support={}
for split in ("validation","prehold"):
    o=overall[split]
    checks[split]=bool(
        o["kept"]["n"]>=0.70*o["baseline"]["n"] and
        o["kept"]["mean"] is not None and o["baseline"]["mean"] is not None and o["kept"]["mean"]>=o["baseline"]["mean"] and
        (o["kept"]["pf"] or 0)>=(o["baseline"]["pf"] or 0)
    )
    good=0;eligible=0
    for s,e in by_strategy.items():
        b=e[split]["baseline"];k=e[split]["kept"]
        if b["n"]>=5 and k["n"]>=3:
            eligible+=1
            if k["mean"] is not None and b["mean"] is not None and k["mean"]>=b["mean"]:good+=1
    support[split]={"good":good,"eligible":eligible}
qualifies=checks["validation"] and checks["prehold"] and support["validation"]["good"]>=4 and support["prehold"]["good"]>=4

out={"status":"GLOBAL_BTC24_72_DIRECTION_CONSISTENCY_PRETARGET_ONLY",
     "rule":"Block LONG if BTC24<0 and BTC72<0; block SHORT if BTC24>0 and BTC72>0. Completed H1 only.",
     "costBps":30,
     "splits":{"train":"2025-03-22..2025-06-30","validation":"2025-07..2025-08","prehold":"2025-09"},
     "overall":overall,"byStrategy":by_strategy,"acceptanceChecks":checks,"strategySupport":support,
     "qualifiesPretargetForOneShotIntegratedTest":qualifies,
     "hashes":{"btc":hashlib.sha256(BTC.read_bytes()).hexdigest(),**hashes},
     "antiOverfit":["Rule fixed before target replay","No threshold search","No symbol/route-specific tuning","Target 2025-10..2026-10 not read"]}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("QUALIFIES",qualifies,"CHECKS",checks,"SUPPORT",support)
for s,e in by_strategy.items():
 print("\n",s)
 for split in ("train","validation","prehold"):
  print(split,"B",e[split]["baseline"],"K",e[split]["kept"],"BLOCK",e[split]["blocked"])
print("\nOVERALL",json.dumps(overall,separators=(",",":")))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
