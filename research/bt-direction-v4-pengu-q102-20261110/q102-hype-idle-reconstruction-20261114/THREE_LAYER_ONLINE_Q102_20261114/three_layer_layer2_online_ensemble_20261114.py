import json,csv,math,statistics,hashlib,re
from pathlib import Path
from collections import defaultdict,Counter
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=ROOT/"DIRECTION_RESEARCH_20261109"
SRC=D/"three_layer_layer1_all_candidates_20261114.jsonl"
OUT=D/"three_layer_layer2_online_ensemble_20261114.jsonl"
SUM=D/"three_layer_layer2_online_ensemble_summary_20261114.json"
rows=[json.loads(x) for x in SRC.read_text(encoding="utf-8").splitlines() if x.strip()]

def raw_return(x):
    v=x.get("v") or {}; m=x.get("model") or {}
    for k in ("rawReturn","grossReturn","gross_price_return","unit_price_return"):
        if isinstance(v.get(k),(int,float)): return float(v[k])
    ep=m.get("entryPrice");xp=m.get("exitPrice")
    if not isinstance(ep,(int,float)) or not isinstance(xp,(int,float)) or ep==0:return None
    return (xp/ep-1.0) if x["side"]=="LONG" else (1.0-xp/ep)

def fund_return(x):
    z=x.get("funding") or []
    s=0.0
    for q in z:
        if isinstance(q,list) and len(q)>1 and isinstance(q[1],(int,float)):s+=float(q[1])
    return s

def exit_ts(x):
    m=x.get("model") or {}
    return int(m.get("exitTs") or x["entryTs"])

def expected_hold_hours(x):
    v=x.get("v") or {}
    for k in ("holdHours","maxHoldHours"):
        if isinstance(v.get(k),(int,float)):return max(1.0,float(v[k]))
    if x["strategy"]=="PENGU":
        k="longMaxHoldHours" if x["side"]=="LONG" else "shortMaxHoldHours"
        if isinstance(v.get(k),(int,float)):return max(1.0,float(v[k]))
    if x["strategy"]=="HYPE" and "H48" in x["route"]:return 48.0
    if x["strategy"]=="V52":
        a=v.get("entry_ts_ms");b=v.get("forced_flat_ms")
        if isinstance(a,(int,float)) and isinstance(b,(int,float)) and b>a:return max(1.0,(b-a)/3600000)
    route=x.get("route") or ""
    pats=[r'TIME_(\d+)H',r'_H(\d+)(?:_|$)',r'_T(\d+)(?:_|$)']
    for pat in pats:
        m=re.search(pat,route)
        if m:return max(1.0,float(m.group(1)))
    return 24.0

ALLOWED_EXACT={"rank","strength","margin","score","sg","state_age_h","onset_momentum90",
               "atr","atrRatio","volumeRatio","pengu72h","btc24h","btc24","rel24","rel12","rel6","rel72",
               "h6","h12","h24","h72","b6","b12","b24","b72","er24","pos24","rv24","brv24",
               "ret6","ret12","ret14","ret24","ret48","ret72","return24h","return48h","return72h",
               "entry_basis_bps","capture_basis_bps"}

def features(x):
    v=x.get("v") or {}; out={}
    def add(prefix,obj):
        if not isinstance(obj,dict):return
        for k,val in obj.items():
            key=(prefix+"."+k) if prefix else k
            if isinstance(val,dict):
                add(key,val);continue
            if not isinstance(val,(int,float)) or isinstance(val,bool):continue
            leaf=k
            if leaf in ALLOWED_EXACT or leaf.startswith(("ret","rel","btc","atr","volume","return")) or leaf.endswith("_bps"):
                out[key]=float(val)
    add("",v)
    return out

for x in rows:
    rr=raw_return(x)
    x["_raw"]=rr
    x["_fund"]=fund_return(x)
    x["_net30"]=None if rr is None else rr+x["_fund"]-0.003
    x["_exitTs"]=exit_ts(x)
    x["_feat"]=features(x)
    x["_holdH"]=expected_hold_hours(x)

rows.sort(key=lambda x:(int(x["entryTs"]),x["strategy"],x["id"]))
completed=[]
scored=[]

def wstats(hist,t,half_days=90.0):
    if not hist:return None
    vals=[]
    for h in hist:
        age=max(0.0,(t-h["_exitTs"])/86400000.0)
        w=0.5**(age/half_days)
        y=h["_net30"]
        if y is not None:vals.append((w,y))
    if not vals:return None
    sw=sum(w for w,_ in vals); sw2=sum(w*w for w,_ in vals)
    if sw<=0:return None
    mean=sum(w*y for w,y in vals)/sw
    pwin=sum(w for w,y in vals if y>0)/sw
    var=sum(w*(y-mean)**2 for w,y in vals)/sw
    neff=sw*sw/sw2 if sw2 else 0
    return {"mean":mean,"pwin":pwin,"sd":math.sqrt(max(0,var)),"neff":neff,"n":len(vals),"sw":sw}

def knn_stats(x,hist,t,k=12):
    fx=x["_feat"]
    if len(fx)<1:return None
    cand=[]
    # Candidate pool is same strategy+side, all fully completed.
    pool=[h for h in hist if h["strategy"]==x["strategy"] and h["side"]==x["side"] and h["_net30"] is not None]
    if len(pool)<6:return None
    # Past-only robust scale per feature.
    scales={}
    for key in fx:
        vals=[h["_feat"][key] for h in pool if key in h["_feat"]]
        if len(vals)>=5:
            med=statistics.median(vals)
            mad=statistics.median([abs(z-med) for z in vals])
            scales[key]=(med,max(mad*1.4826,1e-6))
    for h in pool:
        common=[key for key in fx if key in h["_feat"] and key in scales]
        if len(common)<1:continue
        ds=[(fx[key]-h["_feat"][key])/scales[key][1] for key in common]
        dist=math.sqrt(sum(z*z for z in ds)/len(ds))
        age=max(0.0,(t-h["_exitTs"])/86400000.0)
        tw=0.5**(age/90.0)
        cand.append((dist,h,tw,len(common)))
    if len(cand)<5:return None
    cand.sort(key=lambda z:z[0])
    sel=cand[:min(k,len(cand))]
    vals=[]
    for dist,h,tw,nc in sel:
        w=tw/(0.35+dist)
        vals.append((w,h["_net30"]))
    sw=sum(w for w,_ in vals);sw2=sum(w*w for w,_ in vals)
    mean=sum(w*y for w,y in vals)/sw
    pwin=sum(w for w,y in vals if y>0)/sw
    var=sum(w*(y-mean)**2 for w,y in vals)/sw
    neff=sw*sw/sw2 if sw2 else 0
    return {"mean":mean,"pwin":pwin,"sd":math.sqrt(max(0,var)),"neff":neff,"n":len(vals)}

def shrink(st,base,prior=8.0):
    if st is None:return None
    if base is None:return st
    n=max(0.0,st["neff"])
    return {"mean":(n*st["mean"]+prior*base["mean"])/(n+prior),
            "pwin":(n*st["pwin"]+prior*base["pwin"])/(n+prior),
            "sd":st["sd"],"neff":n,"n":st["n"]}

for x in rows:
    t=int(x["entryTs"])
    # make only outcomes that are completed before t available
    hist=[h for h in completed if h["_exitTs"]<t]
    base=wstats([h for h in hist if h["strategy"]==x["strategy"] and h["side"]==x["side"]],t)
    route=shrink(wstats([h for h in hist if h["strategy"]==x["strategy"] and h["side"]==x["side"] and h["route"]==x["route"]],t),base)
    sym=shrink(wstats([h for h in hist if h["strategy"]==x["strategy"] and h["side"]==x["side"] and h["symbol"]==x["symbol"]],t),base)
    knn=shrink(knn_stats(x,hist,t),base)
    comps=[]
    for name,st,mult in (("strategy",base,0.5),("route",route,2.0),("symbol",sym,1.0),("knn",knn,2.0)):
        if st and st["neff"]>=1.5:
            wt=mult*min(12.0,st["neff"])
            comps.append((name,st,wt))
    if comps:
        sw=sum(w for _,_,w in comps)
        pev=sum(st["mean"]*w for _,st,w in comps)/sw
        pwin=sum(st["pwin"]*w for _,st,w in comps)/sw
        signs=[st["mean"]>0 for _,st,_ in comps]
        agree=max(sum(signs),len(signs)-sum(signs))/len(signs)
        mxne=max(st["neff"] for _,st,_ in comps)
        sd=sum(st["sd"]*w for _,st,w in comps)/sw
        sample_conf=1-math.exp(-mxne/8.0)
        uncertainty=1/(1+sd/0.04)
        conf=sample_conf*(0.5+0.5*agree)*(0.65+0.35*uncertainty)
        analogs=max(st["n"] for _,st,_ in comps)
    else:
        pev=pwin=conf=None;analogs=0
    promote=bool(pev is not None and pwin>=0.60 and pev>0.002 and conf>=0.45 and analogs>=6)
    opp=None
    if pev is not None:
        gross=max(0.25,float(x["gross"]))
        occ=max(0.25,x["_holdH"]/24.0)
        opp=pev*conf/gross/occ
    scored.append({
      "id":x["id"],"strategy":x["strategy"],"entryTs":x["entryTs"],"exitTs":x["_exitTs"],
      "symbol":x["symbol"],"side":x["side"],"route":x["route"],"gross":x["gross"],
      "layer1Kept":x["layer1Kept"],"expectedHoldHours":x["_holdH"],
      "predEV30":pev,"predWinProb":pwin,"confidence":conf,"analogs":analogs,
      "opportunityScore":opp,"layer2Promote":promote,
      "realizedNet30":x["_net30"],
      "components":{name:st for name,st,_ in comps}
    })
    completed.append(x)

with open(OUT,"w",encoding="utf-8") as f:
    for z in scored:f.write(json.dumps(z,ensure_ascii=False,separators=(",",":"))+"\n")

# Join baseline final decision for kept candidates.
dec_path=next((ROOT/"S3_P3_HYPEWSIG_FORMALFREEENTRY_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114").glob("*_30BPS_DECISIONS.csv"))
dec={}
with open(dec_path,newline="",encoding="utf-8-sig") as f:
    for z in csv.DictReader(f):dec[z["signal_id"]]=z
for z in scored:
    q=dec.get(z["id"])
    z["baselineDecision"]=None if q is None else q["decision"]
    z["baselineReason"]=None if q is None else q["reason"]

def metrics(xs):
    ys=[z["realizedNet30"] for z in xs if z["realizedNet30"] is not None]
    if not ys:return {"n":0}
    gp=sum(y for y in ys if y>0);gl=-sum(y for y in ys if y<0)
    return {"n":len(ys),"wr":sum(y>0 for y in ys)/len(ys),"mean":sum(ys)/len(ys),"sum":sum(ys),
            "pf":gp/gl if gl else 999.0,"worst":min(ys)}

filtered=[z for z in scored if not z["layer1Kept"]]
promoted=[z for z in filtered if z["layer2Promote"]]
bystr={}
for s in sorted(set(z["strategy"] for z in scored)):
    bystr[s]={
      "all":metrics([z for z in scored if z["strategy"]==s]),
      "filtered":metrics([z for z in filtered if z["strategy"]==s]),
      "promotedFiltered":metrics([z for z in promoted if z["strategy"]==s]),
      "promotedIds":[z["id"] for z in promoted if z["strategy"]==s]
    }
# Also examine kept but baseline BLOCK as Layer3 opportunity pool.
kept_block=[z for z in scored if z["layer1Kept"] and z.get("baselineDecision")=="BLOCK"]
promoted_block=[z for z in kept_block if z["layer2Promote"]]
summary={
 "status":"RESEARCH_ONLY_THREE_LAYER_LAYER2_ONLINE_ENSEMBLE",
 "productionMutation":False,
 "selectionUsesFutureOutcome":False,
 "model":"causal completed-shadow hierarchical route/symbol/strategy + feature-KNN ensemble",
 "fixedPolicy":{"predWinProbMin":0.60,"predEV30Min":0.002,"confidenceMin":0.45,"analogsMin":6,
                "costModelRoundtrip":0.003,"halfLifeDays":90,"knnK":12},
 "counts":{"all":len(scored),"layer1Filtered":len(filtered),"layer2PromotedFiltered":len(promoted),
           "keptBaselineBlocked":len(kept_block),"layer2PromotedBaselineBlocked":len(promoted_block)},
 "metrics":{"allFiltered":metrics(filtered),"promotedFiltered":metrics(promoted),
            "keptBaselineBlocked":metrics(kept_block),"promotedBaselineBlocked":metrics(promoted_block)},
 "byStrategy":bystr,
 "promotedFilteredTop":sorted(promoted,key=lambda z:z["opportunityScore"] or -999,reverse=True)[:100],
 "promotedBaselineBlockedTop":sorted(promoted_block,key=lambda z:z["opportunityScore"] or -999,reverse=True)[:100],
}
SUM.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
print("SUMMARY",SUM,"SHA256",hashlib.sha256(SUM.read_bytes()).hexdigest())
print("COUNTS",summary["counts"])
print("METRICS",json.dumps(summary["metrics"],ensure_ascii=False))
for s,v in bystr.items():
    print(s,"FILTERED",v["filtered"],"PROMOTED",v["promotedFiltered"])
print("TOP_PROMOTED_FILTERED")
for z in summary["promotedFilteredTop"][:25]:
    print(json.dumps({k:z[k] for k in ("id","strategy","symbol","side","route","predEV30","predWinProb","confidence","analogs","opportunityScore","realizedNet30")},ensure_ascii=False))