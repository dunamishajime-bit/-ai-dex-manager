#!/usr/bin/env python3
from pathlib import Path
import json,gzip,glob,statistics
R=Path(r"C:\tmp\disdex-bt-20251001-20261001");H=3600000
route="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2"
hist_exit=json.loads((R/"native-new-signal-20251001-20261001"/"native-IDLE-all-intent-modeled-5m-exit-audit.json").read_text(encoding="utf8"))["trades"]
hist=[z for z in hist_exit if z["route"]==route]
fwd=[json.loads(x) for x in (R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl").open(encoding="utf8") if x.strip()]
fwd=[z for z in fwd if z.get("mode")=="NATIVE_SHORT" and z["route"]==route]
bars={}
for p in [R/"aster-public-v3-h1"/"TAOUSDT-1h-20250924-20261001.jsonl.gz",*list((R/"FORWARD_HOLDOUT_20261001_20261108"/"aster-h1").glob("TAOUSDT-1h-*.jsonl.gz"))]:
 if not p.exists():continue
 with gzip.open(p,"rt",encoding="utf8") as f:
  for line in f:
   if line.strip():
    z=json.loads(line);bars[int(z[0])]=float(z[4])
def apply(z,h,loss):
 t=int(z["entryTs"]);e=int(z["exitTs"]);ep=float(z["entryPrice"])
 if e<=t+h*H:return z.get("grossReturn",z.get("rawReturn")),False,None
 px=bars.get(t+(h-1)*H)
 if px is None:return z.get("grossReturn",z.get("rawReturn")),False,"MISSING"
 r=(ep-px)/ep
 if r<=-loss:return r,True,None
 return z.get("grossReturn",z.get("rawReturn")),False,None
def met(a,h,loss,bps=30):
 new=[];old=[];tr=helpn=harm=wtl=miss=0
 for z in a:
  nr,hit,err=apply(z,h,loss);ov=z.get("grossReturn",z.get("rawReturn"))-bps/10000;nv=nr-bps/10000
  old.append(ov);new.append(nv);miss+=bool(err)
  if hit:
   tr+=1;helpn+=nv>ov+1e-15;harm+=nv<ov-1e-15;wtl+=ov>0 and nv<=0
 gp=sum(x for x in new if x>0);gl=-sum(x for x in new if x<0)
 ogp=sum(x for x in old if x>0);ogl=-sum(x for x in old if x<0)
 return {"n":len(a),"triggered":tr,"helped":helpn,"harmed":harm,"winnerToLoss":wtl,"missing":miss,
 "wr":sum(x>0 for x in new)/len(new) if new else None,"mean":sum(new)/len(new) if new else None,
 "pf":gp/gl if gl else None,"worst":min(new) if new else None,
 "nativeMean":sum(old)/len(old) if old else None,"nativePf":ogp/ogl if ogl else None,"deltaMean":(sum(new)-sum(old))/len(new) if new else None}
hist=sorted(hist,key=lambda z:z["entryTs"]);cut=len(hist)//2;tr=hist[:cut];va=hist[cut:]
grid=[]
for h in [3,6,9]:
 for loss in [.01,.02,.03,.04]:
  grid.append({"hours":h,"loss":loss,"train30":met(tr,h,loss),"valid30":met(va,h,loss),"forward30":met(fwd,h,loss)})
rob=[z for z in grid if z["train30"]["deltaMean"]>0 and z["valid30"]["deltaMean"]>=0 and z["forward30"]["deltaMean"]>=0
 and z["valid30"]["triggered"]>0 and z["valid30"]["winnerToLoss"]==0 and z["forward30"]["winnerToLoss"]==0 and z["forward30"]["missing"]==0]
rob=sorted(rob,key=lambda z:(z["valid30"]["deltaMean"],z["forward30"]["deltaMean"]),reverse=True)
out={"status":"RESEARCH_IDLE_TAO_EARLY_ADVERSE_EXIT","histN":len(hist),"trainN":len(tr),"validN":len(va),"forwardN":len(fwd),"grid":grid,"robustN":len(rob),"robust":rob}
p=R/"DIRECTION_RESEARCH_20261109"/"idle_tao_early_adverse_exit_train_valid_forward_20261110.json"
p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("COUNTS",len(hist),len(tr),len(va),len(fwd),"ROB",len(rob))
for z in rob:print("ROB",json.dumps(z,separators=(',',':')))
print("FILE",p)
