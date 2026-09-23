import json, math, statistics
from pathlib import Path
p=Path(".research-state/v12-winrate-gates-20260923/result.json")
d=json.loads(p.read_text())
tr=d["results"]["HC175_LOCKED"]["NORMAL"]["trades"]
features=["score","momentum","volumeRatio","prevVolumeRatio","volume2Mean","atrRatio","ret2h","ret6h","ret12h","ret24h","btc6h","btc12h","btc24h","rel24h","eth12h","sol12h","breadth12","breadth24","breakout12","closePos","reclaim6","pullback6","rankGap"]
def med(xs):
    xs=[x for x in xs if isinstance(x,(int,float)) and math.isfinite(x)]
    return statistics.median(xs) if xs else float("nan")
def q(xs,pct):
    xs=sorted(x for x in xs if isinstance(x,(int,float)) and math.isfinite(x))
    return xs[min(len(xs)-1,max(0,int((len(xs)-1)*pct)))] if xs else float("nan")
win=[x for x in tr if x["net"]>0]; loss=[x for x in tr if x["net"]<=0]
print("TOTAL",len(tr),"WIN",len(win),"LOSS",len(loss),"WR",round(100*len(win)/len(tr),3))
print("HC",sum(x["isHC"] for x in tr),"HCLOSS",sum(x["isHC"] and x["net"]<=0 for x in tr))
print("BY_ROUTE")
for r in ["NORMAL_SCORE","STRONG_REGIME_ALT","RELAXED_MOMENTUM_ALT","UNKNOWN"]:
    xs=[x for x in tr if x["route"]==r]
    if xs: print(r,len(xs),round(100*sum(x["net"]>0 for x in xs)/len(xs),2),round(sum(x["net"] for x in xs),2))
print("BY_RANK")
for r in [1,2,3]:
    xs=[x for x in tr if x["rank"]==r]
    if xs: print(r,len(xs),round(100*sum(x["net"]>0 for x in xs)/len(xs),2),round(sum(x["net"] for x in xs),2))
print("FEATURE_MEDIANS win loss diff")
rows=[]
for f in features:
    wm=med([x.get(f) for x in win]); lm=med([x.get(f) for x in loss])
    rows.append((abs(wm-lm),f,wm,lm,wm-lm))
for _,f,wm,lm,diff in sorted(rows,reverse=True)[:20]:
    print(f,round(wm,6),round(lm,6),round(diff,6))
print("LOSS_BUCKETS")
checks=[
("btc12_24_against",lambda x:x.get("btc12h",0)<0 and x.get("btc24h",0)<0),
("low_score_lt035",lambda x:x.get("score",0)<.35),
("rank2_low_score",lambda x:x.get("rank")==2 and x.get("score",0)<.35),
("ret2_over_1pct",lambda x:x.get("ret2h",0)>.01),
("ret24_under0",lambda x:x.get("ret24h",0)<0),
("breakout_negative",lambda x:x.get("breakout12",0)<0),
("no_reclaim",lambda x:x.get("reclaim6",0)<1),
("prevVol_gt1",lambda x:x.get("prevVolumeRatio",0)>1),
("rel24_negative",lambda x:x.get("rel24h",0)<0),
]
for name,fn in checks:
    xs=[x for x in tr if fn(x)]
    if xs:
        print(name,len(xs),round(100*sum(x["net"]>0 for x in xs)/len(xs),2),round(sum(x["net"] for x in xs),2), "losses",sum(x["net"]<=0 for x in xs))
print("WORST20")
for x in sorted(loss,key=lambda z:z["net"])[:20]:
    print(x["symbol"],x["route"],"r",x["rank"],"score",round(x["score"],3),"pct",round(x["pct"],2),"btc12",round(x["btc12h"],3),"btc24",round(x["btc24h"],3),"ret2",round(x["ret2h"],3),"ret24",round(x["ret24h"],3),"br",round(x["breakout12"],3),"rv",round(x["reclaim6"],2),"prevV",round(x["prevVolumeRatio"],2))
print("TARGETED_VARIANTS")
for k,v in d["results"].items():
    n=v["NORMAL"]; s=v["SEVERE"]
    print(k,round(n["finalEquity"]),round(n["winRatePct"],2),round(n["profitFactor"],3),round(n["maxDrawdownPct"],2),n["tradeCount"],round(s["finalEquity"]),round(s["profitFactor"],3),round(s["maxDrawdownPct"],2))
