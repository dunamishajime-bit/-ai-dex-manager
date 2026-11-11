#!/usr/bin/env python3
from pathlib import Path
import json,datetime,collections,itertools,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
COST=.003
DAY=86400000
OUT=R/"DIRECTION_RESEARCH_20261109"/"pretarget_route_health_walkforward_policy_score_20261111.json"

sources=[
 ("PENGU","SHORT_V20",R/"PREPERIOD_TRAIN_20250101_20251001"/"PENGU_V20_BINANCE_PROXY"/"pengu-v20-preperiod-proxy-candidates-with-native-exits.jsonl"),
 ("HYPE","HYPE_TREND_LONG_PINNED",R/"PREPERIOD_TRAIN_20250501_20251001"/"HYPE_BINANCE_PROXY"/"hype-preperiod-proxy-candidates-with-m5-exits.jsonl"),
 ("IDLE","IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",R/"PREPERIOD_TRAIN_20250322_20251001"/"IDLE_TAO_BINANCE_PROXY"/"idle-tao-preperiod-proxy-candidates-with-m5-exits.jsonl"),
 ("Q102",None,R/"PREPERIOD_TRAIN_20250322_20251001"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl"),
]
groups=collections.defaultdict(list)
hashes={}
for strategy,label,p in sources:
    hashes[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip():continue
        z=json.loads(line); route=label if label else z["route"]
        groups[(strategy,route)].append(z)
for k in groups: groups[k].sort(key=lambda z:int(z["entryTs"]))

def rr(z):
    x=z.get("rawReturn")
    if x is None:x=z.get("grossReturn")
    return float(x)-COST

def health(rows):
    v=[rr(z) for z in rows]; gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
    return {"n":len(v),"mean":sum(v)/len(v) if v else None,"pf":gp/gl if gl else (999.0 if gp>0 else None)}

snaps=[datetime.datetime(2025,m,1,tzinfo=datetime.timezone.utc) for m in range(4,10)]
grid=list(itertools.product((60,90,120,180),(4,5,6,8),(.60,.70,.80,.90)))
results=[]
for lb,mn,pfmax in grid:
    observations=[]
    for dt in snaps:
        t=int(dt.timestamp()*1000); nxt=t+30*DAY
        for key,a in groups.items():
            prior=[z for z in a if t-lb*DAY<=int(z.get("exitTs",z["entryTs"]))<t]
            h=health(prior)
            if h["n"]<mn: continue
            future=[z for z in a if t<=int(z["entryTs"])<nxt]
            if not future: continue
            fv=[rr(z) for z in future]
            fsum=sum(fv); fmean=fsum/len(fv)
            block=h["mean"]<0 and h["pf"] is not None and h["pf"]<pfmax
            observations.append({"snapshot":dt.strftime("%Y-%m-%d"),"strategy":key[0],"route":key[1],
                                 "prior":h,"futureN":len(fv),"futureSum":fsum,"futureMean":fmean,"block":block})
    def score(obs):
        bl=[o for o in obs if o["block"]]
        # avoided sum positive when blocked route would have lost.
        avoided=-sum(o["futureSum"] for o in bl)
        false=sum(o["futureSum"]>0 for o in bl)
        true=sum(o["futureSum"]<0 for o in bl)
        futureN=sum(o["futureN"] for o in bl)
        return {"observations":len(obs),"blockedSnapshots":len(bl),"trueBadBlocks":true,"falseGoodBlocks":false,
                "avoidedNetSum":avoided,"blockedFutureN":futureN}
    train=[o for o in observations if o["snapshot"]<="2025-07-01"]
    valid=[o for o in observations if o["snapshot"]>="2025-08-01"]
    st,sv=score(train),score(valid)
    qualifies=(st["blockedSnapshots"]>=2 and sv["blockedSnapshots"]>=1 and st["avoidedNetSum"]>0 and sv["avoidedNetSum"]>=0 and
               st["falseGoodBlocks"]<=st["trueBadBlocks"] and sv["falseGoodBlocks"]<=sv["trueBadBlocks"])
    results.append({"policy":{"lookbackDays":lb,"minN":mn,"pfMax":pfmax},"train":st,"validation":sv,"qualifies":qualifies,
                    "observations":observations})
qualified=[x for x in results if x["qualifies"]]
qualified.sort(key=lambda x:(x["validation"]["avoidedNetSum"],x["train"]["avoidedNetSum"],-x["validation"]["falseGoodBlocks"]),reverse=True)
out={"status":"PRETARGET_ONLY_ROUTE_HEALTH_POLICY_WALKFORWARD","costBps":30,
     "snapshots":[x.isoformat() for x in snaps],"futureWindowDays":30,
     "policiesTested":len(results),"qualified":len(qualified),
     "best":[{k:v for k,v in x.items() if k!="observations"} for x in qualified[:20]],
     "allPolicySummary":[{k:v for k,v in x.items() if k!="observations"} for x in results],
     "sourceHashes":hashes,
     "warning":"All policy selection and validation windows end before 2025-10-01. Proxy/source limitations remain."}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("TESTED",len(results),"QUALIFIED",len(qualified))
for x in qualified[:12]:print(json.dumps({k:v for k,v in x.items() if k!="observations"},separators=(",",":")))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
