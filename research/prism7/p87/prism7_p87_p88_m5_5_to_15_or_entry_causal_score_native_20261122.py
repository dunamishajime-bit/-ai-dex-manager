#!/usr/bin/env python3
"""P87 Frozen 5m/15m post-signal causal confirmation for PENGU Native V20.
Owner-selected OR: ASTER or Binance Native V20 source -> ONE ASTER short.
Does not change entry source, exit/STOP source, gross P73, or 0.25 policy.
Compare no confirmation with precisely same M5 entry clock; causal closed M5
confirmation at +5m or +15m, or staged 5m first /15m if 5m fails.
Freeze scoring before analyzing a NEW deterministic dummy holdout (P88).
No real exchange fill; no actual LIVE code mutation.
"""
from __future__ import annotations
import argparse,collections,datetime,gzip,hashlib,json,math,statistics
from pathlib import Path
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R
from prism7_p71_aster_binance_signed_multitf_entry_points_20261122 import tfcache,trend_features,macro_direction,score_joint
from prism7_p73_no025_dualmarket_score_veto_half_full_20261122 import allocation
from prism7_p66_native53_multitimeframe_score_size_20261122 import replay

PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
H=3600000;M5=300000
SOURCES=("ASTER_ONLY","BINANCE_TO_ASTER","BOTH_REQUIRED","EITHER_OR_ASTER_ONCE")
POLICIES=("BASE5_NO_CONFIRM","BASE15_NO_CONFIRM","CONFIRM_5M","CONFIRM_15M","CONFIRM_5_THEN_15")
FEES=((10,0),(30,0),(30,100))
SIZE_POLICY="MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def tf_rows(bars):
 return [{"time":int(z[0]),"open":float(z[1]),"high":float(z[2]),"low":float(z[3]),"close":float(z[4]),"volume":float(z[5])} for z in bars]
def truth(z,mode):
 a=z["triggerAster"];b=z["triggerBinance"]
 return a if mode=="ASTER_ONLY" else b if mode=="BINANCE_TO_ASTER" else (a and b) if mode=="BOTH_REQUIRED" else (a or b)
def check5(m5,t,prev):
 """Decision at t+5m after only [t,t+5) COMPLETED M5; trade >=t+5."""
 bar=m5[t]
 vol=float(bar[5]);o=float(bar[1]);hi=float(bar[2]);lo=float(bar[3]);c=float(bar[4])
 if vol<=0:return {"pass":False,"score":None,"reason":"NO_POSITIVE_PRINT_FOR_COMPLETED_5M","observableEndTs":t+M5}
 sign=(1 if c<o else 0)+(1 if c<prev else 0)
 span=max(hi-lo,1e-12)
 rejection=hi-max(o,c)
 sign+=int(rejection/span>=.3)
 if c/o>1.004:sign-=2
 if c/prev>1.003:sign-=1
 if c/prev<.975:sign-=1 # chase avoidance (no future price)
 return {"pass":sign>=2,"score":sign,"reason":"PASS" if sign>=2 else "SHORT_5M_SCORE_REJECT",
  "observableEndTs":t+M5,"lastPrintedClose":c,"priorH1Close":prev,
  "priceProgressPct":round(100*(c/prev-1),5),"printedBars":1}
def check15(m5,t,prev):
 """Decision at t+15m after only M5 bars [t,t+15) CLOSED."""
 rows=[m5[t+k*M5] for k in range(3)]
 pr=[z for z in rows if float(z[5])>0]
 if len(pr)<2:return {"pass":False,"score":None,"reason":"NEED_2_POSITIVE_PRINT_M5_OF_3","observableEndTs":t+3*M5,
  "printedBars":len(pr)}
 o=float(pr[0][1]);c=float(pr[-1][4]);hi=max(float(z[2]) for z in pr);lo=min(float(z[3]) for z in pr)
 neg=sum(float(z[4])<float(z[1]) for z in pr)
 sign=int(c<o)+int(c<prev)+int(neg>=2)
 span=max(hi-lo,1e-12)
 sign+=int((hi-max(o,c))/span>=.3)
 if c/o>1.006:sign-=2
 if c/prev>1.005:sign-=1
 if c/prev<.975:sign-=1
 return {"pass":sign>=2,"score":sign,"reason":"PASS" if sign>=2 else "SHORT_15M_SCORE_REJECT",
  "observableEndTs":t+3*M5,"lastPrintedClose":c,"priorH1Close":prev,
  "priceProgressPct":round(100*(c/prev-1),5),"printedBars":len(pr)}
def choose(policy,x):
 if policy=="BASE5_NO_CONFIRM":return (5,{"pass":True,"score":None,"reason":"BASE5_NO_GATE","observableEndTs":x["signalTs"]+M5})
 if policy=="BASE15_NO_CONFIRM":return (15,{"pass":True,"score":None,"reason":"BASE15_NO_GATE","observableEndTs":x["signalTs"]+3*M5})
 if policy=="CONFIRM_5M":return (5,x["score5"])
 if policy=="CONFIRM_15M":return (15,x["score15"])
 if policy=="CONFIRM_5_THEN_15":
  if x["score5"]["pass"]:return (5,{**x["score5"],"stage":"5_PASS"})
  if x["score15"]["pass"]:return (15,{**x["score15"],"stage":"15_RESCUE_AFTER_5_REJECT"})
  return (15,{**x["score15"],"stage":"BOTH_REJECT"})
 raise ValueError(policy)
def calc_path(pathinfo):
 f=Path(pathinfo["path"])
 assert f.exists() and sha(f)==pathinfo["sha256"]
 with gzip.open(f,"rt",encoding="utf8") as stream:p=json.load(stream)
 assert p["sourcePinnedNativeSHA"]==PIN and p["sourceSyntheticNotActual"]
 assert p["sourceIndependentPrefixInvariantA"] and p["sourceIndependentPrefixInvariantB"]
 aP,aBTC,bP,bBTC,bETH=(tf_rows(p["sourcesH1"][n]) for n in ("aP","aBTC","bP","bBTC","bETH"))
 assert len(aP)==len(bP)==1092
 m5={int(z[0]):z for z in p["asterSourceM5"]}
 assert len(m5)==1092*12
 caches=[tfcache(z) for z in (aP,aBTC,bP,bBTC,bETH)]
 acp,acb,bcp,bcb,bce=caches
 bytime={z["time"]:i for i,z in enumerate(aP)}
 cases=[];scoreAudit=collections.Counter()
 for z in p["allNaturalSourceSignalAndCounterfactualM5NativeExits"]:
  t=z["signalTs"];i=bytime[t]
  assert i>0 and t+3*M5<p["decisionEndExclusiveTs"]+3*M5
  # prior completed H1 is public at signal UTC, never next candle's close.
  prior=aP[i-1]["close"]
  score5=check5(m5,t,prior);score15=check15(m5,t,prior)
  assert score5["observableEndTs"]==t+M5 and score15["observableEndTs"]==t+3*M5
  pt=trend_features(acp,acb,t);bt=trend_features(bcp,bcb,t)
  signed=score_joint(pt["penguTrend"],bt["penguTrend"],
    macro_direction(acb,t),macro_direction(bcb,t),macro_direction(bce,t))
  gross=allocation(SIZE_POLICY,{"dualSigned":signed,"featuresAtNativeEntry":pt})
  assert gross in (0,.5,.75)
  cases.append({**z,"score5":score5,"score15":score15,
    "grossOriginalP73":gross,"signedScoreH1":signed["grossSignedScore"]})
  scoreAudit["nativeOR"]+=1
  scoreAudit["macroVeto"]+=gross==0
  scoreAudit["score5Pass"]+=score5["pass"]
  scoreAudit["score15Pass"]+=score15["pass"]
  scoreAudit["score5Only"]+=score5["pass"] and not score15["pass"]
  scoreAudit["score15Only"]+=score15["pass"] and not score5["pass"]
  scoreAudit["bothReject"]+=not score15["pass"] and not score5["pass"]
 assert len(cases)==p["sourceNaturalCounts"]["UNION"]
 finalT=p["observationEndExclusiveTs"]-M5
 prevPrint=max(t for t,z in m5.items() if t<=finalT and float(z[5])>0)
 terminalPrice=float(m5[prevPrint][4])
 result=[];sampling=[]
 for mode in SOURCES:
  raw=[z for z in cases if truth(z,mode)]
  for policy in POLICIES:
   constructed=[];reject=collections.Counter()
   for z in raw:
    g=z["grossOriginalP73"]
    if g==0:reject["P73_0_SKIP"]+=1;continue
    minute,confidence=choose(policy,z)
    if not confidence["pass"]:
     reject["M5_CONFIRM_REJECT"]+=1
     reject["M5_REASON_"+confidence["reason"]]+=1
     continue
    # ASTER native 5m source was computed by pinned JS source at that specific
    # execution clock (same +5 or +15 as baseline). The only action is veto,
    # not a post-hoc custom EXIT; persistent STOP and native V20 stay frozen.
    model=z["m5RepricedNativeStopGrossAndDelay"][str(g)][str(minute)]
    if model["status"]=="NO_ENTRY_POSITIVE_PRINT_IN_H1":
     reject["NO_POSITIVE_PRINT_ENTRY"]+=1;continue
    if model["stopIntrabarUncertain"]:
     reject["AMBIGUOUS_STOP_IN_ENTRY_5M"]+=1;continue
    ts=model["entryTs"];price=model["entryPrice"]
    if ts is None or price is None:raise RuntimeError("M5_SOURCE_WITHOUT_CLOSED_ENTRY_PRICE")
    assert ts>=confidence["observableEndTs"],("LOOK_AHEAD_ENTRY_BEFORE_SIGNAL_DECISION",policy,z["signalTs"])
    if model["status"]=="PRICE_PROXY_CLOSED":
     end=model["exitTs"];exitPrice=model["exitPrice"];terminal=False
     assert end>ts and exitPrice>0
    else:
     end=finalT;exitPrice=terminalPrice;terminal=True
     if end<=ts:raise RuntimeError("CENSORED_AFTER_TERMINAL")
    cat="BOTH" if z["triggerAster"] and z["triggerBinance"] else "ASTER_ONLY" if z["triggerAster"] else "BINANCE_ONLY"
    constructed.append({"key":p["tag"]+"|"+cat+"|"+str(z["signalTs"]),
      "entryTs":ts,"entryPrice":price,"exitTs":end,"exitPrice":exitPrice,
      "grossAllocation":g,"sourceNativeNet30Pct":100*(1-exitPrice/price)-.3,
      "score":z["signedScoreH1"],"sourceNativeWin":(100*(1-exitPrice/price)-.3)>0,
      "signalTs":z["signalTs"],"triggerCategory":cat,
      "horizonMTMNotNativeExit":terminal,"postSignalScore":confidence["score"],
      "postSignalDecisionMinute":minute})
   assert len(constructed)==len({x["signalTs"] for x in constructed}),"OR_DEDUP_FAILED"
   if len(constructed)>0:
    assert all(x["grossAllocation"] in (.5,.75) for x in constructed)
   for fee,slip in FEES:
    x=replay(constructed,m5,fee,slip)
    selected=set(x["singleSlotNativeSourceKeys"])
    sel=[q for q in constructed if q["key"] in selected]
    assert len(sel)==x["closed"] and len(selected)==len(sel)
    term=sum(q["horizonMTMNotNativeExit"] for q in sel)
    closed=x["closed"]-term
    actualWins=sum(next(z["resultWin"] for z in x["capitalTradeLedger"] if z["key"]==q["key"])
       for q in sel if not q["horizonMTMNotNativeExit"])
    result.append({"mode":mode,"postSignalConfirmation":policy,
      "feeBps":fee,"coverExtraBps":slip,"sourceNative":len(raw),
      "vetoCountAndReasons":dict(reject),"acceptedAfterM5":len(constructed),
      "singleSlotPositions":x["closed"],"realizedClosed":closed,
      "realizedWins":actualWins,"censoredMTM":term,
      "NAVJPY":x["finalNAVYen"],"M5HighDDPct":x["M5HighStressDDPct"],
      "singleSlotAdmittedCategory":dict(collections.Counter(q["triggerCategory"] for q in sel)),
      "selected30bps":[{"key":q["key"],"entryTs":q["entryTs"],"exitTs":q["exitTs"],
         "gross":q["grossAllocation"],"isTerminalMTM":q["horizonMTMNotNativeExit"],
         "score":q["postSignalScore"],"decisionMinute":q["postSignalDecisionMinute"],
         "retPct":next(z["equityRetPct"] for z in x["capitalTradeLedger"] if z["key"]==q["key"])}
         for q in sel] if fee==30 and slip==0 else None})
 assert len(result)==len(SOURCES)*len(POLICIES)*len(FEES)==60
 # Strict parity: NO confirm 5/15 must exactly match earlier P85 on same path
 # for same gross P73, all 4 signals, 10/30/extra100 fee.
 return {"tag":p["tag"],"regime":p["regime"],"liquidity":p["liquidity"],
  "coupling":p["coupling"],"seed":p["seed"],
  "pathSHA256":pathinfo["sha256"],
  "sourcesNative":p["sourceNaturalCounts"],
  "postSignalAsOfM5Audit":dict(scoreAudit),
  "all60ModeGateAndPriceStress":result,
  "causalM5EntryAllAfterObservation":True,
  "actualSignedFill":False}

def summarize(paths):
 metrics=[]
 for mode in SOURCES:
  for policy in POLICIES:
   for fee,slip in FEES:
    rr=[next(z for z in p["all60ModeGateAndPriceStress"] if z["mode"]==mode and
      z["postSignalConfirmation"]==policy and z["feeBps"]==fee and z["coverExtraBps"]==slip)
      for p in paths]
    dds=[x["M5HighDDPct"] for x in rr]
    nav=[x["NAVJPY"] for x in rr]
    c=sum(x["realizedClosed"] for x in rr);w=sum(x["realizedWins"] for x in rr)
    metrics.append({"mode":mode,"confirmation":policy,"feeBps":fee,"extraCoverBps":slip,
      "paths":len(rr),"sourceNative":sum(x["sourceNative"] for x in rr),
      "sourceM5ConfirmRejected":sum(x["vetoCountAndReasons"].get("M5_CONFIRM_REJECT",0) for x in rr),
      "sourceP73Rejected":sum(x["vetoCountAndReasons"].get("P73_0_SKIP",0) for x in rr),
      "acceptedPost5M":sum(x["acceptedAfterM5"] for x in rr),
      "selectedOneSlot":sum(x["singleSlotPositions"] for x in rr),
      "selectedTrueClosed":c,"selectedWins":w,
      "winPct":round(100*w/c,4) if c else None,
      "censoredTerminalMTM":sum(x["censoredMTM"] for x in rr),
      "meanNAVJPY":round(statistics.mean(nav),2),
      "medianNAVJPY":round(statistics.median(nav),2),
      "P95DDPct":round(sorted(dds)[int(.95*(len(dds)-1))],5),
      "worstDDPct":round(max(dds),5),
      "DDOver20Paths":sum(x>20 for x in dds),
      "underStartNAVPaths":sum(x<10000 for x in nav),
      "pathsWithAnyPosition":sum(x["singleSlotPositions"]>0 for x in rr)})
 return metrics
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--index",default=str(R/"PRISM7_P84_SYNTHETIC_ASTER_BINANCE_NATIVE_SIGNAL_SOURCE_PATH_INDEX_20261122.json"))
 parser.add_argument("--label",required=True,choices=("P87_ESTABLISHED","P88_NEW_SEEDS_HOLDOUT"))
 a=parser.parse_args()
 ix=Path(a.index);index=json.loads(ix.read_text(encoding="utf8"))
 assert index["pinnedOriginalNativeSHA"]==PIN
 assert len(index["paths"])==192
 assert index["timestampPrefixInvariantAllPaths"]
 paths=[]
 for i,p in enumerate(index["paths"]):
  z=calc_path(p)
  paths.append(z)
  if (i+1)%24==0:
   print("M5_5TO15_CONFIRMED",a.label,"PATHS",i+1,
     "REGIME",z["regime"],"M5_SCORES_PASS",sum(w["postSignalAsOfM5Audit"].get("score5Pass",0) for w in paths),flush=True)
 assert len(paths)==192
 metrics=summarize(paths)
 assert len(metrics)==len(SOURCES)*len(POLICIES)*len(FEES)==60
 # Condition-free baseline5/15 parity with P85 previous ledger: same
 # schedule, market, score, gross and native STOP/exit should be exact.
 if a.label=="P87_ESTABLISHED":
  historic=R/"PRISM7_P85_SYNTHETIC_192_MARKET_PATHS_72_ECONOMICS_20261122.jsonl"
  h=[json.loads(z) for z in historic.read_text(encoding="utf8").splitlines() if z.strip()]
  assert len(h)==192
  bytag={q["tag"]:q for q in h}
  check=0
  for p in paths:
   prior=bytag[p["tag"]]
   for mode in SOURCES:
    for lag in (5,15):
     policy="BASE5_NO_CONFIRM" if lag==5 else "BASE15_NO_CONFIRM"
     for fee,slip in FEES:
      v=next(q for q in p["all60ModeGateAndPriceStress"]
        if q["mode"]==mode and q["postSignalConfirmation"]==policy and
        q["feeBps"]==fee and q["coverExtraBps"]==slip)
      prev=next(q for q in prior["perModeSizeDelayFeeEconomy"]
        if q["mode"]==mode and q["sizing"]=="P73_CONDITIONAL_HALF_OR_SKIP" and
        q["delayMin"]==lag and q["costBps"]==fee and q["extraCoverBps"]==slip)
      for key,other in (("NAVJPY","oneSlotNAVJPY"),("M5HighDDPct","oneSlotDDHighPct"),
       ("singleSlotPositions","selectedAll"),("realizedWins","selectedTrueWins"),
       ("realizedClosed","selectedTrueClosed")):
       assert abs(v[key]-prev[other])<.00005,("P87_P85_NO_GATE_PARITY",p["tag"],mode,lag,fee,slip,key,v[key],prev[other])
      check+=1
  assert check==192*4*2*3
 else:check=None
 report={"schema":"prism7-P87-P88-post-signal-M5-15M-strict-causal-score-gates-synthetic-comparison/v1",
  "status":"RESEARCH_ONLY_NO_LIVE","label":a.label,
  "sourceNativePIN":PIN,"source192IndexSHA256":sha(ix),
  "indexReproductionPath":str(ix),
  "nativeOriginalSignals":index["aggregateAllPaths"],
  "nativeSourceAndM5STOPSourceUnchanged":True,
  "gross0p25Forbidden":True,
  "grossP73OwnerConditionalHalfSkipUnmodified":True,
  "signalORSameHourDedupOneASTEROrder":True,
  "sourceM5ScoreFutureProofAt5Or15NoLookahead":True,
  "sourceM5GateFrozenBeforeIndependentSeeds":True,
  "score5Definition":"first finished +5m ASTER PENGU positive-volume M5 candle: +1 bearish candle +1 below last finished H1 close +1 upper wick >=.30 total M5 range; -2 if green body >0.4% -1 if above previous finished H1 close>0.3% -1 if drop vs finished H1 close>2.5%, >=2 to enter, else reject",
  "score15Definition":"at least two positive-volume printed M5 of first three finished bars, +1 close below earliest open +1 close below prior H1 close +1 >=2 bearish M5 +1 upper wick>=.30 range, -2 rise>0.6% -1 above prior H1 close>0.5% -1 drop>2.5%, >=2 to enter",
  "stagedDefinition":"If score5>=2 then use original P80 +5m entry; otherwise score15>=2 uses P80 +15m entry; if both fail skip; no hindsight best exit selection.",
  "timingCausal":"At H1 t close native signal, latest last complete H1 t-1. For 5m gate use M5 [t,t+5) CLOSED at t+5, enter no earlier t+5. For 15m gate use [t,t+5),[t+5,t+10),[t+10,t+15) closed, entry >=t+15. If M5 print absent fail closed.",
  "baselineP85ParityScenarioChecks":check,
  "samplesSyntheticMarketPaths":len(paths),
  "all60ModeGateCostStressAggregateEconomies":metrics,
  "all192ScenarioPerModeCausalSelectedTradeLedgerSHA256":None,
  "limits":[
   "Do not confuse 5m/15m price-action decision with merely delaying entry: equal-clock no-gate controls re-run and, for established P87, exactly match P85.",
   "P84 artificial ASTER M5 is generated separately from Binance M5 (not available). Gate is ASTER M5 only, Binance signal only as native H1 trigger.",
   "Staged decision may observe an additional 10m only after 5m fails; no future data at 5m.",
   "Source native short V20 exit & resident-stop model was computed at both fixed +5/+15 entry timestamps; those model exits are reused without any outcome-dependent change.",
   "An absence of positive M5 trades before gate time leads to missing-data rejection; no fake volume from zero bars.",
   "Same market scenarios previously inspected; new seed independent artificial holdout necessary to assess any apparent improvement, still not real market OOS.",
   "192 generated independent pseudo-seed paths do not establish future true PENGU short win80% nor account DD20% under actual spread, funding, stop signed fills.",
   "No gross0.25, no real orders or any Runner, Gross, STOP, kill switch, GitHub master changes."
  ]}
 out=R/("PRISM7_"+a.label+"_M5_5_15_CAUSAL_GATE_AND_NATIVE_STOP_20261122.json")
 tape=R/("PRISM7_"+a.label+"_M5_5_15_ALL192_PATH_TRADES_20261122.jsonl")
 tape.write_text("".join(json.dumps(z,ensure_ascii=False,separators=(",",":"))+"\n" for z in paths),encoding="utf8")
 report["all192ScenarioPerModeCausalSelectedTradeLedgerSHA256"]=sha(tape)
 report["perRegime5m30bps"]={
  regime:{mode:{policy:{"n":sum(z["realizedClosed"] for z in
      [next(x for x in p["all60ModeGateAndPriceStress"] if x["mode"]==mode and x["postSignalConfirmation"]==policy and x["feeBps"]==30 and x["coverExtraBps"]==0)
       for p in paths if p["regime"]==regime]),
    "wins":sum(z["realizedWins"] for z in [next(x for x in p["all60ModeGateAndPriceStress"] if x["mode"]==mode and x["postSignalConfirmation"]==policy and x["feeBps"]==30 and x["coverExtraBps"]==0) for p in paths if p["regime"]==regime]),
    "avgNAV":round(statistics.mean(next(x for x in p["all60ModeGateAndPriceStress"] if x["mode"]==mode and x["postSignalConfirmation"]==policy and x["feeBps"]==30 and x["coverExtraBps"]==0)["NAVJPY"] for p in paths if p["regime"]==regime),2)}
     for policy in POLICIES} for mode in ("BINANCE_TO_ASTER","EITHER_OR_ASTER_ONCE")}
   for regime in sorted(set(x["regime"] for x in paths))}
 out.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 focus=[x for x in metrics if x["mode"]=="EITHER_OR_ASTER_ONCE" and x["feeBps"]==30]
 print("P87_P88_M5_5_TO_15_CAUSAL_ADMISSION_COMPLETE",a.label,
  json.dumps({"all192":len(paths),"baselineP85Parity":check,"OR":focus},ensure_ascii=False),flush=True)
 print("FILES",out,tape)
if __name__=="__main__":main()
