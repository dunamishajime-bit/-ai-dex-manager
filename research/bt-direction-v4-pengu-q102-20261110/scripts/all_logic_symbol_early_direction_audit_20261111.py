#!/usr/bin/env python3
from pathlib import Path
import csv,gzip,json,datetime,collections,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
BT=R/"VPS_EFFECTIVE_CURRENT_CANONICAL_CAUSAL_RESEARCH_CAUSAL_THREE_Q102_ADOPTED_ON_20261111"
FILLS=BT/"EFFECTIVE_CURRENT_CANONICAL_CAUSAL_RESEARCH_CAUSAL_THREE_Q102_ADOPTED_ON_10BPS_FILLS.csv"
OUT=R/"DIRECTION_RESEARCH_20261109"/"all_logic_symbol_early_direction_audit_20261111.json"
H=3600000
HORIZONS=(1,3,6,12)

rows=list(csv.DictReader(FILLS.open(encoding="utf-8-sig")))
symbols=sorted({x["symbol"] for x in rows if x["strategy"]!="V52"})
bars={}
sources=collections.defaultdict(list)

def add_file(p):
    if not p.exists(): return
    b=p.read_bytes()
    sources[p.name].append(hashlib.sha256(b).hexdigest())
    with gzip.open(p,"rt",encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            z=json.loads(line)
            t=int(z[0])
            bars.setdefault(p.name.split("-1h-")[0],{})[t]={"o":float(z[1]),"h":float(z[2]),"l":float(z[3]),"c":float(z[4])}

for sym in symbols:
    for d in ("aster-public-v3-h1-early","aster-public-v3-h1","aster-public-v3-h1-q102-warmup"):
        for p in (R/d).glob(sym+"-1h-*.jsonl.gz"):
            add_file(p)

def ts_iso(s):
    return int(datetime.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)

details=[]
for x in rows:
    if x["strategy"]=="V52": continue
    sym=x["symbol"]; bm=bars.get(sym,{})
    t=ts_iso(x["entry_utc"]); ep=float(x["model_entry_price"]); side=x["side"]
    rec={"strategy":x["strategy"],"symbol":sym,"side":side,"route":x["route"],"entryTs":t,"netPnlJpy":float(x["net_pnl_jpy"])}
    for h in HORIZONS:
        bt=t+(h-1)*H
        b=bm.get(bt)
        if not b:
            rec[f"h{h}"]=None
            continue
        px=b["c"]
        signed=(px/ep-1.0) if side=="LONG" else (ep-px)/ep
        rec[f"h{h}"]={"signedReturn":signed,"aligned":signed>0,"adverse1pct":signed<=-0.01,"adverse2pct":signed<=-0.02}
    details.append(rec)

def agg(keyfunc):
    g=collections.defaultdict(list)
    for z in details:g[keyfunc(z)].append(z)
    out=[]
    for k,a in g.items():
        o={"key":list(k) if isinstance(k,tuple) else k,"n":len(a),"netPnlJpy":sum(z["netPnlJpy"] for z in a)}
        for h in HORIZONS:
            v=[z[f"h{h}"] for z in a if z[f"h{h}"] is not None]
            o[f"h{h}Available"]=len(v)
            o[f"h{h}AlignRate"]=sum(q["aligned"] for q in v)/len(v) if v else None
            o[f"h{h}Adverse1Rate"]=sum(q["adverse1pct"] for q in v)/len(v) if v else None
            o[f"h{h}MeanSignedReturn"]=sum(q["signedReturn"] for q in v)/len(v) if v else None
        out.append(o)
    out.sort(key=lambda z:z["netPnlJpy"])
    return out

result={
    "status":"TARGET_YEAR_DIRECTION_DIAGNOSTIC_ONLY_NOT_ADOPTION_EVIDENCE",
    "fillsSource":str(FILLS),
    "fillCount":len(rows),
    "cryptoNonV52Count":len(details),
    "horizonsHours":list(HORIZONS),
    "definition":"Direction aligned when signed return from modeled entry price to H1 close at 1/3/6/12h is positive. Diagnostic only; never tune/adopt on target year alone.",
    "byStrategySymbol":agg(lambda z:(z["strategy"],z["symbol"])),
    "byStrategySymbolRoute":agg(lambda z:(z["strategy"],z["symbol"],z["route"])),
    "details":details,
}
OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("SAVED",OUT)
for z in result["byStrategySymbol"]:
    if z["n"]>=3:
        print(z["key"],"n",z["n"],"net",round(z["netPnlJpy"]),"h3",z["h3AlignRate"],"h6",z["h6AlignRate"],"h12",z["h12AlignRate"])
