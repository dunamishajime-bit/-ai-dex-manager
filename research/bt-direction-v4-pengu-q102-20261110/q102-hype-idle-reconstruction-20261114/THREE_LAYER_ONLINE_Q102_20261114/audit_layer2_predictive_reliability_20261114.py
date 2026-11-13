import json,math,statistics,datetime as dt
from pathlib import Path
D=Path(r"C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109")
rows=[json.loads(l) for l in (D/"three_layer_layer2_online_ensemble_20261114.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
def corr(xs):
 a=[x["predEV30"] for x in xs if x["predEV30"] is not None and x["realizedNet30"] is not None]
 b=[x["realizedNet30"] for x in xs if x["predEV30"] is not None and x["realizedNet30"] is not None]
 if len(a)<3:return None
 ma=sum(a)/len(a);mb=sum(b)/len(b)
 va=sum((x-ma)**2 for x in a);vb=sum((y-mb)**2 for y in b)
 return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(va*vb) if va and vb else 0
def buckets(xs):
 z=[x for x in xs if x["predEV30"] is not None and x["realizedNet30"] is not None]
 z.sort(key=lambda x:x["predEV30"])
 if len(z)<10:return []
 out=[]
 for i in range(5):
  q=z[i*len(z)//5:(i+1)*len(z)//5]
  if q:out.append((round(sum(x["predEV30"] for x in q)/len(q),4),round(sum(x["realizedNet30"] for x in q)/len(q),4),len(q)))
 return out
for s in sorted(set(x["strategy"] for x in rows)):
 xs=[x for x in rows if x["strategy"]==s]
 print("\n",s,"N",sum(x["predEV30"] is not None for x in xs),"CORR",corr(xs),"BUCKETS",buckets(xs))
 # first/second half by time
 z=sorted([x for x in xs if x["predEV30"] is not None],key=lambda x:x["entryTs"])
 if z:
  mid=len(z)//2
  print(" HALF1",corr(z[:mid]),buckets(z[:mid]))
  print(" HALF2",corr(z[mid:]),buckets(z[mid:]))