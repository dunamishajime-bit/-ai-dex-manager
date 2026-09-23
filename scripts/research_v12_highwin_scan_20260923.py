import json, math, itertools
from pathlib import Path
d=json.loads(Path(".research-state/v12-winrate-gates-20260923/result.json").read_text())
tr=d["results"]["BASELINE"]["NORMAL"]["trades"]
bounds=[1754784000000,1765296000000,1775808000000,1786320000000]
folds=[[x for x in tr if bounds[i]<=x["entryTs"]<bounds[i+1]] for i in range(3)]
features=["score","momentum","volumeRatio","atrRatio","ret2h","ret6h","ret12h","ret24h","btc6h","btc12h","btc24h","rel24h","breakout12","closePos"]
def stat(xs):
    if not xs:return {"n":0,"wr":0,"pf":0,"avg":0}
    gp=sum(max(0,x["pct"]) for x in xs); gl=-sum(min(0,x["pct"]) for x in xs)
    return {"n":len(xs),"wr":sum(x["net"]>0 for x in xs)/len(xs)*100,"pf":gp/gl if gl else 99,"avg":sum(x["pct"] for x in xs)/len(xs)}
base=[stat(f) for f in folds]
dev=folds[0]+folds[1]
atoms=[]
# numeric thresholds derived ONLY from dev folds
for f in features:
    vals=sorted(x[f] for x in dev if isinstance(x.get(f),(int,float)) and math.isfinite(x[f]))
    for q in [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9]:
        th=vals[min(len(vals)-1,int(q*(len(vals)-1)))]
        atoms.append((f,"ge",th)); atoms.append((f,"le",th))
atoms += [("rank","le",1),("rank","le",2),("route","eq","STRONG_REGIME_ALT"),("route","eq","RELAXED_MOMENTUM_ALT"),("route","eq","NORMAL_SCORE")]
def ok_atom(a,x):
    f,op,th=a
    v=x.get(f)
    if op=="eq": return v==th
    if not isinstance(v,(int,float)) or not math.isfinite(v): return False
    return v>=th if op=="ge" else v<=th
def eval_rule(rule):
    ss=[[x for x in fold if all(ok_atom(a,x) for a in rule)] for fold in folds]
    st=[stat(x) for x in ss]
    ret=[st[i]["n"]/base[i]["n"] if base[i]["n"] else 0 for i in range(3)]
    return st,ret
# keep robust single atoms using dev folds only
single=[]
for a in atoms:
    st,ret=eval_rule((a,))
    if min(ret[:2])>=0.12 and min(st[0]["wr"],st[1]["wr"])>=58:
        single.append((min(st[0]["wr"],st[1]["wr"]), (st[0]["wr"]+st[1]["wr"])/2, sum(ret[:2])/2, a, st, ret))
single.sort(reverse=True,key=lambda z:(z[0],z[1],z[2]))
pool=[z[3] for z in single[:45]]
rules=[]
for k in [1,2,3]:
    combos=[(a,) for a in pool] if k==1 else itertools.combinations(pool,k)
    for rule in combos:
        # avoid contradictory duplicate-feature same-direction junk
        names=[a[0] for a in rule]
        if len(set(rule))<len(rule): continue
        st,ret=eval_rule(rule)
        # selection uses only folds 0/1
        if min(ret[0],ret[1])<0.12: continue
        if min(st[0]["wr"],st[1]["wr"])<62: continue
        devmin=min(st[0]["wr"],st[1]["wr"])
        devavg=(st[0]["wr"]+st[1]["wr"])/2
        rules.append((devmin,devavg,(ret[0]+ret[1])/2,rule,st,ret))
rules.sort(reverse=True,key=lambda z:(z[0],z[1],z[2]))
print("BASE",base)
print("TOP_DEV_SELECTED_WITH_OOS")
for z in rules[:60]:
    rule=z[3]; st=z[4]; ret=z[5]
    print("RULE",rule,"DEV_MIN",round(z[0],2),"DEV_AVG",round(z[1],2),"DEV_RETAIN",round(z[2],2),
          "F0",round(st[0]["wr"],2),st[0]["n"],round(st[0]["pf"],2),
          "F1",round(st[1]["wr"],2),st[1]["n"],round(st[1]["pf"],2),
          "OOS",round(st[2]["wr"],2),st[2]["n"],round(st[2]["pf"],2),"OOS_RETAIN",round(ret[2],2))
# report candidates that happened to clear 70 OOS, but selection ranking remains dev-only
print("OOS70_AMONG_TOP_DEV")
count=0
for z in rules[:300]:
    st=z[4]; ret=z[5]
    if st[2]["wr"]>=70 and ret[2]>=0.10:
        print("RULE",z[3],"DEV_MIN",round(z[0],2),"DEV_AVG",round(z[1],2),"OOS",round(st[2]["wr"],2),"OOS_N",st[2]["n"],"OOS_PF",round(st[2]["pf"],2),"OOS_RETAIN",round(ret[2],2))
        count+=1
        if count>=30: break
