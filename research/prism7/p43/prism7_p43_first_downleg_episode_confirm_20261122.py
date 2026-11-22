#!/usr/bin/env python3
"""P43 read-only regime episode / breakdown / seller-volume / RSI guard sensitivity.
Frozen P42 prequal PRE_ALL3, CROSS_D3. 48h no-repeat is applied using only
chronologically PRIOR raw crossing events irrespective of candidate eligibility.
No future lookahead, no settings or LIVE change.
"""
from __future__ import annotations
import json,math,hashlib,statistics
from pathlib import Path
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import h1_source,cohort,H
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import (
    PENGUH1,BTCH1,SOURCES,R,SOURCE,P41,OUT as P42RESULT,
    build,passes,single_slot,economic,FEES,COVER_SLIPS,GROSS
)
MODELS=("P42_PRE_ALL3","FIRST_EPISODE48",
        "EPISODE48_BREAKDOWN",
        "EPISODE48_SELLER_VOLUME",
        "EPISODE48_PRE_RSI30_50",
        "EPISODE48_ALL_CONFIRMATIONS")
OUTPUT=R/"PRISM7_P43_EARLY_FIRST_EPISODE_CONFIRMATION_20261122.json"
NOTE=R/"PRISM7_P43_EARLY_FIRST_EPISODE_CONFIRMATION_20261122.md"
LEDGER=R/"PRISM7_P43_INITIAL_DOWNLEG_CAUSAL_SIGNAL_LIST_20261122.jsonl"
def run():
    src=json.loads(SOURCE.read_text(encoding="utf8"))
    p42=json.loads(P42RESULT.read_text(encoding="utf8"))
    assert len(src)==53 and sum(x["net30pct"]>0 for x in src)==29
    assert p42["allScenarioCount"]==196
    p,p_hash=h1_source(PENGUH1)
    b,b_hash=h1_source(BTCH1)
    m5,m_hash=load_m5(SOURCES)
    assert p_hash==p42["hashes"]["H1PENGU"] and b_hash==p42["hashes"]["H1BTC"] and m_hash==p42["hashes"]["M5PENGU"]
    crossings=build(p,b)
    d3=sorted([z for z in crossings if z["thresholdPct"]==3],key=lambda x:x["intentTs"])
    assert len(d3)==410
    h1map={x["time"]:i for i,x in enumerate(p)}
    prev_source_cross=[]
    decorated=[]
    for x in d3:
        i=h1map[x["signalReferenceTs"]]
        assert p[i]["time"]+H==x["intentTs"]
        # No earlier H1 D3 cross in 48h (regardless of PRE_ALL3 gate).
        recent=[ts for ts in prev_source_cross if 0 < x["intentTs"]-ts <=48*H]
        episode_first=not recent
        prev_source_cross.append(x["intentTs"])
        mean_volume=sum(z["volume"] for z in p[i-6:i])/6
        sellvol=(p[i]["volume"]>=mean_volume*1.2 if mean_volume>0 else False)
        sellvol=sellvol and p[i]["close"]<p[i]["open"]
        breakdown=p[i]["close"]<p[i-1]["low"]
        rsi=x["prior"]["priorRSI14"]
        prereg_rsi=30<rsi<=50 if rsi is not None else False
        decorated.append({**x,"firstDowncrossIn48h":episode_first,
           "previous48hD3CrossCount":len(recent),
           "currentH1CloseBreaksPriorH1Low":breakdown,
           "currentH1PositiveVolumeSellerConfirmed":sellvol,
           "previousCompletedH1RsiAvoidsOversold":prereg_rsi,
           "signalCurrentVolume6hRatio":round(p[i]["volume"]/mean_volume,6) if mean_volume>0 else None,
           "allInputKnownAtCandidateTime":True})
    def passmodel(x,name):
        if not passes(x["prior"],"PRE_ALL3"):return False
        if name=="P42_PRE_ALL3":return True
        if not x["firstDowncrossIn48h"]:return False
        if name=="FIRST_EPISODE48":return True
        if name=="EPISODE48_BREAKDOWN":return x["currentH1CloseBreaksPriorH1Low"]
        if name=="EPISODE48_SELLER_VOLUME":return x["currentH1PositiveVolumeSellerConfirmed"]
        if name=="EPISODE48_PRE_RSI30_50":return x["previousCompletedH1RsiAvoidsOversold"]
        if name=="EPISODE48_ALL_CONFIRMATIONS":
            return x["currentH1CloseBreaksPriorH1Low"] and x["currentH1PositiveVolumeSellerConfirmed"] and x["previousCompletedH1RsiAvoidsOversold"]
        raise ValueError(name)
    native=[{"id":z["period"]+"|"+z["id"],"intentTs":z["entryTs"],
       "signalReferenceTs":z["entryTs"]-H,
       "route":"NATIVE_V20_SOURCE","cohort":z["period"]} for z in src]
    cache={}
    reference,_=single_slot(native,cache,m5)
    scenarios=[]
    for mod in MODELS:
        elig=[x for x in decorated if passmodel(x,mod)]
        for portfolio in ("EARLY_ONLY","HYBRID_NATIVE_PLUS_EARLY"):
            target=elig if portfolio=="EARLY_ONLY" else native+elig
            selected,block=single_slot(target,cache,m5)
            for fee in FEES:
                for slip in COVER_SLIPS:
                    econ=economic(selected,m5,fee,slip)
                    scenarios.append({"model":mod,"portfolio":portfolio,
                       "sourceDowncrossesBeforeGate":len(d3),
                       "prequalifiedCandidates":len(elig),
                       "originalNativeSourceIntents":len(native) if portfolio.startswith("HYBRID") else 0,
                       "selectedEarly":sum(x["route"]!="NATIVE_V20_SOURCE" for x in selected),
                       "selectedNative":sum(x["route"]=="NATIVE_V20_SOURCE" for x in selected),
                       "occupiedSlot":block["blocked"],
                       "feeBps":fee,"allCoversExtraBps":slip,
                       "capital":econ})
    assert len(scenarios)==len(MODELS)*2*len(FEES)*len(COVER_SLIPS)
    for portfolio in ("EARLY_ONLY","HYBRID_NATIVE_PLUS_EARLY"):
        ref=next(z for z in p42["allScenarioEconomics"] if z["portfolio"]==portfolio and
            z["thresholdPct"]==3 and z["gate"]=="PRE_ALL3" and z["feeBps"]==30 and z["extraAllBuyCoverBps"]==0)
        mine=next(z for z in scenarios if z["portfolio"]==portfolio and
            z["model"]=="P42_PRE_ALL3" and z["feeBps"]==30 and z["allCoversExtraBps"]==0)
        for k in ("closed","wins","M5CloseDDPct","M5HighStressDDPct","finalProxyNavYen"):
            assert abs(mine["capital"][k]-ref["capital"][k])<1e-7,(portfolio,k,mine["capital"][k],ref["capital"][k])
    normal=[z for z in scenarios if z["feeBps"]==30 and z["allCoversExtraBps"]==0]
    observed=[z for z in normal if z["portfolio"]=="EARLY_ONLY" and z["capital"]["closed"]>=30 and z["capital"]["M5HighStressDDPct"]<=20]
    report={
      "schema":"prism7-p43-frozen-d3-preall3-first-episode-seller-breakdown-rsi-experiment/v1",
      "status":"EXPLORATORY_IN_SAMPLE_NO_LIVE_APPROVAL",
      "fixedThresholdCausalFirstDownleg":3,
      "frozenP42PriorAll3Gate":True,
      "fixedRawD3CrossNoRepeatHours":48,
      "entryCurrentH1ConfirmationOnlyAtClose":True,
      "prequalifiedDecisionFeaturesOnlyPriorCompletedH1":True,
      "models":list(MODELS),"gross":GROSS,"feeBps":FEES,"allCoversExtraBps":COVER_SLIPS,
      "originalNativeSource53Unaltered":True,
      "originalNativeSource53WinningOutcomes29Unaltered":True,
      "native53RepricedToCommonStop72NotFullV20":True,
      "P42NativeModelReferenceParityPassed":True,
      "allScenariosCount":len(scenarios),
      "allScenarios":scenarios,
      "normal30bps":normal,
      "earlyAloneDD20InViewedPeriodsOnly":observed,
      "sourceHashes":{"P42":hashlib.sha256(P42RESULT.read_bytes()).hexdigest(),
       "H1PENGU":p_hash,"H1BTC":b_hash,"M5PENGU":m_hash},
      "rawD3Crossings":len(d3),
      "initialEpisodeCrossings":sum(x["firstDowncrossIn48h"] for x in decorated),
      "initialD3StrictPriorAll3Candidates":sum(passes(x["prior"],"PRE_ALL3") and x["firstDowncrossIn48h"] for x in decorated),
      "limits":[
        "Already inspected PRE/BASE/POST: this may overfit historical data. Must not call surviving scenarios validated forecast skill.",
        "New early branch is an alternative route, not original pinned V20 entry. True Native V20 phase exit and all Runner DD not aligned.",
        "Only a single sequential slot with 72h M5 reference STOP and first-positive-print OPEN: no real signed fills or exchange orderbook.",
        "48h episode reset is fixed on raw D3 crossings, not on winners/losers or profitable conditional results.",
        "Additional confirm filters may remove winner opportunities. Check selective win rate AND NAV AND worst drawdown in unseen data.",
        "No funding, slippage depths, other Runners, actual Gross shared-risk or liquidation simulation.",
        "Order book, absent M5 positive volume and H1/M5 coherence not independently certified.",
      ]}
    OUTPUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in decorated),encoding="utf8")
    lines=["# P43 causal first-downleg episode and micro-confirmation\n",
       "Research only. 48h raw D3 crossing cooldown + PRE_ALL3 preconditions + seller/volume/RSI confirmation. P42 reference exactly reproduced.",
       "| Model | Portfolio | Candidates | Closed | Win rate | M5 high DD | NAV |",
       "|---|---|---:|---:|---:|---:|---:|"]
    for x in normal:
        v=x["capital"]
        lines.append("| "+x["model"]+" | "+x["portfolio"]+" | "+str(x["prequalifiedCandidates"])+" | "+str(v["closed"])+" | "+str(v["conditionalWinPct"])+"% | "+str(v["M5HighStressDDPct"])+"% | "+str(v["finalProxyNavYen"])+" |")
    lines.extend(["","No live promotion. Native source entry 53 fixed, common exit proxy not exact V20, all periods previously inspected."])
    NOTE.write_text("\n".join(lines)+"\n",encoding="utf8")
    print("P43_FIRST_EPISODE_CAUSAL_RECHECK_PASS",json.dumps({
       "rawD3Cross":len(d3),
       "episodeFirst":report["initialEpisodeCrossings"],
       "all3First":report["initialD3StrictPriorAll3Candidates"],
       "allScenarios":len(scenarios),
       "normal":[{"model":x["model"],"book":x["portfolio"],"eligible":x["prequalifiedCandidates"],
          "closed":x["capital"]["closed"],"wins":x["capital"]["wins"],
          "win":x["capital"]["conditionalWinPct"],"DD":x["capital"]["M5HighStressDDPct"],
          "NAV":x["capital"]["finalProxyNavYen"]} for x in normal]
    },ensure_ascii=False))
    print("OUT",OUTPUT,LEDGER,NOTE)
if __name__=="__main__":run()
