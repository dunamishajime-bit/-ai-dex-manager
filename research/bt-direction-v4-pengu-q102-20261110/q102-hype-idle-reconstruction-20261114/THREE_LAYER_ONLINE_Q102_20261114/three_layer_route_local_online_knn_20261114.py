import json,math,statistics,hashlib,collections
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001");D=R/"DIRECTION_RESEARCH_20261109"
src=[json.loads(l) for l in (D/"three_layer_layer1_all_candidates_20261114.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
def raw_return(x):
 v=x.get("v") or {};m=x.get("model") or {}
 if isinstance(v.get("rawReturn"),(int,float)):return float(v["rawReturn"])
 ep=m.get("entryPrice");xp=m.get("exitPrice")
 if not isinstance(ep,(int,float)) or not isinstance(xp,(int,float)) or not ep:return None
 return xp/ep-1 if x["side"]=="LONG" else 1-xp/ep
def fund(x):
 return sum(float(q[1]) for q in (x.get("funding") or []) if isinstance(q,list) and len(q)>1 and isinstance(q[1],(int,float)))
def xt(x):return int((x.get("model") or {}).get("exitTs") or x["entryTs"])
def feat(x):
 v=x.get("v") or {};o={}
 allowed=("ret","rel","btc","atr","volume","return","strength","margin","score","er24","pos24","rv24","brv24","pengu72h")
 def walk(pre,z):
  if not isinstance(z,dict):return
  for k,val in z.items():
   key=(pre+"."+k) if pre else k
   if isinstance(val,dict):walk(key,val)
   elif isinstance(val,(int,float)) and not isinstance(val,bool):
    leaf=k.lower()
    if any(leaf.startswith(a.lower()) for a in allowed) or leaf in allowed:o[key]=float(val)
 walk("",v);return o
rows=[]
for x in src:
 y=dict(x);r=raw_return(y);y["_net"]=None if r is None else r+fund(y)-.003;y["_xt"]=xt(y);y["_f"]=feat(y);rows.append(y)
rows.sort(key=lambda x:(x["entryTs"],x["id"]))
out=[]
for x in rows:
 if x["strategy"] not in ("IDLE","PENGU","Q102"):continue
 if x["layer1Kept"]:continue
 pool=[h for h in rows if h["strategy"]==x["strategy"] and h["route"]==x["route"] and h["side"]==x["side"] and h["_xt"]<x["entryTs"] and h["_net"] is not None]
 fx=x["_f"]
 pred=None
 if len(pool)>=10 and fx:
  scales={}
  for k in fx:
   vals=[h["_f"][k] for h in pool if k in h["_f"]]
   if len(vals)>=8:
    med=statistics.median(vals);mad=statistics.median(abs(z-med) for z in vals)
    scales[k]=(med,max(mad*1.4826,1e-6))
  ds=[]
  for h in pool:
   common=[k for k in fx if k in h["_f"] and k in scales]
   if len(common)<2:continue
   d=math.sqrt(sum(((fx[k]-h["_f"][k])/scales[k][1])**2 for k in common)/len(common))
   age=max(0,(x["entryTs"]-h["_xt"])/86400000)
   w=(0.5**(age/90))/(0.35+d)
   ds.append((d,w,h["_net"]))
  ds.sort(key=lambda z:z[0]);q=ds[:min(12,len(ds))]
  if len(q)>=8:
   sw=sum(w for _,w,_ in q);sw2=sum(w*w for _,w,_ in q)
   ev=sum(w*y for _,w,y in q)/sw;p=sum(w for _,w,y in q if y>0)/sw
   ne=sw*sw/sw2 if sw2 else 0
   avgd=sum(d for d,_,_ in q)/len(q)
   conf=(1-math.exp(-ne/6))*(1/(1+avgd))
   pred={"ev":ev,"pwin":p,"neff":ne,"n":len(q),"avgDistance":avgd,"confidence":conf}
 promote=bool(pred and pred["ev"]>.002 and pred["pwin"]>=.60 and pred["neff"]>=5 and pred["confidence"]>=.20)
 out.append({"id":x["id"],"strategy":x["strategy"],"entryTs":x["entryTs"],"exitTs":x["_xt"],"symbol":x["symbol"],"side":x["side"],"route":x["route"],
             "pred":pred,"promote":promote,"realizedNet30":x["_net"]})
def met(xs):
 ys=[x["realizedNet30"] for x in xs if x["realizedNet30"] is not None]
 if not ys:return {"n":0}
 gp=sum(y for y in ys if y>0);gl=-sum(y for y in ys if y<0)
 return {"n":len(ys),"wr":sum(y>0 for y in ys)/len(ys),"mean":sum(ys)/len(ys),"sum":sum(ys),"pf":gp/gl if gl else 999.,"worst":min(ys)}
prom=[x for x in out if x["promote"]]
obj={"status":"RESEARCH_ONLY_ROUTE_LOCAL_ONLINE_KNN","productionMutation":False,"selectionUsesCurrentOutcome":False,
     "policy":{"sameRouteSide":True,"minPool":10,"k":12,"halfLifeDays":90,"predEVMin":.002,"pwinMin":.60,"neffMin":5,"confidenceMin":.20},
     "counts":{"scored":len(out),"promoted":len(prom)},"metrics":{"promoted":met(prom)},"byStrategy":{},"promoted":prom}
for s in ("Q102","IDLE","PENGU"):
 z=[x for x in prom if x["strategy"]==s]
 obj["byStrategy"][s]={"metrics":met(z),"routes":dict(collections.Counter(x["route"] for x in z)),"ids":[x["id"] for x in z]}
 print(s,met(z),"ROUTES",collections.Counter(x["route"] for x in z))
 for x in z[:50]:print(" ",x["id"],x["symbol"],x["route"],x["pred"],"REAL",x["realizedNet30"])
p=D/"three_layer_route_local_online_knn_20261114.json";p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("ALL",met(prom),"SHA256",hashlib.sha256(p.read_bytes()).hexdigest())