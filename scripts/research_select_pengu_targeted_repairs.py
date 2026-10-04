import json, sys, math
from pathlib import Path

D=json.load(open(sys.argv[1],encoding="utf-8"))
V=json.load(open(sys.argv[2],encoding="utf-8"))
F=json.load(open(sys.argv[3],encoding="utf-8"))
OUT=Path(sys.argv[4])

CURRENT="S0_CURRENT__L0_CURRENT"
LONG_FIXED="L5_SUPP_GE0_BREAKOUT_1P00"
SHORTS=[
 "S0_CURRENT",
 "S7_COUNTERWIND_REBREAK_2PCT",
 "S8_COUNTERWIND_REBREAK_1PCT",
 "S9_BTC_EMA_POS_REBREAK_2PCT",
 "S10_BTC_EMA_POS_BTC24_NEG_REBREAK_2PCT",
 "S11_BTC_EMA_POS_BTC24_NEG_REBREAK_1PCT",
]

def pf(x):
    p=x.get("profitFactor")
    return 999.0 if p is None and x.get("trades",0)>0 else float(p or 0)

def block(src,key,mode):
    return src["results"][key][mode]

def safe_candidate(name):
    key=f"{name}__{LONG_FIXED}"
    bkey=f"S0_CURRENT__{LONG_FIXED}"
    checks=[]
    hard_reduction=0
    return_delta=0.0
    pf_gain=0.0
    for src in (D,V):
        for mode in ("normal","stress"):
            c=block(src,key,mode); b=block(src,bkey,mode)
            checks += [
              c["total"]["returnPct"] >= b["total"]["returnPct"]-2.0,
              pf(c["total"]) >= pf(b["total"])*0.98,
              c["total"]["maxDrawdownPct"] >= b["total"]["maxDrawdownPct"]-0.5,
              c["short"]["hardStops"] <= b["short"]["hardStops"],
              c["short"]["trades"] >= max(1,b["short"]["trades"]-2),
              pf(c["short"]) >= pf(b["short"])*0.95,
            ]
            hard_reduction += b["short"]["hardStops"]-c["short"]["hardStops"]
            return_delta += c["total"]["returnPct"]-b["total"]["returnPct"]
            pf_gain += pf(c["short"])-pf(b["short"])
    return {
      "name":name,"key":key,"qualifies":all(checks),
      "hardStopReduction":hard_reduction,"returnDeltaSum":return_delta,"shortPfGainSum":pf_gain,
      "developmentNormal":block(D,key,"normal"),"validationNormal":block(V,key,"normal"),
    }

cands=[safe_candidate(x) for x in SHORTS if x!="S0_CURRENT"]
qualified=[x for x in cands if x["qualifies"]]
qualified.sort(key=lambda x:(x["hardStopReduction"],x["returnDeltaSum"],x["shortPfGainSum"]),reverse=True)
selected=qualified[0]["name"] if qualified else "S0_CURRENT"
selected_key=f"{selected}__{LONG_FIXED}"

def delta(c,b):
    return {
      "returnPct":c["total"]["returnPct"]-b["total"]["returnPct"],
      "profitFactor":pf(c["total"])-pf(b["total"]),
      "maxDrawdownPct":c["total"]["maxDrawdownPct"]-b["total"]["maxDrawdownPct"],
      "winRatePct":(c["total"]["winRatePct"] or 0)-(b["total"]["winRatePct"] or 0),
      "trades":c["total"]["trades"]-b["total"]["trades"],
      "hardStops":c["total"]["hardStops"]-b["total"]["hardStops"],
    }

def package(src):
    current=src["results"][CURRENT]
    longfix=src["results"][f"S0_CURRENT__{LONG_FIXED}"]
    combined=src["results"][selected_key]
    return {
      "current":current,
      "longFix":longfix,
      "combined":combined,
      "longFixDeltaNormal":delta(longfix["normal"],current["normal"]),
      "longFixDeltaStress":delta(longfix["stress"],current["stress"]),
      "combinedDeltaNormal":delta(combined["normal"],current["normal"]),
      "combinedDeltaStress":delta(combined["stress"],current["stress"]),
    }

result={
 "schema":"pengu-targeted-entry-repair-selection/v1",
 "frozenLong":{
   "name":LONG_FIXED,
   "rule":"Base Long unchanged. V64 supplemental Long requires PENGU 72h return >=0% and breakout/ATR score >=1.00.",
   "basis":"Chosen as cross-period exploratory survivor after the first repair matrix; forward period below was not inspected before freezing."
 },
 "shortSelection":{
   "sourcePeriods":[D["period"],V["period"]],
   "ruleFamily":"Only when BTC context indicates the specified counterwind state, require close to return within 1-2% of the armed impulse/setup low before SHORT_V20 entry; all other shorts remain current behavior.",
   "requirements":"Across OKX development and Aster validation, Normal+Stress total return may not fall >2pp per block, total PF >=98%, DD no worse >0.5pp, short hard stops non-increasing, <=2 short trades removed, short PF >=95%.",
   "candidates":cands,
   "selected":selected,
   "selectedKey":selected_key,
 },
 "development":package(D),
 "validation":package(V),
 "forward":package(F),
 "forwardPeriod":F["period"],
 "currentTradeCheck":{
   "signalReference":"2026-10-03T03:00:00Z",
   "setupLowApprox":0.008656,
   "signalClose":0.008944,
   "distanceAboveSetupLowPct":(0.008944/0.008656-1)*100,
   "btcEma168DistancePct":0.4482090547115458,
   "btc24Pct":-0.6981091751156132,
   "note":"A 2% structural re-break requirement under BTC_EMA_POS_BTC24_NEG would block this signal because close remained about 3.33% above the armed setup low."
 },
 "safety":{"researchOnly":True,"ordersSent":False,"liveChanged":False,"vpsChanged":False,"productionChanged":False},
}
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
print("PENGU_TARGETED_SELECTION="+json.dumps({
 "selectedShort":selected,
 "longFix":LONG_FIXED,
 "forwardPeriod":result["forwardPeriod"],
 "forwardCurrentNormal":result["forward"]["current"]["normal"]["total"],
 "forwardLongFixNormal":result["forward"]["longFix"]["normal"]["total"],
 "forwardCombinedNormal":result["forward"]["combined"]["normal"]["total"],
 "forwardCombinedDeltaNormal":result["forward"]["combinedDeltaNormal"],
 "forwardCombinedDeltaStress":result["forward"]["combinedDeltaStress"],
 "currentTradeBlockedBySelected": selected in ("S10_BTC_EMA_POS_BTC24_NEG_REBREAK_2PCT","S11_BTC_EMA_POS_BTC24_NEG_REBREAK_1PCT","S9_BTC_EMA_POS_REBREAK_2PCT","S7_COUNTERWIND_REBREAK_2PCT","S8_COUNTERWIND_REBREAK_1PCT"),
},separators=(",",":")))
