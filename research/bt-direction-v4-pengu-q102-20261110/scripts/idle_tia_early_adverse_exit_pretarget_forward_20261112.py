#!/usr/bin/env python3
from pathlib import Path
import json,gzip,datetime as dt,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20250301_20251001"/"IDLE_ALL_BINANCE_PROXY"
CANDS=PRE/"idle-all-preperiod-proxy-candidates-with-m5-exits.jsonl"
H1PRE=PRE/"TIAUSDT-1h-20250301-20251001.jsonl.gz"
FWD=R/"FORWARD_HOLDOUT_20261001_20261108"/"IDLE_DUALSIDE_LIFECYCLE"/"idle-forward-dualside.jsonl"
H1FWD=R/"FORWARD_HOLDOUT_20261001_20261108"/"aster-h1"/"TIAUSDT-1h-20261001-20261108T20.jsonl.gz"
OUT=R/"DIRECTION_RESEARCH_20261109"/"idle_tia_early_adverse_exit_pretarget_forward_20261112.json"
ROUTE="IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100";H=3600000;COST=.003

pre0=[json.loads(x) for x in CANDS.read_text(encoding="utf-8").splitlines() if x.strip()]
pre=[z for z in pre0 if z.get("route")==ROUTE and z.get("symbol")=="TIAUSDT"]
fw0=[json.loads(x) for x in FWD.read_text(encoding="utf-8").splitlines() if x.strip()]
fw=[z for z in fw0 if z.get("route")==ROUTE and z.get("symbol")=="TIAUSDT" and z.get("mode")=="NATIVE_SHORT"]

def load_h1(p):
    out={}
    with gzip.open(p,"rt",encoding="utf-8") as f:
        for line in f:
            if not line.strip():continue
            z=json.loads(line);out[int(z[0])]={"o":float(z[1]),"c":float(z[4])}
    return out
bpre=load_h1(H1PRE);bfwd=load_h1(H1FWD)

T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)
parts={
 "train":[z for z in pre if int(z["entryTs"])<T1],
 "validation":[z for z in pre if T1<=int(z["entryTs"])<T2],
 "prehold":[z for z in pre if int(z["entryTs"])>=T2],
 "forward":fw,
}

def native_ret(z):
    return float(z.get("grossReturn",z.get("rawReturn")))
def apply(z,hours,loss,bars):
    t=int(z["entryTs"]);e=int(z["exitTs"]);ep=float(z["entryPrice"])
    decision=t+hours*H
    if e<=decision:return native_ret(z),False,None
    closed=bars.get(t+(hours-1)*H);fill=bars.get(decision)
    if closed is None or fill is None:return native_ret(z),False,"MISSING"
    signed=(ep-closed["c"])/ep  # SHORT
    if signed<=-loss:
        raw=(ep-fill["o"])/ep
        return raw,True,None
    return native_ret(z),False,None
def met(rows,hours,loss,bars):
    old=[];new=[];tr=helpn=harm=wtl=miss=0
    for z in rows:
        ov=native_ret(z)-COST
        nr,hit,err=apply(z,hours,loss,bars);nv=nr-COST
        old.append(ov);new.append(nv);miss+=bool(err)
        if hit:
            tr+=1;helpn+=nv>ov+1e-15;harm+=nv<ov-1e-15;wtl+=ov>0 and nv<=0
    def stat(v):
        gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
        return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
                "mean":sum(v)/len(v) if v else None,"sum":sum(v),
                "pf":gp/gl if gl else (999.0 if gp>0 else None),"worst":min(v) if v else None}
    o=stat(old);n=stat(new)
    return {"native":o,"early":n,"triggered":tr,"helped":helpn,"harmed":harm,"winnerToLoss":wtl,"missing":miss,
            "deltaMean":(n["mean"]-o["mean"]) if n["mean"] is not None else None}

grid=[]
for h in (3,6,9):
    for loss in (.01,.02,.03,.04):
        rec={"rule":{"hours":h,"loss":loss}}
        for name,a in parts.items():
            rec[name]=met(a,h,loss,bpre if name!="forward" else bfwd)
        # discovery condition only on train
        tr=rec["train"]
        rec["trainQualified"]=(tr["triggered"]>=3 and tr["deltaMean"]>0 and
                               tr["early"]["pf"]>=tr["native"]["pf"] and tr["winnerToLoss"]==0)
        grid.append(rec)

trainq=[z for z in grid if z["trainQualified"]]
rob=[]
for z in trainq:
    ok=True
    for k in ("validation","prehold"):
        q=z[k]
        if q["triggered"]<1 or q["missing"]>0 or q["winnerToLoss"]>0:ok=False
        if q["deltaMean"]<0 or q["early"]["pf"]<q["native"]["pf"]:ok=False
    z["pretargetRobust"]=ok
    if ok:rob.append(z)
# freeze using only pretarget validation+prehold; simpler/lower intervention first if tied
rob.sort(key=lambda z:(min(z["validation"]["deltaMean"],z["prehold"]["deltaMean"]),
                       z["validation"]["deltaMean"]+z["prehold"]["deltaMean"],
                       -z["rule"]["hours"],-z["rule"]["loss"]),reverse=True)
selected=rob[0] if rob else None
forwardPass=False
if selected:
    q=selected["forward"]
    forwardPass=(q["missing"]==0 and q["winnerToLoss"]==0 and q["deltaMean"]>=0 and
                 q["early"]["pf"]>=q["native"]["pf"])
out={"status":"IDLE_TIA_EARLY_ADVERSE_EXIT_PRETARGET_FREEZE_FORWARD_VETO",
     "counts":{k:len(v) for k,v in parts.items()},"gridN":len(grid),"trainQualifiedN":len(trainq),
     "pretargetRobustN":len(rob),"selectedPretargetOnly":selected,"forwardPass":forwardPass,
     "method":"12 fixed rules only. Train discovers; Jul-Aug validation and Sep prehold only falsify. If one survives, true 2026-10..11 Aster forward is veto-only. At decision h, condition uses completed H1 close and exits at next H1 open.",
     "hashes":{"candidates":hashlib.sha256(CANDS.read_bytes()).hexdigest(),"preH1":hashlib.sha256(H1PRE.read_bytes()).hexdigest(),
               "forward":hashlib.sha256(FWD.read_bytes()).hexdigest(),"forwardH1":hashlib.sha256(H1FWD.read_bytes()).hexdigest()}}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("COUNTS",out["counts"],"TRAINQ",len(trainq),"ROB",len(rob),"FWD_PASS",forwardPass)
for z in rob[:8]: print("ROB",json.dumps(z,separators=(",",":")))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
