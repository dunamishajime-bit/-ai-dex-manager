#!/usr/bin/env python3
"""P53 original P52 first raw M5 break: mechanism & contamination audit.

* Post-outcome MFE/MAE decomposition is DIAGNOSTIC ONLY.
* All group comparisons use every P52 first raw 5m event, not just known wins.
* Past 24h completed M5 price path is observable before the event; a peak/trough
  can be identified only retrospectively inside that already completed window.
* Next M5 OPEN entry is not a venue quote/fill, and next-bar volume is ex-post
  audit ONLY, NEVER a signal.
* 30bps and +100bps cover stress, 0.75x, P20 stop72 research overlay only.
"""
from __future__ import annotations
import json,hashlib,datetime,math,random
from collections import Counter,defaultdict
from pathlib import Path
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import stop72,H,M5,DATA_END
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,SOURCES,GROSS,economic
P52=R/"PRISM7_P52_TRUE_M5_FIRST_DROP_TAKER_SELL_CONTEXT_20261122.json"
OUT=R/"PRISM7_P53_FIRST_M5_TAKER_BUY_ABSORPTION_AND_PRIOR_DROP_AUDIT_20261122.json"
MD=R/"PRISM7_P53_FIRST_M5_TAKER_BUY_ABSORPTION_AND_PRIOR_DROP_AUDIT_20261122.md"
LEDGER=R/"PRISM7_P53_ALL142_PREENTRY_PRIOR_DROP_AND_INDEPENDENT_OUTCOME_LEDGER_20261122.jsonl"
THRESHOLDS=(.003,.005)
CLASSES=("ALL","SELL_TAKER55","BUY_TAKER60","MIDDLE","BUY_TAKER60_AND_PRIOR24_PATH_LT3","BUY_TAKER60_AND_PRIOR24_PATH_LT5","SELL_TAKER55_AND_PRIOR24_PATH_LT3","SELL_TAKER55_AND_PRIOR24_PATH_LT5")
def rnd(v,n=5):return None if v is None else round(float(v),n)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def iso(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat()
def wilson(w,n):
 if n==0:return [None,None]
 z=1.95996398454005
 a=w/n;den=1+z*z/n
 ctr=(a+z*z/(2*n))/den
 d=z*math.sqrt(a*(1-a)/n+z*z/(4*n*n))/den
 return [rnd(100*(ctr-d),2),rnd(100*(ctr+d),2)]
def prior_path(x,m):
    start=x["sourceM5ReferenceTs"]-288*M5
    source=[]
    for k in range(288):
        t=start+k*M5
        v=m.get(t)
        if v is None:raise ValueError("P53_M5_PRIOR24_GAP:"+str(t))
        source.append(v)
    peak=float(source[0][4])
    maximalCloseD=0.;peakTs=start;troughTs=start
    high=float(source[0][2]);maxHighToLow=0.
    for k,v in enumerate(source):
       t=start+k*M5
       c=float(v[4]);lo=float(v[3])
       if peak>0:
          d=1-c/peak
          if d>maximalCloseD:
            maximalCloseD=d;troughTs=t;peakTs=peakTs
       if c>peak:peak=c;peakTs=t
       if high>0:maxHighToLow=max(maxHighToLow,1-lo/high)
       high=max(high,float(v[2]))
    initial=float(source[0][1])
    last=float(source[-1][4])
    return {
       "observedPrior24M5ClosedBars":288,
       "maxCompletedM5ClosePeakToLaterCloseTroughPct":rnd(maximalCloseD*100),
       "maxCompletedM5HighToLaterLowPct":rnd(maxHighToLow*100),
       "prior24M5FirstOpenToLastClosePct":rnd(100*(last/initial-1)),
       "previous24hMaxCloseDrawdownBeforeTheM5Signal":True,
       "noFutureM5BARSIncluded":True,
    }
def bestfavorable(m,start,end,px):
    # diagnostic outcome: no entry-time decisions can use this.
    favclose=0.;adverseclose=0.;firstfav=None;firstadv=None
    for t in range(start,end+1,M5):
       z=m.get(t)
       if z is None:raise ValueError("P53_M5_FAVORABLE_HOLE")
       if float(z[5])<=0:continue
       v=float(z[4])
       f=100*(1-v/px);adv=100*(v/px-1)
       favclose=max(favclose,f);adverseclose=max(adverseclose,adv)
       if firstfav is None and f>=1:firstfav=t
       if firstadv is None and adv>=1:firstadv=t
    return {
      "maxFavorableCompletedM5ClosePct":rnd(favclose),
      "maxAdverseCompletedM5ClosePct":rnd(adverseclose),
      "reachedOnePctFavorableCloseBeforeExit":firstfav is not None,
      "reachedOnePctAdverseCloseBeforeFavorable":firstadv is not None and (firstfav is None or firstadv<firstfav),
      "firstFavorableOnePctTs":firstfav,
      "firstAdverseOnePctTs":firstadv,
      "usesFutureDataForPosthocDiagnosticONLY":True
    }
def category(x,typ):
    ratio=x["eventM5PENGUTakerBuyRatio"]
    prior=x["observedPrior24M5"]["maxCompletedM5ClosePeakToLaterCloseTroughPct"]
    if typ=="ALL":return True
    if typ=="SELL_TAKER55":return ratio<=.45
    if typ=="BUY_TAKER60":return ratio>=.60
    if typ=="MIDDLE":return .45<ratio<.60
    if typ=="BUY_TAKER60_AND_PRIOR24_PATH_LT3":return ratio>=.60 and prior<3
    if typ=="BUY_TAKER60_AND_PRIOR24_PATH_LT5":return ratio>=.60 and prior<5
    if typ=="SELL_TAKER55_AND_PRIOR24_PATH_LT3":return ratio<=.45 and prior<3
    if typ=="SELL_TAKER55_AND_PRIOR24_PATH_LT5":return ratio<=.45 and prior<5
    raise ValueError("P53_BAD_CLASS")
def row_econ(x,extraCover=0):
    y=x["referencePriceModelExit"]
    if y["status"]!="PRICE_PROXY_CLOSED":return None
    entry=y["entryProxyPrice"]
    price=y["exitProxyPrice"]*(1+extraCover/10000)
    return 100*GROSS*((entry-price)/entry-.003)
def main():
    original=json.loads(SOURCE.read_text(encoding="utf8"))
    assert len(original)==53 and sum(x["net30pct"]>0 for x in original)==29
    p52=json.loads(P52.read_text(encoding="utf8"))
    assert p52["sourceNativeV20Unmodified"]==53 and p52["rawM5DownsideEventsBefore24hCooldown"]==846 and p52["firstRawEventPer24h"]==142
    m,msha=load_m5(SOURCES)
    e=[x for x in p52["fullGeneratedM5EventLedger"] if x["firstRawDownBreakIn24h"]]
    assert len(e)==142
    fromsource={}
    for threshold in THRESHOLDS:
      z=next(x for x in p52["individualScenarioEligibilityAndBookedPositions"] if x["threshold"]==threshold and x["arm"]=="RAW_FIRST_M5_BREAK")
      fromsource[threshold]=z
    allcases=[]
    for x in e:
      intent=x["entryIntentTs"]
      bar=m.get(intent)
      if bar is None:raise ValueError("P53_NEXT_M5_OPEN_MISSING")
      px=float(bar[1])
      if not px>0:raise ValueError("P53_NEXT_M5_PRICE_BAD")
      stop=stop72(m,intent,px)
      y={"status":stop["status"],"entryTs":intent,
         "entryProxyPrice":px,"exitTs":stop.get("exitTs"),"exitProxyPrice":stop.get("exitPrice"),
         "reason":stop.get("exitReason"),
         "entryBarVolumeAfterTheFact":float(bar[5]),
         "entryBarHasAnyTradesAfterTheFact":float(bar[5])>0,
         "entryBarVolumeNeverUsedToDecideTrade":True,
         "researchStop72NotNativeV20":True}
      row={**x,"observedPrior24M5":prior_path(x,m),"referencePriceModelExit":y}
      row["intersectsSourceNative53HoldingWindowCount"]=sum(a["entryTs"]<=intent<a["exitTs"] for a in original)
      if y["status"]=="PRICE_PROXY_CLOSED":
        diag=bestfavorable(m,intent,y["exitTs"],px)
        row["postEntryDiagnostic"]=diag
        row["gross075Net30BpsEquityPct"]=rnd(100*GROSS*((px-y["exitProxyPrice"])/px-.003))
        row["gross075Net130BpsEquityPct"]=rnd(100*GROSS*((px-y["exitProxyPrice"]*1.01)/px-.003))
      else:
        row["postEntryDiagnostic"]=None
        row["gross075Net30BpsEquityPct"]=None
        row["gross075Net130BpsEquityPct"]=None
      allcases.append(row)
    # Reproduce the exact P52 baseline selected trade IDs and their exits,
    # proving our independent outcomes are not altered by the new grouping.
    idmap={x["id"]:x for x in allcases}
    for threshold in THRESHOLDS:
      z=fromsource[threshold]
      for orig in z["selected"]:
        candidate=idmap[orig["id"]]
        info=candidate["referencePriceModelExit"]
        assert candidate["entryIntentTs"]==orig["entryTs"]
        assert info["exitTs"]==orig["exitTs"]
        assert info["exitProxyPrice"]==orig["exitPrice"]
        assert orig["exitReason"]==info["reason"]
    groups=[]
    for threshold in THRESHOLDS:
      sample=[x for x in allcases if x["M5BodyMovePct"]<=-100*threshold]
      for name in CLASSES:
        subset=[x for x in sample if category(x,name)]
        closed=[x for x in subset if x["gross075Net30BpsEquityPct"] is not None]
        n=len(closed);w=sum(z["gross075Net30BpsEquityPct"]>0 for z in closed)
        vals=[z["gross075Net30BpsEquityPct"] for z in closed]
        valsStress=[z["gross075Net130BpsEquityPct"] for z in closed]
        g={
         "thresholdM5CandleBodyPct":rnd(100*threshold,2),"group":name,
         "allInitialSignals":len(sample),"allQualifyingIntents":len(subset),
         "independentSourceCandidatesClosed":n,"independentSourceCandidatesWins":w,
         "winPct":rnd(100*w/n) if n else None,"winsWilson95Pct":wilson(w,n),
         "perCandidateGross075NetPointsSum":rnd(sum(vals)),
         "perCandidateReturnMeanPct":rnd(sum(vals)/n) if n else None,
         "extra100bpsWinPct":rnd(100*sum(z>0 for z in valsStress)/len(valsStress)) if valsStress else None,
         "sourceOverlappingNativePositionIntents":sum(z["intersectsSourceNative53HoldingWindowCount"]>0 for z in subset),
         "unverifiedZeroVolumeOnScheduledEntryBar":sum(not z["referencePriceModelExit"]["entryBarHasAnyTradesAfterTheFact"] for z in subset),
         "prior24ClosePeakToLaterCloseDDge3":sum(z["observedPrior24M5"]["maxCompletedM5ClosePeakToLaterCloseTroughPct"]>=3 for z in subset),
         "prior24ClosePeakToLaterCloseDDge5":sum(z["observedPrior24M5"]["maxCompletedM5ClosePeakToLaterCloseTroughPct"]>=5 for z in subset),
         "postEntryReachedAtLeastOnePctFavorableCloseCount":sum(z.get("postEntryDiagnostic",{}).get("reachedOnePctFavorableCloseBeforeExit",False) for z in closed),
         "perCohort":{}
        }
        for c in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV"):
          cls=[z for z in closed if z["cohort"]==c]
          g["perCohort"][c]={"closed":len(cls),"wins":sum(z["gross075Net30BpsEquityPct"]>0 for z in cls)}
        groups.append(g)
    buy=next(z for z in groups if z["thresholdM5CandleBodyPct"]==.3 and z["group"]=="BUY_TAKER60")
    sell=next(z for z in groups if z["thresholdM5CandleBodyPct"]==.3 and z["group"]=="SELL_TAKER55")
    # Prior24-hour drawdown gate is only a diagnostic: testing after viewing
    # cases is NOT independent validation even though its values are causal.
    report={
     "schema":"prism7-p53-first-M5-break-asof-prior24-path-taker-buy-absorption-diagnostic/v1",
     "status":"RESEARCH_ONLY_NOT_VALIDATED",
     "sourceNative53OriginalTradesAndExitUnchanged":True,
     "P52OriginalSelectedReferenceParity":True,
     "priceSeriesM5PENGUSHA256":msha,
     "sourceP52ReportSHA256":sha(P52),
     "sourceOriginalNative53SHA256":sha(SOURCE),
     "source142FirstRawM5Breaks":len(allcases),
     "thresholds":THRESHOLDS,
     "classes":CLASSES,
     "allIndependentCandidateGroups":groups,
     "oneSlotP52OriginalResultsRemainAuthoritativeForCapitalSequence":True,
     "unfilteredIndependentCandidatesNotAOneSlotPortfolio":True,
     "buyTaker60versusSellerTaker55_0p3":{
        "buy":buy,"sell":sell,
        "associationNotEvidenceOfBuyerAbsorption":True
     },
     "perCandidateAsOfAndPosthocLedger":allcases,
     "limitations":[
        "Prior24h maximal completed M5 close drawdown is known by event time, but the optimal peak and trough are retrospective within the already completed 24h window; NOT predictive timing.",
        "P52 original first raw M5 per 24h is an episode definition only, not guaranteed true first decline from a larger drawdown.",
        "Per-candidate profit group comparisons retain overlapping trading intents and are NOT one-slot equity, DD or possible LIVE fills.",
        "High taker-BUY share inside a RED candle might represent passive seller absorption, but the tape alone is inadequate to infer market participant intent. Illiquid M5 samples may distort this ratio.",
        "Scheduled next M5 OPEN is not actual signed trade. Ex-post next bar volume cannot be used as LIVE entry decision, only audit.",
        "No data-independent validation or exact Native V20 phase exit function for new M5 route. No other Runner shared risk.",
        "Using P52 previously seen outcomes to design prior drawdown gates would be in-sample multiple-testing; none are promoted.",
        "Stop72 protection has M5-bar intrabar high/low sequencing limitations, no funding, book gaps, liquidation or market impact.",
     ]
    }
    OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    LEDGER.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in allcases),encoding="utf8")
    lines=[
       "# P53: P52 first M5 down-break, prior 24h market path & taker ratio",
       "",
       "142 raw first M5 lower-low bearish events. All initial eligible events are preserved; per-event return uses original research stop72 and 30bps, not native V20 full exit. Groups are source intents, NOT tradable single-slot DD.",
       "",
       "| Body % | Group | Qualifying | Closed | Won | Win% | Wilson 95% | 100bps-worse Win% | Prior24 path down>=3% | Zero volume next bar |",
       "|---|---|---:|---:|---:|---:|---|---:|---:|---:|"
    ]
    for x in groups:
      lines.append("| "+str(x["thresholdM5CandleBodyPct"])+" | "+x["group"]+" | "+str(x["allQualifyingIntents"])+" | "+str(x["independentSourceCandidatesClosed"])+" | "+str(x["independentSourceCandidatesWins"])+" | "+str(x["winPct"])+" | "+str(x["winsWilson95Pct"])+" | "+str(x["extra100bpsWinPct"])+" | "+str(x["prior24ClosePeakToLaterCloseDDge3"])+" | "+str(x["unverifiedZeroVolumeOnScheduledEntryBar"])+" |")
    lines+=["","Counterintuitive taker BUY in red candle is a negative control, NOT permission to use high taker buy as a validated short signal. Some signals follow previous large drawdowns. NEXT trade must reconstruct real volume, liquidity, and true blind testing.",""]
    MD.write_text("\n".join(lines),encoding="utf8")
    print("P53_P52_FULL_FIRST142_SOURCE_PARITY_PRIOR24_PATH_AND_TAKER_NEGCONTROL_PASS",
     json.dumps({
       "first142":len(allcases),
       "groups":[{"thr":z["thresholdM5CandleBodyPct"],"group":z["group"],
          "eligible":z["allQualifyingIntents"],"closed":z["independentSourceCandidatesClosed"],
          "wins":z["independentSourceCandidatesWins"],"winpct":z["winPct"],
          "CI":z["winsWilson95Pct"],"prior24D3":z["prior24ClosePeakToLaterCloseDDge3"],
          "expostZeroEntry":z["unverifiedZeroVolumeOnScheduledEntryBar"],
          "cohorts":z["perCohort"]}
          for z in groups]},ensure_ascii=False),flush=True)
    print("FILES",OUT,MD,LEDGER)
if __name__=="__main__":main()
