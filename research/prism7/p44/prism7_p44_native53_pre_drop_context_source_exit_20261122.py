#!/usr/bin/env python3
"""P44: Observed original pinned Native V20 53 exits, pre-downleg asof regime.
No source native entry/exit modifications. Tests prior H1 threefold
BTC-bear, relative weakness, bearish EMA at first -3/-5/-7 downcross.
Subset results are retrospective, not full LIVE V20 reproduction.
Single-slot audit preserves chronological Native source intents and overlaps.
Cross-window 24/48/72h sensitivity; 10/30bps, cover +0/+100bps.
"""
from __future__ import annotations
import gzip,json,hashlib,math,statistics
from pathlib import Path
from collections import defaultdict,Counter
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,GROSS,FEES,COVER_SLIPS
H=3600000
M5=300000
CROSSES=(3,5,7)
WINDOWS=(24,48,72)
P42=R/"PRISM7_P42_PREQUALIFIED_DOWNCROSS_ALL_CANDIDATES_20261122.jsonl.gz"
OUT=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
MD=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.md"
LEDGER=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_ALL53_LEDGER_20261122.jsonl"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rnd(x,d=5):return round(float(x),d)
def minfo(raw,threshold,window):
    pre=[z for z in raw if z["thresholdPct"]==threshold]
    matched=[]
    for x in source:
      prev=[z for z in pre if 0<x["entryTs"]-z["intentTs"]<=window*H]
      trigger=prev[-1] if prev else None
      flags=trigger["prior"]["flags"] if trigger else None
      okay=bool(flags and all(flags[k] for k in ("btcBear","relativeWeak","emaBear")))
      matched.append({"key":x["period"]+"|"+x["id"]+"|"+str(x["entryTs"]),
        "period":x["period"],"id":x["id"],"entryTs":x["entryTs"],"entryPrice":x["entryPrice"],
        "exitTs":x["exitTs"],"exitPrice":x["exitPrice"],
        "sourceExitReason":x["exitReason"],"sourceNativeNet30Pct":x["net30pct"],
        "earlierTriggerFound":trigger is not None,"earlierTriggerTs":trigger["intentTs"] if trigger else None,
        "precondition":flags,"all3":okay,
        "sourceEntryExitUntouched":True})
    return matched
def source_slot(rows):
    slot=[];busy=-1;skipped=[]
    for x in sorted(rows,key=lambda z:(z["entryTs"],z["key"])):
        if x["entryTs"]<busy:
            skipped.append(x["key"]);continue
        slot.append(x)
        busy=x["exitTs"]+M5
    return slot,skipped
def economy(rows,m5,fee,slip):
    nav=10000.;peak=nav;realpeak=nav;maxDD=0.;highDD=0.;realDD=0.
    completed=[];prior_time=-1
    for x in rows:
      if x["entryTs"]<prior_time:raise ValueError("P44_OVERLAPPING_SLOT")
      origCash=nav;entry=x["entryPrice"];end=x["exitTs"]
      if end>=1794960000000:
        raise ValueError("P44_NATIVE_EXIT_AFTER_SAMPLE_END")
      current=entry
      nbar=0
      for t in range(x["entryTs"],end+1,M5):
        candle=m5.get(t)
        if candle is None:raise ValueError("P44_M5_MISSING:"+str(t))
        printed=float(candle[5])>0
        if printed:current=float(candle[4])
        if t<end:
          if printed:
            mNavHigh=origCash*(1+GROSS*((entry-float(candle[2]))/entry-fee/10000))
            highDD=max(highDD,100*(1-mNavHigh/peak))
          mNav=origCash*(1+GROSS*((entry-current)/entry-fee/10000))
        else:
          price=float(x["exitPrice"])*(1+slip/10000)
          mNav=origCash*(1+GROSS*((entry-price)/entry-fee/10000))
        peak=max(peak,mNav)
        maxDD=max(maxDD,100*(1-mNav/peak))
        nav=mNav
        nbar+=1
      price=float(x["exitPrice"])*(1+slip/10000)
      gain=100*GROSS*((entry-price)/entry-fee/10000)
      if t!=end or abs(nav-origCash*(1+gain/100))>1e-5:
         raise ValueError("P44_NATIVE_EXIT_PARITY_FAIL")
      completed.append({**x,"gross075NetEquityPct":rnd(gain)})
      if nav>realpeak:realpeak=nav
      realDD=max(realDD,100*(1-nav/realpeak))
      prior_time=end+M5
    profits=[x["gross075NetEquityPct"] for x in completed]
    wins=sum(z>0 for z in profits)
    profit=sum(z for z in profits if z>0)
    loss=-sum(z for z in profits if z<0)
    coh={}
    for k in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV"):
        sub=[z for z in completed if z["period"]==k]
        coh[k]={"closed":len(sub),"wins":sum(z["gross075NetEquityPct"]>0 for z in sub),
         "sourceGrossSumEquityPoints":rnd(sum(z["gross075NetEquityPct"] for z in sub))}
    return {
      "singleSlotPositions":len(completed),"wins":wins,
      "conditionalWinPct":rnd(100*wins/len(completed)) if completed else None,
      "conditionalPF":rnd(profit/loss) if loss else None,
      "meanEntryEquityReturnPct":rnd(sum(profits)/len(profits)) if profits else None,
      "finalNAVYen":rnd(nav,2),"M5CloseMarkedDDPct":rnd(maxDD),
      "M5HighStressMarkedDDPct":rnd(max(maxDD,highDD)),
      "sourceRealizedOnlyDDPct":rnd(realDD),
      "cohorts":coh,
      "independentlyOverlapCorrectedInSimpleSingleSlot":True,
      "venueSignedFillProven":False}
def main():
 global source
 source=json.loads(SOURCE.read_text(encoding="utf8"))
 assert len(source)==53 and sum(x["net30pct"]>0 for x in source)==29
 for x in source:
    assert x["parity"]=="EXACT"
    ref=100*(1-float(x["exitPrice"])/float(x["entryPrice"]))-.3
    assert abs(ref-float(x["net30pct"]))<1e-7
 with gzip.open(P42,"rt",encoding="utf8") as f:
    cross=[json.loads(s) for s in f if s.strip()]
 assert len(cross)==896 and {x["thresholdPct"] for x in cross}==set(CROSSES)
 m5,m5hash=load_m5(SOURCES)
 cases=[]
 baseline=[]
 for x in source:
    baseline.append({"key":x["period"]+"|"+x["id"]+"|"+str(x["entryTs"]),
        "period":x["period"],"id":x["id"],"entryTs":x["entryTs"],"entryPrice":x["entryPrice"],
        "exitTs":x["exitTs"],"exitPrice":x["exitPrice"],
        "sourceExitReason":x["exitReason"],"sourceNativeNet30Pct":x["net30pct"],
        "earlierTriggerFound":False,"all3":True,"sourceEntryExitUntouched":True})
 origslot,originalSkipped=source_slot(baseline)
 for fee in FEES:
  for slip in COVER_SLIPS:
    all_e=economy(origslot,m5,fee,slip)
    cases.append({"thresholdPct":None,"hours":None,"feeBps":fee,"extraBuyCoverSlipBps":slip,
       "originalNative53Intents":53,"matchedSourceNative":53,"sourceWins":29,
       "sourceWinratePct":rnd(100*29/53),
       "sourceGrossSum075EquityPointsAt30bps":rnd(sum(x["net30pct"]*GROSS for x in source)),
       "sourceOverlapBlocked":len(originalSkipped),
       "economics":all_e})
 detailed={}
 for th in CROSSES:
  for w in WINDOWS:
    observed=minfo(cross,th,w)
    kept=[z for z in observed if z["all3"]]
    k=sum(z["sourceNativeNet30Pct"]>0 for z in kept)
    slot,skipped=source_slot(kept)
    if th==3 and w==48:
        assert len(kept)==21 and k==19
        original_cohort=Counter(x["period"] for x in kept)
        assert original_cohort==Counter({"BASE_2025_2026":17,"PRE_2025_AUG_SEP":3,"POST_2026_OCT_NOV":1})
        detailed={"model":"D3_48H_PRE_ALL3","all53Matched":observed,
            "keptSourceNativeKeys":[z["key"] for z in kept],
            "sourceOverlapSkippedKeys":skipped,
            "sourceOnlyPretend53WinrateNotPortfolio":rnd(100*k/len(kept))}
    for fee in FEES:
      for slip in COVER_SLIPS:
        stats=economy(slot,m5,fee,slip)
        cases.append({
            "thresholdPct":th,"hours":w,"feeBps":fee,"extraBuyCoverSlipBps":slip,
            "originalNative53Intents":53,"matchedSourceNative":len(kept),
            "sourceWins":k,
            "sourceWinratePct":rnd(100*k/len(kept)) if kept else None,
            "sourceGrossSum075EquityPointsAt30bps":rnd(sum(z["sourceNativeNet30Pct"]*GROSS for z in kept)),
            "sourceOverlapBlocked":len(skipped),
            "economics":stats,
            "allPriorContextAsOfOriginalNativeEntry":True,
            "nativeSourceEntryExitPricesUntouched":True,
        })
 assert len(cases)==4+len(CROSSES)*len(WINDOWS)*len(FEES)*len(COVER_SLIPS)
 normal=[x for x in cases if x["feeBps"]==30 and x["extraBuyCoverSlipBps"]==0]
    # All criteria apply ONLY before the original V20 native entry; this is a
    # contextual filter, NOT first-downleg execution.
 baseline1=next(x for x in normal if x["thresholdPct"] is None)
 report={
   "schema":"prism7-p44-observed-native53-pre-3pct-first-downleg-context-filter-source-exits/v1",
   "status":"RESEARCH_ONLY_HINDSIGHT_SELECTION_ON_VIEWED_PRE_BASE_POST",
   "sourceOriginalNative53Wins29StillUntouched":True,
   "sourceNative53ExitNet30Parity53Of53":True,
   "targetModelD3Prior48hAll3NativeSourceWins":"19/21",
   "targetNativeSourcePeriodCounts":{"PRE":"1/3 wins","BASE":"17/17 wins","POST":"1/1 wins"},
   "highRiskOfInSampleOverfit":True,
   "sourceFullNativeV20TimeSeriesExecutionProven":False,
   "scenariosCount":len(cases),"modelGrid":cases,
   "normal30bpsNoExtraCoverSlip":normal,
   "native53OriginalOverlapSingleSlotReference":baseline1,
   "original53SingleSlotWithoutSourceOOSCapital":"NOT_CERTIFIED_PRODUCTION",
   "targetDetailed53":detailed,
   "tradeSourceSHA256":sha(SOURCE),"crossingP42SHA256":sha(P42),
   "penguM5SHA256":m5hash,
   "strictTimeCondition":"last D3/D5/D7 crossing entry intent is strictly earlier than native entry; prior signal values from H1 preceding crossing",
   "gross":GROSS,
   "limitations":[
      "The source set is prior-inspected Native53 and PRE/BASE/POST are NOT independent untouched periods.",
      "Choosing 3% from the many examined threshold/grid candidates can be overfit, even if preconditions are strictly causal at execution time.",
      "A 19/21 raw-source winrate cannot be assumed executable: source53 natural positions overlap and need single-slot accounting.",
      "Single-slot includes only P35 original native source entry and exit prices, no alternative routes, no M5 execution fill proof, no exchange orderbook or true LIVE risk.",
      "Historical H1 original exits and M5 high/close mark may have provider coherence differences, and intra-bar STOP activation is unknown.",
      "Original Native V20 STOP/re-entry actual operational accounting is not certified by source53 ledger-only hypothetical gross0.75 replay.",
      "Original 53 includes arbitrary PRE/BASE/POST blocks already inspected; no false time-division holdout claims.",
      "No funding and no shared other Runner gross, correlation or path-dependent portfolio risk. Production remains blocked."
   ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in detailed["all53Matched"]),encoding="utf8")
 lines=[
 "# P44 Original Native53 prior-onset regime filter (source exit preserved)",
 "",
 "P42 found candidate **D3 earlier48h prior-H1 BTC bearish+relative weak+EMA bearish**: observed natural source 19/21 win rate 90.48%. But source periods differ sharply, PRE 1/3, BASE17/17, POST1/1.",
 "Full single slot uses original recorded Native53 H1 entry/exit prices, gross0.75, same native price-model stop outcome, no action.",
 "",
 "| Earlier cross | Window H | All3 kept | Wins source | Source winrate | 1-slot closed | 1-slot wins | 1-slot DD | 1-slot NAV |",
 "|---|---:|---:|---:|---:|---:|---:|---:|---:|"
 ]
 for x in normal:
   e=x["economics"]
   lines.append("| "+str(x["thresholdPct"])+" | "+str(x["hours"])+" | "+str(x["matchedSourceNative"])+" | "+str(x["sourceWins"])+" | "+str(x["sourceWinratePct"])+"% | "+str(e["singleSlotPositions"])+" | "+str(e["wins"])+" | "+str(e["M5HighStressMarkedDDPct"])+"% | "+str(e["finalNAVYen"])+" |")
 lines.extend(["","**No production promotion.** Selection of already observed source53 after many experiments is not holdout. Actual multi-runner DD, native current pin, signed fills and STOP status require independent validation.",""])
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P44_ORIGINAL_NATIVE53_COHORT_0P75_ALL_CROSS_WINDOW_SENSITIVITY_PASS",json.dumps({
  "sourceNative53":53,"sourceWins":29,"scenarioCount":len(cases),
  "targetD3H48":next(x for x in normal if x["thresholdPct"]==3 and x["hours"]==48),
  "baseline":baseline1,
  "range":[{"cross":x["thresholdPct"],"windowH":x["hours"],
            "sourceTrades":x["matchedSourceNative"],"sourceWins":x["sourceWins"],
            "sourceWinPct":x["sourceWinratePct"],
            "singleSlotWinPct":x["economics"]["conditionalWinPct"],
            "DD":x["economics"]["M5HighStressMarkedDDPct"],
            "NAV":x["economics"]["finalNAVYen"]}
            for x in normal]
 },ensure_ascii=False),flush=True)
 print("OUT",OUT,LEDGER,MD)
if __name__=="__main__":main()
