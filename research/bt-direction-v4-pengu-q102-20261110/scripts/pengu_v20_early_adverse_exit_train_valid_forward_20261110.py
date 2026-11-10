#!/usr/bin/env python3
from pathlib import Path
import json,gzip,statistics,math,hashlib
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
H=3600000
hist=[json.loads(x) for x in (R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109"/"pengu-native-lifecycle-modeled-exits.jsonl").open(encoding="utf8") if x.strip() and json.loads(x)["route"]=="SHORT_V20"]
fwd=[json.loads(x) for x in (R/"FORWARD_HOLDOUT_20261001_20261108"/"PENGU_NATIVE_LIFECYCLE"/"pengu-native-lifecycle-modeled-exits.jsonl").open(encoding="utf8") if x.strip() and json.loads(x)["route"]=="SHORT_V20"]
def loadbars():
 p=R/"aster-public-v3-h1"/"PENGUUSDT-1h-20250924-20261001.jsonl.gz"
 with gzip.open(p,"rt",encoding="utf8") as f:
  return {int(z[0]):float(z[4]) for line in f if line.strip() for z in [json.loads(line)]}
bars=loadbars()
# forward bars live in holdout
pf=R/"FORWARD_HOLDOUT_20261001_20261108"/"aster-h1"/"PENGUUSDT-1h-20261001-20261108T20.jsonl.gz"
if pf.exists():
 with gzip.open(pf,"rt",encoding="utf8") as f:
  for line in f:
   if line.strip():
    z=json.loads(line);bars[int(z[0])]=float(z[4])
def native_net(z,bps):return z["rawReturn"]-bps/10000
def apply(z,h,loss):
 t=int(z["entryTs"]);native_exit=int(z["exitTs"])
 if native_exit<=t+h*H:return z["rawReturn"],False,None
 mark_ts=t+(h-1)*H
 px=bars.get(mark_ts)
 if px is None:return z["rawReturn"],False,"MISSING_H1"
 r=(float(z["entryPrice"])-px)/float(z["entryPrice"])
 if r<=-loss:return r,True,None
 return z["rawReturn"],False,None
def metrics(a,h,loss,bps=30):
 new=[];old=[];trig=helpn=harm=winner_to_loss=0;missing=0
 for z in a:
  nr,hit,err=apply(z,h,loss)
  if err:missing+=1
  nv=nr-bps/10000;ov=native_net(z,bps);new.append(nv);old.append(ov)
  if hit:
   trig+=1
   if nv>ov+1e-15:helpn+=1
   elif nv<ov-1e-15:harm+=1
   if ov>0 and nv<=0:winner_to_loss+=1
 gp=sum(x for x in new if x>0);gl=-sum(x for x in new if x<0)
 ogp=sum(x for x in old if x>0);ogl=-sum(x for x in old if x<0)
 return {"n":len(a),"triggered":trig,"helped":helpn,"harmed":harm,"winnerToLoss":winner_to_loss,"missing":missing,
         "wr":sum(x>0 for x in new)/len(new) if new else None,"mean":sum(new)/len(new) if new else None,
         "sum":sum(new),"pf":gp/gl if gl else None,"worst":min(new) if new else None,
         "nativeWr":sum(x>0 for x in old)/len(old) if old else None,"nativeMean":sum(old)/len(old) if old else None,
         "nativePf":ogp/ogl if ogl else None,"deltaMean":(sum(new)-sum(old))/len(new) if new else None}
hist=sorted(hist,key=lambda z:z["entryTs"]);cut=len(hist)//2;tr=hist[:cut];va=hist[cut:]
grid=[]
for h in [3,6,12,24]:
 for loss in [.01,.02,.03,.04]:
  a=metrics(tr,h,loss,30);b=metrics(va,h,loss,30);c=metrics(fwd,h,loss,30)
  grid.append({"hours":h,"loss":loss,"train30":a,"valid30":b,"forward30":c})
# robust: train improvement, validation and forward no mean degradation, no forward winner converted to loss
rob=[z for z in grid if z["train30"]["deltaMean"]>0 and z["valid30"]["deltaMean"]>=0 and z["forward30"]["deltaMean"]>=0
     and z["valid30"]["winnerToLoss"]==0 and z["forward30"]["winnerToLoss"]==0 and z["valid30"]["triggered"]>0 and z["forward30"]["missing"]==0]
rob=sorted(rob,key=lambda z:(z["valid30"]["deltaMean"],z["forward30"]["deltaMean"],-z["loss"]),reverse=True)
out={"status":"RESEARCH_PENGU_V20_EARLY_ADVERSE_EXIT_GRID","histN":len(hist),"trainN":len(tr),"validN":len(va),"forwardN":len(fwd),
     "grid":grid,"robustN":len(rob),"robust":rob,
     "warning":"Fixed coarse horizons/thresholds. No portfolio scheduling in this stage. H1 close proxy, no extra funding adjustment; integrated replay required."}
p=R/"DIRECTION_RESEARCH_20261109"/"pengu_v20_early_adverse_exit_train_valid_forward_20261110.json"
p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("COUNTS",len(hist),len(tr),len(va),len(fwd),"ROB",len(rob))
for z in rob:print("ROB",json.dumps(z,separators=(',',':')))
print("FILE",p)
