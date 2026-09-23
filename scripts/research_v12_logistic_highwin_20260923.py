import json, math
from pathlib import Path
d=json.loads(Path(".research-state/v12-winrate-gates-20260923/result.json").read_text())
tr=d["results"]["BASELINE"]["NORMAL"]["trades"]
bounds=[1754784000000,1765296000000,1775808000000,1786320000000]
folds=[[x for x in tr if bounds[i]<=x["entryTs"]<bounds[i+1]] for i in range(3)]
features=["score","momentum","volumeRatio","atrRatio","ret2h","ret6h","ret12h","ret24h","btc6h","btc12h","btc24h","rel24h","breakout12","closePos"]
routes=["NORMAL_SCORE","STRONG_REGIME_ALT","RELAXED_MOMENTUM_ALT"]
def vec(x):
    out=[]
    for f in features:
        v=x.get(f,0.0)
        out.append(float(v) if isinstance(v,(int,float)) and math.isfinite(v) else 0.0)
    out.append(float(x.get("rank",0)))
    for r in routes: out.append(1.0 if x.get("route")==r else 0.0)
    return out
def y(x): return 1.0 if x["net"]>0 else 0.0
X0=[vec(x) for x in folds[0]]; Y0=[y(x) for x in folds[0]]
mu=[sum(row[j] for row in X0)/len(X0) for j in range(len(X0[0]))]
sd=[]
for j,m in enumerate(mu):
    v=sum((row[j]-m)**2 for row in X0)/max(1,len(X0)-1)
    sd.append(math.sqrt(v) if v>1e-12 else 1.0)
def zrow(row): return [(row[j]-mu[j])/sd[j] for j in range(len(row))]
ZX0=[zrow(r) for r in X0]
def sigmoid(a):
    if a>=0:
        e=math.exp(-a); return 1/(1+e)
    e=math.exp(a); return e/(1+e)
def train(l2, lr=0.03, epochs=2500):
    w=[0.0]*(len(ZX0[0])+1)
    n=len(ZX0)
    for ep in range(epochs):
        g=[0.0]*len(w)
        for row,yy in zip(ZX0,Y0):
            p=sigmoid(w[0]+sum(w[j+1]*row[j] for j in range(len(row))))
            e=p-yy; g[0]+=e
            for j,v in enumerate(row): g[j+1]+=e*v
        g[0]/=n
        for j in range(1,len(w)): g[j]=g[j]/n+l2*w[j]
        eta=lr/(1+ep/1200)
        for j in range(len(w)): w[j]-=eta*g[j]
    return w
def probs(w,fold):
    out=[]
    for x in fold:
        row=zrow(vec(x)); p=sigmoid(w[0]+sum(w[j+1]*row[j] for j in range(len(row))))
        out.append((p,x))
    return out
def stats(sel):
    if not sel:return {"n":0,"wr":0,"pf":0,"avg":0}
    xs=[x for _,x in sel]
    gp=sum(max(0,x["pct"]) for x in xs); gl=-sum(min(0,x["pct"]) for x in xs)
    return {"n":len(xs),"wr":sum(x["net"]>0 for x in xs)/len(xs)*100,"pf":gp/gl if gl else 99,"avg":sum(x["pct"] for x in xs)/len(xs)}
print("BASE",[stats([(1,x) for x in f]) for f in folds])
for l2 in [0.0,0.001,0.005,0.01,0.03,0.1]:
    w=train(l2)
    val=probs(w,folds[1]); test=probs(w,folds[2]); trainp=probs(w,folds[0])
    cand=[]
    for th in [i/100 for i in range(40,91)]:
        sv=[z for z in val if z[0]>=th]
        st=stats(sv)
        if st["n"]>=40 and st["wr"]>=68:
            cand.append((th,st))
    if not cand:
        print("L2",l2,"NO_VALIDATION_68_WITH_N40")
        continue
    th,vs=min(cand,key=lambda z:z[0])
    ts=stats([z for z in test if z[0]>=th]); trs=stats([z for z in trainp if z[0]>=th])
    print("MODEL","l2",l2,"th",th,"train",trs,"val",vs,"oos",ts,"oosRet",round(ts["n"]/len(folds[2]),3))
    # show feature weights
    names=["intercept"]+features+["rank"]+["route_"+r for r in routes]
    top=sorted(zip(names,w),key=lambda z:abs(z[1]),reverse=True)[:10]
    print("TOPW",[(n,round(v,4)) for n,v in top])
