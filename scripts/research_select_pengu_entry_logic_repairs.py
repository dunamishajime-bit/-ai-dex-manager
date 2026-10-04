import json, math, sys
from pathlib import Path

dev=json.load(open(sys.argv[1],encoding="utf-8"))
val=json.load(open(sys.argv[2],encoding="utf-8"))
out=Path(sys.argv[3])

BASE="S0_CURRENT__L0_CURRENT"

def pf(x):
    v=x.get("profitFactor")
    return 999.0 if v is None and x.get("trades",0)>0 else float(v or 0)

def dd_ok(c,b,tol):
    return c["maxDrawdownPct"] >= b["maxDrawdownPct"]-tol

def total_guard(c,b,ddtol=2.5):
    return (
        c["returnPct"] > b["returnPct"]
        and pf(c) >= pf(b)*0.95
        and dd_ok(c,b,ddtol)
        and c["trades"] >= max(5, math.floor(b["trades"]*0.60))
    )

bn=dev["results"][BASE]["normal"]
bs=dev["results"][BASE]["stress"]

shorts=[]
for key,x in dev["results"].items():
    if not key.endswith("__L0_CURRENT") or key==BASE: continue
    n=x["normal"]; s=x["stress"]
    route=n["short"]; base_route=bn["short"]
    keep=route["trades"] >= max(3, math.floor(base_route["trades"]*0.50))
    route_improves=(route["hardStops"] < base_route["hardStops"] or pf(route) >= pf(base_route)*1.10)
    qualifies=total_guard(n["total"],bn["total"]) and total_guard(s["total"],bs["total"],3.0) and keep and route_improves and route["hardStops"]<=base_route["hardStops"] and pf(route)>=pf(base_route)
    shorts.append({
      "key":key,"name":x["shortSpec"]["name"],"qualifies":qualifies,
      "hardStopReduction":base_route["hardStops"]-route["hardStops"],
      "routePf":pf(route),"normalReturnDelta":n["total"]["returnPct"]-bn["total"]["returnPct"],
      "stressReturnDelta":s["total"]["returnPct"]-bs["total"]["returnPct"],
      "normal":n,"stress":s
    })
shorts.sort(key=lambda z:(z["qualifies"],z["hardStopReduction"],z["routePf"],z["normalReturnDelta"]+z["stressReturnDelta"]),reverse=True)
selected_short=next((x for x in shorts if x["qualifies"]),None)

longs=[]
for key,x in dev["results"].items():
    if not key.startswith("S0_CURRENT__") or key==BASE: continue
    n=x["normal"]; s=x["stress"]
    route=n["long"]; base_route=bn["long"]
    keep=route["trades"] >= max(3, math.floor(base_route["trades"]*0.50))
    route_improves=(route["hardStops"] < base_route["hardStops"] or pf(route) >= pf(base_route)*1.10)
    qualifies=total_guard(n["total"],bn["total"]) and total_guard(s["total"],bs["total"],3.0) and keep and route_improves and route["hardStops"]<=base_route["hardStops"] and pf(route)>=pf(base_route)
    longs.append({
      "key":key,"name":x["longSpec"]["name"],"qualifies":qualifies,
      "hardStopReduction":base_route["hardStops"]-route["hardStops"],
      "routePf":pf(route),"normalReturnDelta":n["total"]["returnPct"]-bn["total"]["returnPct"],
      "stressReturnDelta":s["total"]["returnPct"]-bs["total"]["returnPct"],
      "normal":n,"stress":s
    })
longs.sort(key=lambda z:(z["qualifies"],z["hardStopReduction"],z["routePf"],z["normalReturnDelta"]+z["stressReturnDelta"]),reverse=True)
selected_long=next((x for x in longs if x["qualifies"]),None)

short_name=selected_short["name"] if selected_short else "S0_CURRENT"
long_name=selected_long["name"] if selected_long else "L0_CURRENT"
combined_key=f"{short_name}__{long_name}"
combined_dev=dev["results"][combined_key]
combined_val=val["results"][combined_key]
val_base=val["results"][BASE]

def delta(block,base):
    return {
      "returnPct":block["total"]["returnPct"]-base["total"]["returnPct"],
      "profitFactor":pf(block["total"])-pf(base["total"]),
      "maxDrawdownPct":block["total"]["maxDrawdownPct"]-base["total"]["maxDrawdownPct"],
      "winRatePct":(block["total"]["winRatePct"] or 0)-(base["total"]["winRatePct"] or 0),
      "trades":block["total"]["trades"]-base["total"]["trades"],
      "hardStops":block["total"]["hardStops"]-base["total"]["hardStops"],
    }

def validation_guard(c,b):
    return (
      c["total"]["returnPct"] >= b["total"]["returnPct"]
      and pf(c["total"]) >= pf(b["total"])*0.95
      and c["total"]["maxDrawdownPct"] >= b["total"]["maxDrawdownPct"]-1.5
    )

result={
  "schema":"pengu-entry-logic-repair-selection/v1",
  "selectionPolicy":{
    "selectionSource":"OKX historical development only",
    "validationSource":"Aster 2025-08-10..2026-08-10 untouched by selection",
    "shortRequirements":"overall Normal+Stress return improve, PF >=95% baseline, DD degradation <=2.5/3pp, >=50% short trades retained, short PF non-worse and hard stops non-increasing, with hard-stop/PF improvement required",
    "longRequirements":"same framework; base Long remains unchanged and only supplemental Long gate changes",
    "ranking":"risk-first: hard-stop reduction, route PF, then Normal+Stress return delta",
  },
  "development":{
    "period":dev["period"],"baseline":dev["results"][BASE],
    "shortCandidates":shorts,"longCandidates":longs,
    "selectedShort":selected_short,"selectedLong":selected_long,
    "combinedKey":combined_key,"combined":combined_dev,
    "combinedDeltaNormal":delta(combined_dev["normal"],bn),
    "combinedDeltaStress":delta(combined_dev["stress"],bs),
  },
  "validation":{
    "period":val["period"],"baseline":val_base,"combinedKey":combined_key,"combined":combined_val,
    "deltaNormal":delta(combined_val["normal"],val_base["normal"]),
    "deltaStress":delta(combined_val["stress"],val_base["stress"]),
    "normalPass":validation_guard(combined_val["normal"],val_base["normal"]),
    "stressPass":validation_guard(combined_val["stress"],val_base["stress"]),
  },
  "promotionCandidate":bool(selected_short or selected_long) and validation_guard(combined_val["normal"],val_base["normal"]) and validation_guard(combined_val["stress"],val_base["stress"]),
  "safety":{"researchOnly":True,"ordersSent":False,"liveChanged":False,"vpsChanged":False,"productionChanged":False},
}
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
print("PENGU_REPAIR_SELECTION="+json.dumps({
  "selectedShort":short_name,"selectedLong":long_name,"combinedKey":combined_key,
  "developmentNormalDelta":result["development"]["combinedDeltaNormal"],
  "validationNormalDelta":result["validation"]["deltaNormal"],
  "validationStressDelta":result["validation"]["deltaStress"],
  "promotionCandidate":result["promotionCandidate"]
},separators=(",",":")))
