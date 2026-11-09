#!/usr/bin/env python3
"""DisDex Y06 research-only 11-expert decision-state audit, deterministic.
Only completed H1 candles and previously settled labels may influence decisions.
DO NOT promote to production: no blind OOS; integrated 10/30bps not simulated.
"""
import collections, gzip, hashlib, json, math, os
from pathlib import Path
root=Path(os.environ.get("DISDEX_BT_ROOT",r"C:\tmp\disdex-bt-20251001-20261001"))
d=root/"DIRECTION_RESEARCH_20261109"
source=d/"v4_internal_threeperiod_flat.jsonl"
rows=sorted((json.loads(line) for line in source.open(encoding="utf-8") if line.strip()),
            key=lambda x:(x["decisionTs"],x.get("row_id","")))
rows=[x for x in rows if x.get("route")=="REC_Y06_REV_D0_T72"]
targets=[x for x in rows if x.get("period")=="TARGET"]
assert len(targets)==352 and all(x["side"]=="SHORT" for x in targets)
cache_path=d/"market_breadth_feature_cache_20261110.json"
cache=json.loads(cache_path.read_text(encoding="utf-8"))["features_by_decision_ts"]
prices={}
for sym in sorted(set(x["symbol"] for x in targets)|{"BTCUSDT"}):
    path=root/"aster-public-v3-h1"/f"{sym}-1h-20250924-20261001.jsonl.gz"
    with gzip.open(path,"rt",encoding="utf-8") as f:
        prices[sym]={int(a[0]):tuple(float(z) for z in a[1:6])
                     for a in (json.loads(line) for line in f if line.strip())}
H=3600000
def feat(x):
    t=x["decisionTs"]
    hist=[prices[x["symbol"]][t-(i+1)*H] for i in range(85)]
    btc=[prices["BTCUSDT"][t-(i+1)*H][3] for i in range(85)]
    close=[row[3] for row in hist]
    def ret(h):return close[0]/close[h]-1
    def br(h):return btc[0]/btc[h]-1
    def loc(n):
        hi=max(a[1] for a in hist[:n]);lo=min(a[2] for a in hist[:n])
        return (close[0]-lo)/(hi-lo) if hi>lo else .5
    def wick(n):
        return sum(max(0,a[1]-max(a[0],a[3])) for a in hist[:n])/max(1e-10,sum(a[1]-a[2] for a in hist[:n]))
    def eff(n):
        return abs(math.log(close[0]/close[n]))/max(1e-8,sum(abs(math.log(close[i]/close[i+1])) for i in range(n)))
    def rsi(n=14):
        ds=[close[i]-close[i+1] for i in range(n)]
        up=sum(max(0,z) for z in ds);dn=sum(max(0,-z) for z in ds)
        return 100*up/(up+dn) if up+dn else 50
    b=cache[str(t)]
    r3,r6,r12,r24=[ret(h) for h in (3,6,12,24)]
    out=dict(s3=r3,s6=r6,s12=r12,s24=r24,btc6=br(6),btc24=br(24),
        rel6=r6-br(6),rel12=r12-br(12),prev6=close[6]/close[12]-1,
        eff12=eff(12),eff24=eff(24),loc24=loc(24),rsi14=rsi(),
        wick3=wick(3),wick6=wick(6),b6=b["breadth_pos6"],
        b12=b["breadth_pos12"],bd=b["breadth_pos6"]-b["breadth_pos12"],
        volratio=(sum(z[4] for z in hist[:3])/3)/(sum(z[4] for z in hist[:24])/24),
        breakout6=close[0]>max(z[1] for z in hist[1:7]),
        failedbreak=(max(z[1] for z in hist[:3])>max(z[1] for z in hist[3:24]) and close[0]<max(z[1] for z in hist[3:24])))
    assert abs(out["s6"]-x["if_sret6"])<1e-9
    assert abs(out["btc6"]-x["if_btc6"])<1e-9
    return out

def vote(z):
    # Deliberately fixed before evaluating these groups; not selected by outcomes.
    return {
     "LONG_bull_continuation":z["s24"]>.02 and z["s6"]>.01 and z["btc6"]>0 and z["b12"]>.65 and z["loc24"]>.70 and z["eff24"]>.25,
     "LONG_broad_trend":z["s3"]>0 and z["s6"]>.005 and z["b6"]>.7 and z["b12"]>.70 and z["btc24"]>.01 and z["eff12"]>.25,
     "LONG_relative_breakout":z["s6"]>.01 and z["rel6"]>.01 and z["breakout6"] and z["b12"]>.6,
     "LONG_recovery_confirmation":z["s24"]<0 and z["s6"]>.005 and z["s3"]>0 and z["loc24"]>.6 and z["b6"]>.55,
     "LONG_pullback_resume":z["s24"]>.02 and z["prev6"]<-.01 and z["s3"]>.003 and z["b12"]>.65 and z["loc24"]>.6,
     "SHORT_exhaustion":z["s24"]>.03 and z["s3"]<-.005 and z["s6"]<z["prev6"] and z["wick3"]>.30 and z["bd"]<0,
     "SHORT_fake_breakout":z["s24"]>.01 and z["failedbreak"] and z["wick3"]>.25 and z["s3"]<0,
     "SHORT_relative_weakness":z["s6"]<-.01 and z["rel6"]<-.01 and z["b12"]<.55 and z["eff12"]>.25,
     "SHORT_market_bear":z["s6"]<0 and z["s24"]<0 and z["btc6"]<0 and z["b6"]<.35 and z["loc24"]<.40,
     "SHORT_breadth_divergence":z["s24"]>0 and z["s6"]<0 and z["btc6"]<0 and z["bd"]<-.15 and z["rsi14"]<55,
     "SHORT_rejection_after_rally":z["s24"]>.02 and z["wick6"]>.45 and z["loc24"]<.6 and z["s3"]<-.005,
    }

history=[]
events=[]
for x in rows:
    eligible=[p for p in history if p["decisionTs"]+72*H<=x["decisionTs"]]
    past=eligible[-30:]
    prior_rate=sum(bool(p["wrong_native"]) for p in past)/len(past) if past else None
    if x["period"]=="TARGET":
        z=feat(x);votes=vote(z)
        nlong=sum(v for k,v in votes.items() if k.startswith("LONG"))
        nshort=sum(v for k,v in votes.items() if k.startswith("SHORT"))
        confident_long=nlong>=2 and nshort==0
        policies={
          "native_SHORT":"SHORT",
          "experts_LONG_else_SHORT":"LONG" if confident_long else "SHORT",
          "experts_LONG_else_ABSTAIN":"LONG" if confident_long else "SHORT" if nshort>=1 and nlong==0 else "ABSTAIN",
          "online60_LONG_else_SHORT":"LONG" if confident_long and len(past)>=16 and prior_rate>=.60 else "SHORT",
          "online50_breadth70_LONG_else_SHORT":"LONG" if confident_long and len(past)>=16 and prior_rate>=.50 and z["b12"]>=.70 else "SHORT",
        }
        events.append(dict(id=x["row_id"],period="train" if len(events)<211 else "validation" if len(events)<281 else "test",
            time=x["decisionTs"],symbol=x["symbol"],wrong=bool(x["wrong_native"]),
            native=x["native_return_full"],flip=x["flip_return_full"],prior_n=len(past),
            prior_wrong_rate=prior_rate,long_votes=nlong,short_votes=nshort,
            flags=[k for k,v in votes.items() if v],policies=policies))
    history.append(x)
assert len(events)==352
periods=["train","validation","test"]
allpatterns=sorted({name for z in events for name in z["flags"]})
def summary(items,side):
    n=len(items);favorable=sum((x["wrong"] if side=="LONG" else not x["wrong"]) for x in items)
    return dict(n=n,favorable=int(favorable),adverse=int(n-favorable),
                unweighted_delta_vs_native=sum(x["flip"]-x["native"] for x in items) if side=="LONG" else 0)
report=dict(status="RESEARCH_ONLY_NOT_ACCEPTED",route="REC_Y06_REV_D0_T72",n=352,
    source_runtime_sha=targets[0]["source_runtime_sha"],training_strategy="none: predeclared patterns, no test-selected thresholds",
    temporal_guard="last-30 preceding Y06 cases, only labels where decisionTs+72h<=now",
    source_sha256={source.name:hashlib.sha256(source.read_bytes()).hexdigest(),
                   cache_path.name:hashlib.sha256(cache_path.read_bytes()).hexdigest()},
    experts={},policies={},notes=[
        "test was previously observed in older Y06 research, not a clean future blind OOS",
        "pattern conjunctions and adaptive prior are exploratory; no Gate accepted",
        "raw modeled trade returns are not actual fills or integrated 10/30bps portfolio returns",
        "ABSTAIN saves no-entry return 0 but does not reproduce capital allocation/competition",
        "online prior calculated from 72h-settled counterfactual shadows, never future labels",
    ])
for name in allpatterns:
    side=name.split("_",1)[0]
    report["experts"][name]={period:summary([x for x in events if x["period"]==period and name in x["flags"]],side) for period in periods}
for pol in events[0]["policies"]:
    report["policies"][pol]={}
    for period in periods:
        subset=[x for x in events if x["period"]==period]
        parts={k:[x for x in subset if x["policies"][pol]==k] for k in ("LONG","SHORT","ABSTAIN")}
        raw=sum(x["flip"] if x["policies"][pol]=="LONG" else x["native"]
            if x["policies"][pol]=="SHORT" else 0 for x in subset)
        report["policies"][pol][period]={k:summary(parts[k],k) if k!="ABSTAIN" else {"n":len(parts[k])} for k in parts}
        report["policies"][pol][period]["raw_sum_modeled_noncompounded"]=raw
        report["policies"][pol][period]["native_raw_sum"]=sum(x["native"] for x in subset)
out=d/"v4_y06_11expert_adaptive_regime_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("RESULT",str(out))
for name in allpatterns:
    print("EXPERT",name," ".join(p+":"+str(report["experts"][name][p]["favorable"])+"/"+str(report["experts"][name][p]["n"]) for p in periods))
for pol,data in report["policies"].items():
    print("ROUTER",pol," ".join(p+":LONG "+str(data[p]["LONG"]["favorable"])+"/"+str(data[p]["LONG"]["n"])+" FP "+str(data[p]["LONG"]["adverse"])+" SHORT "+str(data[p]["SHORT"]["n"])+" WAIT "+str(data[p]["ABSTAIN"]["n"]) for p in periods))
print("SHA256",hashlib.sha256(out.read_bytes()).hexdigest())
