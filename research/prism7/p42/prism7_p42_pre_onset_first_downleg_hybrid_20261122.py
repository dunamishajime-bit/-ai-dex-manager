#!/usr/bin/env python3
"""P42 experimental early-short before V20 rebound; read-only causal research.
Two independent stages:
  Stage A precondition from the H1 bar that CLOSED BEFORE 24h-drop crossing.
  Stage B first H1 close crossing prior 24h return below 3%, 5%, or 7%.
  Entry at first observed positive-volume M5 OPEN after the signal close.
No future outcomes in eligibility. Frozen native53 and P41 negative control.
All regime PRE/BASE/POST previously inspected; NOT unseen holdout.
Comparators use the SAME M5 reference stop72, not exact native V20 exit.
"""
from __future__ import annotations
import gzip,hashlib,json,math,csv,statistics
from collections import Counter,defaultdict
from pathlib import Path
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import (
    h1_source,moving_ema,stop72,execution_proxy,H,M5,DATA_END,COHORTS,cohort
)
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES

ROOT=Path(__file__).resolve().parent.parent
DATA=Path(r"C:\tmp\disdex-bt-20251001-20261001")
R=ROOT/"results"
SOURCE=R/"PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json"
P41=R/"PRISM7_P41_NATIVE53_PREENTRY_MISSED_MOVE_CAUSAL_20261122.json"
OUT=R/"PRISM7_P42_EARLY_DROP_CAUSAL_HYBRID_GRID_20261122.json"
LEDGER=R/"PRISM7_P42_PREQUALIFIED_DOWNCROSS_ALL_CANDIDATES_20261122.jsonl.gz"
NOTE=R/"PRISM7_P42_EARLY_DROP_CAUSAL_HYBRID_GRID_20261122.md"
BTCH1=[
 ROOT/"prebaseline_public_20250801_20250924"/"BTCUSDT-1h-20250801-20250924-RESEARCH_M5QA.jsonl.gz",
 DATA/"aster-public-v3-h1"/"BTCUSDT-1h-20250924-20261001.jsonl.gz",
 ROOT/"forward_public_20261001_20261118"/"BTCUSDT-1h-20261001-20261118.jsonl.gz",
]
PENGUH1=[
 ROOT/"prebaseline_public_20250801_20250924"/"PENGUUSDT-1h-20250801-20250924.jsonl.gz",
 DATA/"aster-public-v3-h1"/"PENGUUSDT-1h-20250924-20261001.jsonl.gz",
 ROOT/"forward_public_20261001_20261118"/"PENGUUSDT-1h-20261001-20261118.jsonl.gz",
]
GROSS=.75
FEES=(10,30)
COVER_SLIPS=(0,100)
CROSSES=(3,5,7)
GATES=("PRE_NONE","PRE_BTC_BEAR","PRE_REL_WEAK","PRE_EMA_BEAR",
       "PRE_2OF3","PRE_ALL3","PRE_2OF3_VOL","PRE_2OF3_VOL_RSI50")
M5S=300000
FIRST=10000.
def sha(f):return hashlib.sha256(Path(f).read_bytes()).hexdigest()
def rnd(n,d=5):return round(float(n),d)
def ewma(xs,span):
    a=2/(span+1);out=[];val=None
    for x in xs:
        val=x if val is None else a*x+(1-a)*val
        out.append(val)
    return out
def rsi_native(closes,length=14):
    out=[None]*len(closes);gain=loss=None
    for i in range(1,len(closes)):
        step=closes[i]-closes[i-1]
        g=max(step,0);lo=max(-step,0)
        gain=g if gain is None else (g/length+(1-1/length)*gain)
        loss=lo if loss is None else (lo/length+(1-1/length)*loss)
        if i>=length:
            out[i]=100 if loss<=1e-15 else 100-100/(1+gain/loss)
    return out
def preconditions(i,p,b,e72,e168,rsi):
    # i = trigger H1 index; ALL preconditions computed on i-1 completed H1.
    k=i-1
    v6=sum(x["volume"] for x in p[k-5:k+1])
    v36=sum(x["volume"] for x in p[k-41:k-5])
    ratio=(v6/6)/(v36/36) if v36>0 else None
    btc24=b[k]["close"]/b[k-24]["close"]-1
    pengu24=p[k]["close"]/p[k-24]["close"]-1
    f={
      "btcBear":btc24<=0,
      "relativeWeak":pengu24-btc24<=-.01,
      "emaBear":e72[k]<e168[k] and p[k]["close"]<e72[k],
      "volumeNormal":ratio is not None and .4<=ratio<=3,
      "rsiUnder50":rsi[k] is not None and rsi[k]<=50
    }
    return {
      "priorCompletedH1Ts":p[k]["time"],
      "priorPengu24ReturnPct":rnd(100*pengu24),
      "priorBtc24ReturnPct":rnd(100*btc24),
      "priorPenguMinusBtc24Pct":rnd(100*(pengu24-btc24)),
      "priorCloseVsEMA72Pct":rnd(100*(p[k]["close"]/e72[k]-1)),
      "priorEMA72VsEMA168Pct":rnd(100*(e72[k]/e168[k]-1)),
      "priorRSI14":rnd(rsi[k]),
      "priorVolume6hTo36h":rnd(ratio) if ratio is not None else None,
      "flags":f,
      "allKnownOneH1BeforeSignal":True
    }
def passes(pre,gate):
    f=pre["flags"]
    if gate=="PRE_NONE":return True
    if gate=="PRE_BTC_BEAR":return f["btcBear"]
    if gate=="PRE_REL_WEAK":return f["relativeWeak"]
    if gate=="PRE_EMA_BEAR":return f["emaBear"]
    if gate=="PRE_2OF3":return sum(f[k] for k in ("btcBear","relativeWeak","emaBear"))>=2
    if gate=="PRE_ALL3":return all(f[k] for k in ("btcBear","relativeWeak","emaBear"))
    if gate=="PRE_2OF3_VOL":return passes(pre,"PRE_2OF3") and f["volumeNormal"]
    if gate=="PRE_2OF3_VOL_RSI50":
        return passes(pre,"PRE_2OF3_VOL") and f["rsiUnder50"]
    raise ValueError(gate)
def build(p,b):
    pe=[z["close"] for z in p];be=[z["close"] for z in b]
    e72=ewma(pe,72);e168=ewma(pe,168);rsi=rsi_native(pe)
    ids=set();all_=[]
    for i in range(182,len(p)-1):
        if not (p[i]["volume"]>0 and p[i-1]["volume"]>0 and b[i]["volume"]>0):continue
        ret=pe[i]/pe[i-24]-1
        prev=pe[i-1]/pe[i-25]-1
        c=cohort(p[i]["time"]+H)
        if c=="OUTSIDE_COHORT":continue
        pre=preconditions(i,p,b,e72,e168,rsi)
        if pre["priorCompletedH1Ts"]+H!=p[i]["time"]:
            raise ValueError("P42_PRIOR_H1_NOT_STRICTLY_EARLIER")
        for threshold in CROSSES:
            th=-threshold/100
            if not (prev>th and ret<=th):continue
            ts=p[i]["time"]+H
            key=f"P42_D{threshold}_{i:05d}"
            assert key not in ids
            ids.add(key)
            all_.append({
             "id":key,"intentTs":ts,"signalReferenceTs":p[i]["time"],"route":"EARLY_CROSS_D"+str(threshold),
             "cohort":c,"thresholdPct":threshold,
             "prior":pre,
             "atSignalCompletedH1":{
              "penguReturn24Pct":rnd(100*ret),"btcReturn24Pct":rnd(100*(be[i]/be[i-24]-1)),
              "signalH1ClosePctVsPreviousLow":rnd(100*(pe[i]/p[i-1]["low"]-1)),
              "sourcePositiveVolume":p[i]["volume"]>0,
             },
             "earliestDecisionTs":ts,"sourceFuturePriceLeakage":False
            })
    return all_
def stop_price_cached(x,m5,cache):
    t=x["intentTs"]
    if t in cache:return cache[t]
    found=execution_proxy(m5,t)
    if found is None:
        cache[t]={"status":"ENTRY_NO_POSITIVE_M5","entryTs":None,"exitTs":None}
    else:
        t0,px,delay=found
        s=stop72(m5,t0,px)
        cache[t]={"status":s["status"],"entryTs":t0,"entryPrice":px,"exitTs":s.get("exitTs"),
           "exitPrice":s.get("exitPrice"),"reason":s.get("exitReason"),"sameEntryStopAmbiguous":s.get("sameEntryM5StopTouchAmbiguous",False),
           "earlyEntryDelayMin":delay}
    return cache[t]
def single_slot(raw,cache,m5):
    busy=-1;selected=[];blocked=0;censored=0;nonprint=0
    for x in sorted(raw,key=lambda z:(z["intentTs"],0 if z["route"]=="NATIVE_V20_SOURCE" else 1,z["id"])):
        if x["intentTs"]<busy:
            blocked+=1;continue
        z=stop_price_cached(x,m5,cache)
        if z["status"]=="ENTRY_NO_POSITIVE_M5":nonprint+=1;continue
        chosen={**x,**z}
        if z["status"]=="PRICE_PROXY_CLOSED":
            busy=z["exitTs"]+M5S
        else:
            busy=DATA_END;censored+=1
        selected.append(chosen)
    return selected,{"blocked":blocked,"nonprint":nonprint,"censored":censored}
def economic(selected,m5,fee,slip):
    price_nav=FIRST;markpeak=FIRST;realpeak=FIRST;maxdd=0;highdd=0;realdd=0
    wins=0;completed=0;sumreturns=0.;gain=0.;loss=0
    ret_cohort=defaultdict(list)
    stress_signflips=[]
    prevtime=-1
    lastnav=price_nav
    for x in selected:
        t=x["entryTs"]
        if t<=prevtime:raise ValueError("P42_NOT_SINGLE_SLOT")
        last_price=float(x["entryPrice"])
        prevcash=price_nav
        end=x["exitTs"] if x["status"]=="PRICE_PROXY_CLOSED" else DATA_END-M5S
        last_mark=last_price
        for k in range(t,end+1,M5S):
            v=m5.get(k)
            if v is None:raise ValueError("P42_MISSING_M5:"+str(k))
            if float(v[5])>0:
                last_mark=float(v[4])
                if x["status"]=="PRICE_PROXY_CLOSED" and k!=end:
                    adverse_high=float(v[2])
                    hnav=prevcash*(1+GROSS*((last_price-adverse_high)/last_price-fee/10000))
                    highdd=max(highdd,100*(1-hnav/markpeak))
            if x["status"]=="PRICE_PROXY_CLOSED" and k==end:
                cost_price=float(x["exitPrice"])*(1+slip/10000)
                price_nav=prevcash*(1+GROSS*((last_price-cost_price)/last_price-fee/10000))
                nav=price_nav
                simple=100*GROSS*((last_price-cost_price)/last_price-fee/10000)
                wins+=simple>0
                completed+=1;sumreturns+=simple
                ret_cohort[x["cohort"]].append(simple)
                if simple>0:gain+=simple
                else:loss+=-simple
                if price_nav>realpeak:realpeak=price_nav
                realdd=max(realdd,100*(1-price_nav/realpeak))
            else:
                nav=prevcash*(1+GROSS*((last_price-last_mark)/last_price-fee/10000))
            if nav>markpeak:markpeak=nav
            maxdd=max(maxdd,100*(1-nav/markpeak))
            if k==end and x["status"]!="PRICE_PROXY_CLOSED":
                price_nav=nav
        prevtime=end
    return {
      "closed":completed,"wins":wins,"conditionalWinPct":rnd(100*wins/completed) if completed else None,
      "conditionalPF":rnd(gain/loss) if loss>0 else None,
      "meanReturnPctOnEntryNAV":rnd(sumreturns/completed) if completed else None,
      "closedSimpleReturnPctPointsSum":rnd(sumreturns),
      "finalProxyNavYen":rnd(price_nav,2),
      "M5CloseDDPct":rnd(maxdd),
      "M5HighStressDDPct":rnd(max(maxdd,highdd)),
      "realizedOnlyDDPct":rnd(realdd),
      "censored":sum(x["status"]!="PRICE_PROXY_CLOSED" for x in selected),
      "cohorts":{c:{"closed":len(v),"wins":sum(a>0 for a in v),
         "winPct":rnd(100*sum(a>0 for a in v)/len(v))} for c,v in sorted(ret_cohort.items())},
      "notActualAccountOrNativeExitEconomics":True
    }

def main():
    p,psha=h1_source(PENGUH1)
    b,bsha=h1_source(BTCH1)
    assert len(p)==len(b) and all(x["time"]==y["time"] for x,y in zip(p,b))
    print("P42_H1_ROWS",len(p),flush=True)
    m5,m5sha=load_m5(SOURCES)
    original=json.loads(SOURCE.read_text(encoding="utf8"))
    p41=json.loads(P41.read_text(encoding="utf8"))
    assert len(original)==53 and sum(x["net30pct"]>0 for x in original)==29
    assert p41["nativeH1SourceSignalParity53Of53"] and p41["sourceLosses"]==24
    crosses=build(p,b)
    counts={thr:sum(x["thresholdPct"]==thr for x in crosses) for thr in CROSSES}
    print("P42_CROSSINGS",counts,flush=True)
    assert min(counts.values())>5
    source=[]
    for x in original:
      if cohort(x["entryTs"])!=x["period"]:
        raise ValueError("P42_SOURCE53_COHORT_DRIFT")
      source.append({"id":x["period"]+"|"+x["id"],"intentTs":x["entryTs"],"signalReferenceTs":x["entryTs"]-H,
          "route":"NATIVE_V20_SOURCE","cohort":x["period"],
          "pinnedNativeSourceNet30Pct":x["net30pct"],
          "referenceOnlyStop72":True})
    # Retrospective association is NOT a signal: describes early triggers preceding
    # each native case, keeps winners as negative control; no label-trained threshold.
    preassoc=[]
    for x in original:
       # latest crossing in prior48h; distinct threshold models kept separately
       after=[]
       for th in CROSSES:
          possible=[z for z in crosses if z["thresholdPct"]==th and
              0<x["entryTs"]-z["intentTs"]<=48*H]
          chosen=possible[-1] if possible else None
          after.append({"threshold":th,"found":chosen is not None,
             "firstObservedCandidateId":chosen["id"] if chosen else None,
             "priorMarketGateFlags":chosen["prior"]["flags"] if chosen else None,
             "hoursEarlier":rnd((x["entryTs"]-chosen["intentTs"])/H) if chosen else None})
       preassoc.append({"id":x["id"],"period":x["period"],
           "sourceNativeWin":x["net30pct"]>0,
           "sourceNativeNet30Pct":x["net30pct"],
           "strictEarlierCandidatesIn48h":after})
    # Full opportunity grids, no cherry picking known 24 losers.
    # 3 thresholds * 8 causal prior-bar filters * early only/hybrid * 2 fees * 2 slippages,
    # plus a same-exit single-slot source-native price-model comparator.
    cache={}
    source_selected,source_block=single_slot(source,cache,m5)
    source_econ={}
    scenarios=[]
    for fee in FEES:
      for slip in COVER_SLIPS:
        source_econ[(fee,slip)]=economic(source_selected,m5,fee,slip)
        scenarios.append({
          "portfolio":"REFERENCE_NATIVE_ONLY","thresholdPct":None,"gate":"UNFILTERED",
          "feeBps":fee,"extraAllBuyCoverBps":slip,"sourceIntents":53,
          "additionalEarlyCandidates":0,"selected":len(source_selected),
          "blocked":source_block["blocked"],
          "selectedNative":len(source_selected),"selectedEarly":0,
          "capital":source_econ[(fee,slip)]})
    print("P42_NATIVE_REFERENCE",source_econ[(30,0)],flush=True)
    for th in CROSSES:
      pool=[x for x in crosses if x["thresholdPct"]==th]
      for gate in GATES:
        eligible=[x for x in pool if passes(x["prior"],gate)]
        for kind in ("EARLY_ONLY","HYBRID_NATIVE_PLUS_EARLY"):
          raw=eligible if kind=="EARLY_ONLY" else source+eligible
          selected,blocked=single_slot(raw,cache,m5)
          for fee in FEES:
            for slip in COVER_SLIPS:
              eco=economic(selected,m5,fee,slip)
              baseline=source_econ[(fee,slip)]
              scenarios.append({
                "portfolio":kind,"thresholdPct":th,"gate":gate,"feeBps":fee,
                "extraAllBuyCoverBps":slip,"sourceIntents":53 if kind.startswith("HYBRID") else 0,
                "additionalEarlyCandidates":len(eligible),
                "selected":len(selected),"selectedNative":sum(x["route"]=="NATIVE_V20_SOURCE" for x in selected),
                "selectedEarly":sum(x["route"]!="NATIVE_V20_SOURCE" for x in selected),
                "blocked":blocked["blocked"],"nonPositiveM5":blocked["nonprint"],
                "capital":eco,
                "referenceNativeOnlySameExitProxyDDPct":baseline["M5CloseDDPct"],
                "referenceNativeOnlySameExitProxyNAVYen":baseline["finalProxyNavYen"],
                "nativeReferenceStillNotExactV20":True,
              })
    assert len(scenarios)==4+len(CROSSES)*len(GATES)*2*len(FEES)*len(COVER_SLIPS)
    # Individual 53 source winner/loss comparisons for the precondition flags.
    associations={}
    for th in CROSSES:
      wins=[x for x in preassoc if x["sourceNativeWin"]]
      losers=[x for x in preassoc if not x["sourceNativeWin"]]
      def agg(rows):
        active=[next(z for z in x["strictEarlierCandidatesIn48h"] if z["threshold"]==th)
                for x in rows]
        valid=[z for z in active if z["found"]]
        return {"sourceCount":len(rows),"hasEarlyCandidateWithin48h":len(valid),
            "preflagsIfEarlyCandidatePresent":{
             k:sum(z["priorMarketGateFlags"][k] for z in valid)
             for k in ("btcBear","relativeWeak","emaBear","volumeNormal","rsiUnder50")}}
      associations["CROSS_D"+str(th)]={"originalWin29":agg(wins),"originalLoss24":agg(losers)}
    norms=[x for x in scenarios if x["feeBps"]==30 and x["extraAllBuyCoverBps"]==0]
    hybrid=[x for x in norms if x["portfolio"]=="HYBRID_NATIVE_PLUS_EARLY"]
    baseline=next(x for x in norms if x["portfolio"]=="REFERENCE_NATIVE_ONLY")
    exploration=[
      x for x in hybrid if x["capital"]["closed"]>=baseline["capital"]["closed"]
      and x["capital"]["conditionalWinPct"]>=baseline["capital"]["conditionalWinPct"]
      and x["capital"]["finalProxyNavYen"]>baseline["capital"]["finalProxyNavYen"]
      and x["capital"]["M5HighStressDDPct"]<=20
    ]
    summary={
      "schema":"prism7-p42-pre-onset-causal-H1-first-downleg-hybrid-entry-replay/v1",
      "status":"RESEARCH_ONLY_NOT_TRUE_UNSEEN_OOS",
      "pinnedNativeV20Sha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
      "originalSource53Unchanged":True,
      "sourceNative53Wins":29,"sourceNative53Losses":24,
      "candidateGeneratedAcrossEntireH1Timeline":True,
      "totalH1Input":len(p),"allCrossingCandidates":len(crosses),
      "fixedDowncrossH1Return24ThresholdPct":CROSSES,
      "fixedPriorBarGateModels":GATES,
      "strictOnePriorH1Precondition":True,
      "positiveM5NextHourOpenEntryPriceProxyOnly":True,
      "referenceCommonExit":{"hardStopPct":8,"trailingActivatePct":15,
                              "trailingRetracePct":4,"maxHoldHours":72,
                              "matchesFullNativeV20Exit":False},
      "gross":GROSS,"feeBps":FEES,"extraAllBuyCoverSlipBps":COVER_SLIPS,
      "source53NativePriceModelComparatorDoesNotMatchOriginalPinned53Exit":True,
      "originalNative53EconomicComparatorCannotBeReportedAsOneSlotDD":True,
      "originalSourceNativeSingleSlotReference":source_econ[(30,0)],
      "allScenarioCount":len(scenarios),"allScenarioEconomics":scenarios,
      "base30bpsNoAdditionalCoverSlip":norms,
      "exploratoryPassingReferenceRiskOnly":exploration,
      "native53Prior48hEarliestCrossAssociation":associations,
      "sourceNativeOriginal53EntriesNotChanged":True,
      "sourceNativeHistoricalOutcomesNotUsedToFitGates":True,
      "originalNative53AndEarlyTriggersOverlapPossible":True,
      "hashes":{"sourceNative53":sha(SOURCE),"p41Source53Parity":sha(P41),
                "H1PENGU":psha,"H1BTC":bsha,"M5PENGU":m5sha},
      "limitations":[
        "The 2025/08-2026/11 PRE/BASE/POST periods were already inspected in prior research; this study has no truly blind untouched holdout.",
        "First down-crossing of H1 return24 (3/5/7%) can occur in the middle of a larger drop; it is NOT guaranteed the first tick of the decline.",
        "The prior-bar prequalification is known strictly before the downcross H1 bar closes. No future labels are used to approve entry.",
        "Source pinned V20 has -7 impulse+1.25 bounce+rebreak and phase-specific native exits; this alternative is newly engineered and cannot be called a Native V20 signal.",
        "M5 stop72 is an independent common research overlay; native53 original wins29 is NOT parity to this overlay's single-slot native reference return, DD or trade count.",
        "All M5 execution uses the first positive-volume bar OPEN proxy, not verified signed bid/ask or exchange orderbook. STOP same-candle event ordering ambiguous.",
        "Single slot priority is first eligible chronological intent, tie to native, not live concurrent portfolio Shared Risk policy; no other runners.",
        "Slippage scenarios are simplified; funding, liquidation, exchange margin, market impact and current production states are omitted.",
        "Reported M5 marked high stress DD is research equity proxy; NOT actual portfolio max DD or production compliance.",
        "Early research entry cannot be promoted from model selection on already-viewed periods. New independent data and source native full exit parity required.",
      ],
    }
    OUT.write_text(json.dumps(summary,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    with gzip.open(LEDGER,"wt",encoding="utf8") as f:
       for x in crosses:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n")
    NOTE.write_text(
      "# P42 First-downleg prequalification and Native V20 hybrid\n\n"+
      "All H1 crossing signals built across PRE/BASE/POST; only previous completed H1 features gate the entry.\n"+
      "Native original 53 source wins29 are preserved. All combined economics use a common experimental stop72, not full Native V20 exit.\n\n"+
      "| Model | 30bps closed | Wins | Win rate | M5 close DD | High stress DD | NAV JPY | Early selected |\n"+
      "|---|---:|---:|---:|---:|---:|---:|---:|\n"+
      "".join(
        f"| {x['portfolio']} D{x['thresholdPct']} {x['gate']} | {x['capital']['closed']} | {x['capital']['wins']} | {x['capital']['conditionalWinPct']}% | {x['capital']['M5CloseDDPct']}% | {x['capital']['M5HighStressDDPct']}% | {x['capital']['finalProxyNavYen']:,.0f} | {x.get('selectedEarly',0)} |\n"
        for x in norms)+
      "\n**No true unseen OOS; no production adoption allowed.**\n",encoding="utf8")
    print("P42_FULL_CAUSAL_H1_FIRST_DROP_HYBRID_GRID_PASS",json.dumps({
     "h1Rows":len(p),"crossings":counts,"allScenarios":len(scenarios),
     "nativeSourceReference":baseline["capital"],
     "topReferenceHybridByNAV":[{"threshold":x["thresholdPct"],"gate":x["gate"],"closed":x["capital"]["closed"],
         "win":x["capital"]["conditionalWinPct"],"DD":x["capital"]["M5HighStressDDPct"],
         "NAV":x["capital"]["finalProxyNavYen"],
         "selectedEarly":x["selectedEarly"]}
         for x in sorted(hybrid,key=lambda z:-z["capital"]["finalProxyNavYen"])[:8]],
     "passing":len(exploration),"native53Association":associations
    },ensure_ascii=False),flush=True)
    print("OUT",OUT,LEDGER,NOTE)
if __name__=="__main__":main()
