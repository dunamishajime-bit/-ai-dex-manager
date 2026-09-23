import json, math, itertools
from pathlib import Path
d=json.loads(Path(".research-state/v12-winrate-gates-20260923/result.json").read_text())
tr=d["results"]["BASELINE"]["NORMAL"]["trades"]
bounds=[1754784000000,1765296000000,1775808000000,1786320000000]
folds=[[x for x in tr if bounds[i]<=x["entryTs"]<bounds[i+1]] for i in range(3)]
features=["score","momentum","volumeRatio","prevVolumeRatio","volume2Mean","atrRatio","ret2h","ret6h","ret12h","ret24h","btc6h","btc12h","btc24h","rel24h","eth12h","sol12h","breadth12","breadth24","breakout12","closePos","reclaim6","pullback6","rankGap"]
def stat(xs):
    if not xs:return {"n":0,"wr":0.0,"pf":0.0,"avg":0.0}
    gp=sum(max(0,x["pct"]) for x in xs); gl=-sum(min(0,x["pct"]) for x in xs)
    return {"n":len(xs),"wr":sum(x["net"]>0 for x in xs)/len(xs)*100,"pf":gp/gl if gl else 99.0,"avg":sum(x["pct"] for x in xs)/len(xs)}
base=[stat(f) for f in folds]
train=folds[0]
atoms=[]
for f in features:
    vals=sorted(x[f] for x in train if isinstance(x.get(f),(int,float)) and math.isfinite(x[f]))
    if not vals: continue
    qs=[0.15,0.25,0.35,0.45,0.55,0.65,0.75,0.85]
    for q in qs:
        th=vals[min(len(vals)-1,int(q*(len(vals)-1)))]
        atoms.append((f,"ge",th)); atoms.append((f,"le",th))
atoms += [
    ("rank","le",1),("rank","le",2),
    ("route","eq","STRONG_REGIME_ALT"),("route","eq","RELAXED_MOMENTUM_ALT"),("route","ne","NORMAL_SCORE"),
    ("breadth12","ge",2/3),("breadth12","ge",1.0),("breadth24","ge",2/3),("breadth24","ge",1.0),
    ("reclaim6","ge",1.0),
]
# dedupe
seen=set(); atoms2=[]
for a in atoms:
    k=(a[0],a[1],round(a[2],10) if isinstance(a[2],float) else a[2])
    if k not in seen: seen.add(k); atoms2.append(a)
atoms=atoms2
def ok(a,x):
    f,op,th=a; v=x.get(f)
    if op=="eq":return v==th
    if op=="ne":return v!=th
    if not isinstance(v,(int,float)) or not math.isfinite(v):return False
    return v>=th if op=="ge" else v<=th
def ev(rule,fold):
    xs=[x for x in fold if all(ok(a,x) for a in rule)]
    return stat(xs)
# prefilter useful singles on TRAIN only, but keep diverse thresholds/features.
sing=[]
for a in atoms:
    s=ev((a,),train)
    if s["n"]>=60 and s["wr"]>=53:
        sing.append((s["wr"],s["pf"],s["n"],a))
sing.sort(reverse=True,key=lambda z:(z[0],z[1]))
pool=[]; per={}
for z in sing:
    f=z[3][0]
    if per.get(f,0)>=4: continue
    pool.append(z[3]); per[f]=per.get(f,0)+1
    if len(pool)>=42:break
cands=[]
def compatible(rule):
    # avoid exact duplicate feature/op combinations that add no information
    ks=[(a[0],a[1],a[2]) for a in rule]
    return len(set(ks))==len(ks)
def consider(rule):
    if not compatible(rule): return
    st=ev(rule,train)
    if st["n"]<35 or st["wr"]<62:return
    sv=ev(rule,folds[1])
    if sv["n"]<35:return
    minwr=min(st["wr"],sv["wr"])
    avgwr=(st["wr"]+sv["wr"])/2
    minpf=min(st["pf"],sv["pf"])
    if minwr<60:return
    score=minwr*2+avgwr+min(minpf,10)*0.5+min(st["n"],sv["n"])*0.02
    cands.append((score,minwr,avgwr,minpf,rule,st,sv))
for k in [1,2,3]:
    for rule in itertools.combinations(pool,k): consider(rule)
cands.sort(reverse=True,key=lambda z:z[0])
# Only extend the best dev-only 3-condition rules to a fourth condition.
seeds=[z[4] for z in cands[:30] if len(z[4])==3]
for seed in seeds:
    for a in pool:
        if a in seed: continue
        consider(tuple(list(seed)+[a]))
cands.sort(reverse=True,key=lambda z:z[0])
print("BASE",base)
print("POOL",len(pool),"CANDS",len(cands))
print("TOP_DEV_ONLY")
for i,z in enumerate(cands[:30]):
    o=ev(z[4],folds[2])
    print(i+1,"RULE",z[4],"TRAIN",z[5],"VAL",z[6],"OOS",o,"OOS_RETAIN",round(o["n"]/len(folds[2]),3))
if cands:
    z=cands[0]; o=ev(z[4],folds[2])
    print("SELECTED_BY_DEV_ONLY",z[4],"TRAIN",z[5],"VAL",z[6],"OOS",o,"TOTAL_N",z[5]["n"]+z[6]["n"]+o["n"])
