#!/usr/bin/env python3
from pathlib import Path
import json,datetime,collections,hashlib,itertools

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
END=int(datetime.datetime(2025,10,1,tzinfo=datetime.timezone.utc).timestamp()*1000)
COST=.003
OUT=R/"DIRECTION_RESEARCH_20261109"/"pretarget_route_health_policy_jitter_20261111.json"

sources=[
 ("PENGU","SHORT_V20",R/"PREPERIOD_TRAIN_20250101_20251001"/"PENGU_V20_BINANCE_PROXY"/"pengu-v20-preperiod-proxy-candidates-with-native-exits.jsonl"),
 ("HYPE","HYPE_TREND_LONG_PINNED",R/"PREPERIOD_TRAIN_20250501_20251001"/"HYPE_BINANCE_PROXY"/"hype-preperiod-proxy-candidates-with-m5-exits.jsonl"),
 ("IDLE","IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",R/"PREPERIOD_TRAIN_20250322_20251001"/"IDLE_TAO_BINANCE_PROXY"/"idle-tao-preperiod-proxy-candidates-with-m5-exits.jsonl"),
 ("Q102",None,R/"PREPERIOD_TRAIN_20250322_20251001"/"Q102_SELECTED_BASE"/"q102-s34-selected-native-exits.jsonl"),
]
groups=collections.defaultdict(list)
source_hashes={}
for strategy,label,p in sources:
    source_hashes[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
    rows=[json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
    for z in rows:
        route=label if label is not None else z["route"]
        groups[(strategy,route)].append(z)

def rr(z):
    x=z.get("rawReturn")
    if x is None:x=z.get("grossReturn")
    return float(x)

def metric(a):
    v=[rr(z)-COST for z in a]
    gp=sum(x for x in v if x>0); gl=-sum(x for x in v if x<0)
    return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
            "mean":sum(v)/len(v) if v else None,
            "pf":gp/gl if gl else (999.0 if gp>0 else None)}

lookbacks=(60,90,120,180)
min_ns=(4,5,6,8)
pf_maxes=(.60,.70,.80,.90)
policies=[]
counts=collections.Counter()
eligible=collections.Counter()
per_route=collections.defaultdict(list)

for lb,mn,pfmax in itertools.product(lookbacks,min_ns,pf_maxes):
    cut=END-lb*86400000
    blocked=[]
    for key,a in sorted(groups.items()):
        recent=[z for z in a if cut<=int(z["entryTs"])<END and int(z.get("exitTs",END))<=END]
        m=metric(recent)
        can=m["n"]>=mn
        b=bool(can and m["mean"] is not None and m["mean"]<0 and m["pf"] is not None and m["pf"]<pfmax)
        if can: eligible[key]+=1
        if b:
            counts[key]+=1; blocked.append({"strategy":key[0],"route":key[1],"metric":m})
        per_route[key].append({"lookbackDays":lb,"minN":mn,"pfMax":pfmax,"metric":m,"eligible":can,"block":b})
    policies.append({"lookbackDays":lb,"minN":mn,"pfMax":pfmax,"blocked":[{"strategy":x["strategy"],"route":x["route"]} for x in blocked]})

routes=[]
for key in sorted(groups):
    e=eligible[key]; c=counts[key]
    routes.append({"strategy":key[0],"route":key[1],"blockedCount":c,"eligiblePolicyCount":e,
                   "blockRateWhenEligible":c/e if e else None,
                   "stableBlock":bool(e>=16 and c/e>=.75),
                   "stableKeep":bool(e>=16 and c/e<=.25)})
result={"status":"PRETARGET_ROUTE_HEALTH_POLICY_JITTER_CAUSAL_ONLY","snapshotTs":"2025-10-01T00:00:00Z",
        "costBps":30,"grid":{"lookbackDays":lookbacks,"minN":min_ns,"pfMax":pf_maxes},
        "policyCount":len(policies),"routes":routes,"policies":policies,
        "sourceHashes":source_hashes,
        "warning":"No target-year outcomes used. Proxy/source limitations remain."}
OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("POLICIES",len(policies))
for z in routes:
    print(z["strategy"],z["route"],"blocked",z["blockedCount"],"/ eligible",z["eligiblePolicyCount"],"rate",z["blockRateWhenEligible"],"STABLE_BLOCK",z["stableBlock"])
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
