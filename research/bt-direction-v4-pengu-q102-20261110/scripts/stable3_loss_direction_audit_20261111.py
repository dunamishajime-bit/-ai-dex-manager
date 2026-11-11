#!/usr/bin/env python3
from pathlib import Path
import csv,gzip,json,datetime,collections,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
BT=R/"VPS_EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON_20261111"
FILLS=BT/"EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON_10BPS_FILLS.csv"
OUT=R/"DIRECTION_RESEARCH_20261109"/"stable3_loss_direction_audit_20261111.json"
H=3600000
HORIZONS=(3,6,12)

rows=list(csv.DictReader(FILLS.open(encoding="utf-8-sig")))
symbols=sorted({x["symbol"] for x in rows if x["strategy"]!="V52"})
bars={}
source_hashes={}

def add_file(p):
    if not p.exists(): return
    source_hashes[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
    with gzip.open(p,"rt",encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            z=json.loads(line);t=int(z[0])
            bars.setdefault(p.name.split("-1h-")[0],{})[t]={"o":float(z[1]),"h":float(z[2]),"l":float(z[3]),"c":float(z[4])}

for sym in symbols:
    for d in ("aster-public-v3-h1-early","aster-public-v3-h1","aster-public-v3-h1-q102-warmup"):
        for p in (R/d).glob(sym+"-1h-*.jsonl.gz"):
            add_file(p)

def ts_iso(s):
    return int(datetime.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)

details=[]
for x in rows:
    pnl=float(x["net_pnl_jpy"])
    rec={"strategy":x["strategy"],"symbol":x["symbol"],"side":x["side"],"route":x["route"],
         "entryTs":ts_iso(x["entry_utc"]),"netPnlJpy":pnl,"loss":pnl<0}
    if x["strategy"]!="V52":
        bm=bars.get(x["symbol"],{});ep=float(x["model_entry_price"]);t=rec["entryTs"];side=x["side"]
        for h in HORIZONS:
            # Entry timestamps are at bar open; h-hour close is the H1 bar ending h hours later.
            bt=t+(h-1)*H
            b=bm.get(bt)
            if b is None: rec[f"h{h}"]=None;continue
            px=b["c"]
            sr=(px/ep-1.0) if side=="LONG" else (ep-px)/ep
            rec[f"h{h}"]={"signedReturn":sr,"aligned":sr>0}
        vals=[rec.get(f"h{h}") for h in HORIZONS]
        rec["persistentWrong3_6_12"]=bool(all(v is not None and not v["aligned"] for v in vals))
    details.append(rec)

total_gross_loss=-sum(z["netPnlJpy"] for z in details if z["loss"])

def agg(keyfn):
    g=collections.defaultdict(list)
    for z in details:g[keyfn(z)].append(z)
    out=[]
    for k,a in g.items():
        losses=[z for z in a if z["loss"]]
        gl=-sum(z["netPnlJpy"] for z in losses)
        o={"key":list(k) if isinstance(k,tuple) else k,"n":len(a),"lossN":len(losses),
           "lossRate":len(losses)/len(a),"netPnlJpy":sum(z["netPnlJpy"] for z in a),
           "grossLossJpy":gl,"grossLossShare":gl/total_gross_loss if total_gross_loss else 0}
        for h in HORIZONS:
            lv=[z[f"h{h}"] for z in losses if z.get(f"h{h}") is not None]
            o[f"lossH{h}Available"]=len(lv)
            o[f"lossH{h}WrongRate"]=sum(not v["aligned"] for v in lv)/len(lv) if lv else None
            o[f"lossH{h}MeanSignedReturn"]=sum(v["signedReturn"] for v in lv)/len(lv) if lv else None
        pv=[z for z in losses if z.get("persistentWrong3_6_12") is not None]
        o["persistentWrongAvailable"]=len(pv)
        o["persistentWrongRate"]=sum(z.get("persistentWrong3_6_12",False) for z in pv)/len(pv) if pv else None
        out.append(o)
    out.sort(key=lambda z:(-z["grossLossShare"],-z["lossRate"]))
    return out

result={
 "status":"STABLE3_TARGET_YEAR_LOSS_DIRECTION_DIAGNOSTIC_ONLY",
 "warning":"Loss percentages and H3/H6/H12 wrong-direction rates only prioritize research. They MUST NOT define target-fitted gates. Any improvement must be frozen from independent pretarget evidence and then falsified forward.",
 "fillsSource":str(FILLS),
 "fillCount":len(rows),
 "lossCount":sum(z["loss"] for z in details),
 "lossRate":sum(z["loss"] for z in details)/len(details),
 "grossLossJpy":total_gross_loss,
 "byStrategy":agg(lambda z:(z["strategy"],)),
 "byStrategySymbol":agg(lambda z:(z["strategy"],z["symbol"])),
 "byStrategySymbolRouteSide":agg(lambda z:(z["strategy"],z["symbol"],z["route"],z["side"])),
 "sourceHashes":source_hashes
}
OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("FILLS",result["fillCount"],"LOSSES",result["lossCount"],"LOSS_RATE",result["lossRate"])
print("TOP STRATEGY_SYMBOL")
for z in result["byStrategySymbol"][:24]:
    print(json.dumps(z,ensure_ascii=False,separators=(",",":")))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
