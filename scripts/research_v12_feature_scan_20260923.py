import json, math, statistics
from pathlib import Path
p=Path(".research-state/v12-winrate-gates-20260923/result.json")
d=json.loads(p.read_text())
tr=d["results"]["BASELINE"]["NORMAL"]["trades"]
bounds=[0, 1765296000000, 1775808000000, 1786320000000]
# exact research folds: 2025-08-10, 2025-12-09 16:00, 2026-04-10 08:00, 2026-08-10
bounds=[1754784000000,1765296000000,1775808000000,1786320000000]
features=["score","momentum","volumeRatio","atrRatio","ret2h","ret6h","ret12h","ret24h","btc6h","btc12h","btc24h","rel24h","breakout12","closePos"]
def stat(xs):
    if not xs:return {"n":0,"wr":0,"pf":0,"avg":0}
    wins=sum(x["net"]>0 for x in xs)
    gp=sum(max(0,x["pct"]) for x in xs); gl=-sum(min(0,x["pct"]) for x in xs)
    return {"n":len(xs),"wr":wins/len(xs)*100,"pf":gp/gl if gl else 99,"avg":sum(x["pct"] for x in xs)/len(xs)}
folds=[[x for x in tr if bounds[i]<=x["entryTs"]<bounds[i+1]] for i in range(3)]
base=[stat(x) for x in folds]
dev=folds[0]+folds[1]
cands=[]
for f in features:
    vals=sorted(x[f] for x in dev if isinstance(x.get(f),(int,float)) and math.isfinite(x[f]))
    for q in [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9]:
        th=vals[min(len(vals)-1,int(q*(len(vals)-1)))]
        for op in ["ge","le"]:
            def keep(x):
                if x["route"]=="NORMAL_SCORE": return True
                v=x.get(f)
                if not isinstance(v,(int,float)) or not math.isfinite(v): return False
                return v>=th if op=="ge" else v<=th
            ss=[[x for x in fold if keep(x)] for fold in folds]
            st=[stat(x) for x in ss]
            retained=[st[i]["n"]/base[i]["n"] if base[i]["n"] else 0 for i in range(3)]
            deltas=[st[i]["wr"]-base[i]["wr"] for i in range(3)]
            if min(retained)>=0.45 and deltas[0]>0 and deltas[1]>0 and deltas[2]>0:
                cands.append((min(deltas),sum(deltas)/3,st[2]["wr"],retained[2],f,op,th,st,deltas,retained))
cands.sort(reverse=True,key=lambda z:(z[0],z[1],z[2]))
print("BASE",base)
print("TOP_SINGLE")
for z in cands[:30]:
    print(z[4],z[5],round(z[6],6),"minDelta",round(z[0],2),"avgDelta",round(z[1],2),"testWR",round(z[2],2),"testRetain",round(z[3],2),"deltas",[round(x,2) for x in z[8]],"ret",[round(x,2) for x in z[9]])
# Pair top 12 unique rules.
top=[]
seen=set()
for z in cands:
    k=(z[4],z[5],round(z[6],8))
    if k not in seen:
        seen.add(k); top.append(z)
    if len(top)>=16: break
pairs=[]
for i,a in enumerate(top):
  for b in top[i+1:]:
    def kr(rule,x):
      f,op,th=rule[4],rule[5],rule[6]
      if x["route"]=="NORMAL_SCORE":return True
      v=x.get(f)
      return isinstance(v,(int,float)) and math.isfinite(v) and (v>=th if op=="ge" else v<=th)
    ss=[[x for x in fold if kr(a,x) and kr(b,x)] for fold in folds]
    st=[stat(x) for x in ss]
    ret=[st[j]["n"]/base[j]["n"] for j in range(3)]
    de=[st[j]["wr"]-base[j]["wr"] for j in range(3)]
    if min(ret)>=0.4 and min(de)>0:
      pairs.append((min(de),sum(de)/3,st[2]["wr"],ret[2],a,b,st,de,ret))
pairs.sort(reverse=True,key=lambda z:(z[0],z[1],z[2]))
print("TOP_PAIRS")
for z in pairs[:25]:
  a,b=z[4],z[5]
  print((a[4],a[5],round(a[6],6)),(b[4],b[5],round(b[6],6)),"minDelta",round(z[0],2),"avgDelta",round(z[1],2),"testWR",round(z[2],2),"testRetain",round(z[3],2),"deltas",[round(x,2) for x in z[7]],"ret",[round(x,2) for x in z[8]])
