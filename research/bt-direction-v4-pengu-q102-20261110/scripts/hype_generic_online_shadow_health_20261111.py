#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib,itertools

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20250501_20251001"/"HYPE_BINANCE_PROXY"/"hype-preperiod-proxy-candidates-with-m5-exits.jsonl"
TARGET=R/"hype-aster-historical"/"hype-trend-pinned-candidates.json"
OUT=R/"DIRECTION_RESEARCH_20261109"/"hype_generic_online_shadow_health_20261111.json"
COST=.003
DAY=86400000

pre=[json.loads(x) for x in PRE.read_text(encoding="utf-8").splitlines() if x.strip()]
tar=json.loads(TARGET.read_text(encoding="utf-8"))

def norm_pre(z):
    return {"id":z["id"],"entryTs":int(z["entryTs"]),"exitTs":int(z["exitTs"]),
            "rawReturn":float(z["rawReturn"]),"source":"PRE_BINANCE_PROXY"}
def norm_tar(z):
    return {"id":z.get("id") or f"HYPE_{int(z['entry_ts_ms'])}",
            "entryTs":int(z["entry_ts_ms"]),"exitTs":int(z["exit_ts_ms"]),
            "rawReturn":float(z["unit_price_return"]),"source":"TARGET_ASTER_REPLAY"}
pre=list(map(norm_pre,pre)); tar=list(map(norm_tar,tar))
pre.sort(key=lambda z:(z["entryTs"],z["id"]));tar.sort(key=lambda z:(z["entryTs"],z["id"]))

def met(rows):
    vals=[z["rawReturn"]-COST for z in rows]
    gp=sum(x for x in vals if x>0);gl=-sum(x for x in vals if x<0)
    return {"n":len(vals),"wr":sum(x>0 for x in vals)/len(vals) if vals else None,
            "mean":sum(vals)/len(vals) if vals else None,"sum":sum(vals),
            "pf":gp/gl if gl else (999.0 if gp>0 else None)}

def simulate(rows,lookback_days,min_n,pf_max):
    admitted=[];blocked=[];decisions=[]
    for z in rows:
        t=z["entryTs"]
        hist=[h for h in rows if h["exitTs"]<=t and h["exitTs"]>=t-lookback_days*DAY]
        hm=met(hist)
        block=bool(hm["n"]>=min_n and hm["mean"] is not None and hm["mean"]<0 and hm["pf"] is not None and hm["pf"]<pf_max)
        q={**z,"health":hm,"blocked":block}
        decisions.append(q)
        (blocked if block else admitted).append(z)
    return {"baseline":met(rows),"admitted":met(admitted),"blockedShadow":met(blocked),
            "blockedN":len(blocked),"admittedN":len(admitted),"decisions":decisions}

# Generic policy is frozen from the cross-route pretarget walk-forward result, not HYPE-specific target tuning.
frozen={"lookbackDays":90,"minN":5,"pfMax":0.60}
pre_frozen=simulate(pre,**{"lookback_days":frozen["lookbackDays"],"min_n":frozen["minN"],"pf_max":frozen["pfMax"]})
target_frozen=simulate(tar,**{"lookback_days":frozen["lookbackDays"],"min_n":frozen["minN"],"pf_max":frozen["pfMax"]})

# Neighbor policies are reported as a robustness/falsification grid only. They MUST NOT be used to select the target result.
grid=[]
for lb,mn,pf in itertools.product((60,90,120),(5,6,8),(.5,.6,.7)):
    a=simulate(pre,lb,mn,pf); b=simulate(tar,lb,mn,pf)
    grid.append({"policy":{"lookbackDays":lb,"minN":mn,"pfMax":pf},
                 "pre":{"baseline":a["baseline"],"admitted":a["admitted"],"blockedN":a["blockedN"]},
                 "target":{"baseline":b["baseline"],"admitted":b["admitted"],"blockedN":b["blockedN"]}})
frozen_blocked=[{"id":z["id"],"entryTs":z["entryTs"],"health":z["health"]} for z in target_frozen["decisions"] if z["blocked"]]
out={
 "status":"GENERIC_PRETARGET_FROZEN_ONLINE_SHADOW_HEALTH_RESEARCH_ONLY",
 "frozenPolicy":frozen,
 "policyOrigin":"Cross-route PRETARGET walk-forward only: 90d / min5 / mean<0 / PF<0.60. No HYPE target-year parameter selection.",
 "semantics":"At each entry, health uses only shadow candidates whose exits are <= current entry. Blocked signals continue as shadow outcomes so the gate can recover causally.",
 "pretarget":{k:v for k,v in pre_frozen.items() if k!="decisions"},
 "targetOneShot":{k:v for k,v in target_frozen.items() if k!="decisions"},
 "targetBlocked":frozen_blocked,
 "neighborGridFalsificationOnly":grid,
 "hashes":{"pre":hashlib.sha256(PRE.read_bytes()).hexdigest(),"target":hashlib.sha256(TARGET.read_bytes()).hexdigest()},
 "warnings":[
   "Pretarget HYPE history is Binance UM proxy, not Aster.",
   "Target-year HYPE is used only for one-shot evaluation of the already-frozen generic policy.",
   "Neighbor target results are robustness diagnostics and must not be mined to choose a better policy."
 ]
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("FROZEN",frozen)
print("PRE",json.dumps(out["pretarget"],separators=(",",":")))
print("TARGET",json.dumps(out["targetOneShot"],separators=(",",":")))
print("TARGET_BLOCKED",len(frozen_blocked),[x["entryTs"] for x in frozen_blocked[:12]])
# summarize neighbor target robustness, without ranking
improve=sum(1 for x in grid if x["target"]["admitted"]["mean"] is not None and x["target"]["baseline"]["mean"] is not None and x["target"]["admitted"]["mean"]>x["target"]["baseline"]["mean"])
print("NEIGHBOR_TARGET_MEAN_IMPROVE",improve,"/",len(grid))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
