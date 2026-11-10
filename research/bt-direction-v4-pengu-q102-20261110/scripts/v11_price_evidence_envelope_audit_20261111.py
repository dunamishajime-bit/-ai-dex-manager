#!/usr/bin/env python3
from pathlib import Path
import json,gzip,csv,math,datetime as dt,hashlib
from zoneinfo import ZoneInfo

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
A=R/"V11_ASTER_5M_FULLPERIOD_20261111"
Y=R/"yahoo-public-stock-h1"
O=R/"V11_PRICE_EVIDENCE_ENVELOPE_20261111"
O.mkdir(exist_ok=True)
SYMS=["AMZN","META","MSFT","NVDA","TSLA"]
NY=ZoneInfo("America/New_York")
UTC=dt.timezone.utc

aster={s:{} for s in SYMS}
for s in SYMS:
    p=A/f"{s}USDT-5m-20251001-20261001.jsonl.gz"
    with gzip.open(p,"rt",encoding="utf8") as f:
        for line in f:
            z=json.loads(line)
            close_ms=int(z[6])
            close_dt=dt.datetime.fromtimestamp((close_ms+1)/1000,UTC).astimezone(NY)
            aster[s][(close_dt.date().isoformat(),close_dt.strftime("%H:%M"))]=float(z[4])

y930={s:{} for s in SYMS}
for s in SYMS:
    rows=json.load((Y/f"{s}-Yahoo-H1-20251001-20261001.json").open(encoding="utf8"))
    for z in rows:
        t=dt.datetime.fromtimestamp(int(z["tsSeconds"]),UTC).astimezone(NY)
        if t.hour==9 and t.minute==30:
            y930[s][t.date().isoformat()]=z

dates=sorted(set.intersection(*(set(y930[s]) for s in SYMS)))
rows=[]

def basis(p,r):
    return (p/r-1.0)*10000.0

def abs_interval(p,lo,hi):
    b1=basis(p,lo); b2=basis(p,hi)
    mx=max(abs(b1),abs(b2))
    mn=0.0 if lo<=p<=hi else min(abs(b1),abs(b2))
    return mn,mx,b1,b2

for d in dates:
    if not all((d,"10:00") in aster[s] and (d,"10:30") in aster[s] for s in SYMS):
        continue
    sig={};cur={};valid=True
    for s in SYMS:
        yz=y930[s][d]
        lo=float(yz["low"]); hi=float(yz["high"]); cl=float(yz["close"])
        if not all(math.isfinite(x) and x>0 for x in (lo,hi,cl)):
            valid=False;break
        ps=aster[s][(d,"10:00")];pc=aster[s][(d,"10:30")]
        mn,mx,blo,bhi=abs_interval(ps,lo,hi)
        sig[s]={"minAbs":mn,"maxAbs":mx,"basisAtLow":blo,"basisAtHigh":bhi,
                "aster1000":ps,"refLow":lo,"refHigh":hi}
        cb=basis(pc,cl)
        cur[s]={"basis":cb,"abs":abs(cb),"aster1030":pc,"refClose1030":cl}
    if not valid: continue
    current_top=sorted(SYMS,key=lambda s:(-cur[s]["abs"],s))[0]
    s=current_top;other=[x for x in SYMS if x!=s]
    possible_selected=sig[s]["maxAbs"] >= max(sig[x]["minAbs"] for x in other)-1e-12
    guaranteed_selected=sig[s]["minAbs"] > max(sig[x]["maxAbs"] for x in other)+1e-12
    current_abs=cur[s]["abs"]
    possible_adverse=(current_abs-sig[s]["maxAbs"]) <= 10.0+1e-12
    guaranteed_adverse=(current_abs-sig[s]["minAbs"]) <= 10.0+1e-12
    basis_pass=current_abs>=50.0-1e-12
    min_cost=11.0
    cost_possible=(min_cost<=60 and min_cost/current_abs<=0.75 and current_abs-15-min_cost>=10) if current_abs>0 else False
    possible_price_candidate=possible_selected and possible_adverse and basis_pass and cost_possible
    robust_price_candidate=guaranteed_selected and guaranteed_adverse and basis_pass and cost_possible
    rows.append({
        "date":d,"currentTop1":s,"currentBasisBps":cur[s]["basis"],"currentAbsBasisBps":current_abs,
        "signalMinAbsBasisBps":sig[s]["minAbs"],"signalMaxAbsBasisBps":sig[s]["maxAbs"],
        "possibleSelectedAt1000":possible_selected,"guaranteedSelectedAt1000":guaranteed_selected,
        "possibleAdverseBasisPass":possible_adverse,"guaranteedAdverseBasisPass":guaranteed_adverse,
        "basis50Pass":basis_pass,"minimumCostEconomicPass":cost_possible,
        "possiblePriceCandidate":possible_price_candidate,"robustPriceCandidate":robust_price_candidate,
        "aster1000":sig[s]["aster1000"],"aster1030":cur[s]["aster1030"],
        "ref930BarLow":sig[s]["refLow"],"ref930BarHigh":sig[s]["refHigh"],"ref1030Close":cur[s]["refClose1030"],
    })

csvp=O/"v11-price-evidence-envelope.csv"
with csvp.open("w",newline="",encoding="utf8") as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys()));w.writeheader();w.writerows(rows)

overlap=[z for z in rows if "2026-09-07"<=z["date"]<="2026-09-30"]
summary={
 "status":"V11_PRICE_EVIDENCE_ENVELOPE_NOT_BOOK_PARITY",
 "method":"10:00 true reference conservatively bounded by full 09:30-10:30 Yahoo H1 low/high; this is a superset, not a point lookahead. 10:30 uses completed Yahoo H1 close. Aster uses completed 5m close.",
 "days":len(rows),
 "possiblePriceCandidateDays":sum(z["possiblePriceCandidate"] for z in rows),
 "robustPriceCandidateDays":sum(z["robustPriceCandidate"] for z in rows),
 "basis50Days":sum(z["basis50Pass"] for z in rows),
 "btOverlapLiveEvidenceWindow":{"start":"2026-09-07","end":"2026-09-30"},
 "btOverlapEnvelopeDays":len(overlap),
 "btOverlapPossiblePriceCandidateDays":sum(z["possiblePriceCandidate"] for z in overlap),
 "btOverlapRobustPriceCandidateDays":sum(z["robustPriceCandidate"] for z in overlap),
 "actualLiveEvidenceBtOverlap":{"v11Decisions":25,"candidateNonNull":0,"positionOpen":0},
 "actualLiveEvidenceOutsideBt":{"date":"2026-11-09","candidateNonNull":1,"positionOpen":0,"symbol":"TSLA","basisBps":74.60106382978671},
 "unmodeledLiveGates":["dataAge5s","sourceClockDiff1500ms","spread<=20bps","30sSpreadHistory>=5","spread/median<=2","depth>=2x","adverse2s<=5bps","postOnlyFill>=90%"],
 "fixedMinimumRoundTripCostBps":11.0,
 "classification":"V11 cannot be certified for the full year; fail-closed omission matches the only overlapping live evidence window but is not proof for unobserved months."
}
sp=O/"SUMMARY.json"
sp.write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print(json.dumps(summary,indent=2,ensure_ascii=False))
print("CSV_SHA256",hashlib.sha256(csvp.read_bytes()).hexdigest())
print("SUMMARY_SHA256",hashlib.sha256(sp.read_bytes()).hexdigest())
