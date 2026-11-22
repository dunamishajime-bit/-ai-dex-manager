#!/usr/bin/env python3
"""P72 placebo risk sizing test: P71 joint BTC/ETH bull macro gross cap 0.25,
same original Native33 trade IDs, vs random same count 0.25 cap (rest 0.75).

All ASTER source entry/exit and M5 high stress unchanged. Deterministic RNG.
This is a DESCRIPTIVE permutation check over already viewed data, not proof
of predictive selection. Prices and M5 mark are from ASTER, Binance solely as
time-aligned market information. No live changes.
"""
from __future__ import annotations
import json,numpy as np,datetime,hashlib,collections,statistics
from pathlib import Path
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE,SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot
from prism7_p66_native53_multitimeframe_score_size_20261122 import replay
P71=R/"PRISM7_P71_DUAL_MARKET_SIGNED_TF_POINTS_NATIVE53_20261122.json"
P70=R/"PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_PUBLIC_ARCHIVE_MANIFEST_20261122.json"
OUT=R/"PRISM7_P72_JOINT_MACRO_CAP_VS_RANDOM_GROSS_PLACEMENT_20261122.json"
MD=R/"PRISM7_P72_JOINT_MACRO_CAP_VS_RANDOM_GROSS_PLACEMENT_20261122.md"
SEED=20261122
N=1000
M5=300000
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rnd(x,n=6):return round(float(x),n)
def precompute(book,m5,fee):
 episodes=[]
 for x in book:
  t0=x["entryTs"];end=x["exitTs"];entry=x["entryPrice"]
  vals=[];highs=[];marked=entry
  for t in range(t0,end+1,M5):
   row=m5.get(t)
   if row is None:raise ValueError("P72_SOURCE_M5_HOLE")
   if float(row[5])>0:marked=float(row[4])
   if t<end:
    v=(entry-marked)/entry-fee/10000
    h=(entry-float(row[2]))/entry-fee/10000 if float(row[5])>0 else np.nan
   else:
    v=(entry-x["exitPrice"])/entry-fee/10000
    h=np.nan
   vals.append(v);highs.append(h)
  episodes.append((np.asarray(vals,dtype=np.float64),np.asarray(highs,dtype=np.float64)))
 return episodes
def simulated(episodes,gross):
 nav=10000.;peak=nav;highdd=0.;closedd=0.
 for (close_return,high_return),g in zip(episodes,gross):
  prices=nav*(1+g*close_return)
  # source P66 peak prior to each marked M5 bar for high-risk drawdown
  priorpeak=np.maximum.accumulate(np.concatenate((np.array([peak]),prices[:-1])))
  hnav=nav*(1+g*high_return)
  if np.any(np.isfinite(hnav)):
   m=float(np.nanmax(100*(1-hnav/priorpeak)))
   highdd=max(highdd,m)
  closepeak=np.maximum.accumulate(np.concatenate((np.array([peak]),prices)))[1:]
  closedd=max(closedd,float(np.max(100*(1-prices/closepeak))))
  nav=float(prices[-1]);peak=max(peak,float(np.max(prices)))
 return (rnd(max(highdd,closedd)),round(nav,2))
def main():
 data=json.loads(P71.read_text(encoding="utf8"))
 assert data["p70Verified165PublicOfficialArchiveSHA"]
 source=data["crossVenueSourceCaseAsOfScoreLedger53"]
 bykey={z["key"]:z for z in source}
 assert len(bykey)==53 and sum(z["sourceNativeWin"] for z in source)==29
 # Must use source 33 selected chronologically by unchanged native exit and original gross
 originals=[{**z,"grossAllocation":.75,"score":z["dualSigned"]["grossSignedScore"]} for z in source]
 baseline,skipped=source_slot(originals)
 assert len(baseline)==33 and len(skipped)==20
 nMacro=sum(z["dualSigned"]["macroBullBothBTCAndEthereum"] for z in baseline)
 assert 0<nMacro<33
 macroId={i for i,z in enumerate(baseline) if z["dualSigned"]["macroBullBothBTCAndEthereum"]}
 m5,m5sha=load_m5(SOURCES)
 episodes=precompute(baseline,m5,30)
 base=[.75]*len(baseline)
 targeted=[.25 if i in macroId else .75 for i in range(len(baseline))]
 baseCheck=simulated(episodes,base);capCheck=simulated(episodes,targeted)
 canon=next(x for x in data["policyGridScenarios"] if x["policy"]=="P71_ONLY_BTC_ETH_BULL_CAP025_075" and x["feeBps"]==30 and x["extraCoverSlipBps"]==0)
 native=next(x for x in data["policyGridScenarios"] if x["policy"]=="NATIVE_075" and x["feeBps"]==30 and x["extraCoverSlipBps"]==0)
 for x,e in ((baseCheck,native),(capCheck,canon)):
  assert abs(x[0]-e["econ"]["M5HighStressDDPct"])<1e-4,(x,e["econ"]["M5HighStressDDPct"])
  assert abs(x[1]-e["econ"]["finalNAVYen"])<.01
 # Fixed-size random placement of same number of 0.25 caps
 generator=np.random.default_rng(SEED)
 dd=np.empty(N);nav=np.empty(N)
 for n in range(N):
  masked=set(int(i) for i in generator.choice(len(baseline),size=nMacro,replace=False))
  alloc=[.25 if i in masked else .75 for i in range(len(baseline))]
  y=simulated(episodes,alloc)
  dd[n]=y[0];nav[n]=y[1]
 joint=int(np.sum((dd<=capCheck[0])&(nav>=capCheck[1])))
 report={
  "schema":"prism7-p72-same33-targeted-btceth-macro-deleveraging-vs-random-size-controls/v1",
  "status":"RESEARCH_ONLY_DESCRIPTIVE_RANDOMIZATION_NOT_INDEPENDENT_OOS",
  "srcNativeV20Pin":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "sourceAster33FixedTrue":True,
  "sourceOriginalNative53PriceSignalUnchanged":True,
  "sourcePositiveM5PriceHighDDIndependentlyRecomputed":True,
  "sourceNativeBaselineParityWithP71":True,
  "sourceMacroCapParityWithP71":True,
  "sourceMarketBinancePENGUBTCETHOnlyAsOfContext":True,
  "numberOfOriginalNativeSelected33":len(baseline),
  "numberOfMacroBullActuallySelected":nMacro,
  "fractionOfOriginal33Capped":rnd(nMacro/33),
  "originalSelectedMacroNativeWinners":sum(baseline[i]["sourceNativeWin"] for i in macroId),
  "originalSelectedMacroNativeLosses":sum(not baseline[i]["sourceNativeWin"] for i in macroId),
  "originalSelectedMacroCaseDetails":[{"key":z["key"],"sourceNativeWin":z["sourceNativeWin"],
   "sourceNet30Pct":z["sourceNativeNet30Pct"],"originalNativeEntryUTC":datetime.datetime.fromtimestamp(z["entryTs"]/1000,datetime.timezone.utc).isoformat(),
   "macroScoreAtEntry":z["dualSigned"]["macroBTCEthereumSignedPoints"],
   "fullSignedScore":z["dualSigned"]["grossSignedScore"]}
     for i,z in enumerate(baseline) if i in macroId],
  "researchNormalFeeBps":30,"extraBuyCoverSlippageBps":0,
  "baseOriginal33Gross075":{"m5HighDDPct":baseCheck[0],"navJPY":baseCheck[1]},
  "macroBullGross025Else075":{"m5HighDDPct":capCheck[0],"navJPY":capCheck[1]},
  "randomControlSameReducedPositions":nMacro,
  "fixedRandomSeed":SEED,
  "numberOfRandomPlacementSamples":N,
  "randomDDPercentilesPct":{str(q):rnd(np.percentile(dd,q)) for q in (5,10,25,50,75,90,95)},
  "randomNAVPercentilesJPY":{str(q):rnd(np.percentile(nav,q),2) for q in (5,10,25,50,75,90,95)},
  "randomPlacementDDAsGoodOrLowerFraction":rnd(float(np.mean(dd<=capCheck[0]))),
  "randomPlacementNAVAsGoodOrHigherFraction":rnd(float(np.mean(nav>=capCheck[1]))),
  "randomPlacementDDandNAVJointAsGoodOrBetterFraction":rnd(float(joint/N)),
  "sourceSHA256":{"P71":sha(P71),"P70":sha(P70),"ASTER_M5":m5sha},
  "limitations":[
   "Permutation controls compare post-hoc historical risk sizing against equally sized random caps, but original Native53 has heavily viewed previous outcomes, not a hypothesis test for future alpha.",
   "Macro cap choose 0.25 and fee30bps before P72; randomization quantity same as macros actually present in fixed baseline33. Capital paths recomputed with original native M5 high stress.",
   "Risk cap macro decision is from synchronized Binance/PENGU/BTC/ETH market data and Aster BTC; correlated venue indicators can count macro effects more than once.",
   "Native source53 natural signals overlap, only original33 fixed; no additional future periods or actual exchange signed STOP fills, funding, all-runner gross or real NAV.",
   "No LIVE Runner/STOP/order/position/Gross or GitHub master changed."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 lines=["# P72 | Joint Aster + Binance BTC/ETH macro bull cap vs random risk reduction",
  "",
  "Original Native33 EXACT same position IDs and entries, per-trade gross 0.75 standard vs 0.25 for the macro-confirmed bull cases; compare random same count reduced slots (all outcomes already seen).",
  "",
  "Macro capped positions: "+str(nMacro)+"/33. Source winner count among capped: "+str(report["originalSelectedMacroNativeWinners"])+". Baseline M5 DD "+str(baseCheck[0])+"%, NAV ¥"+str(baseCheck[1])+"; targeted cap DD "+str(capCheck[0])+"%, NAV ¥"+str(capCheck[1])+".",
  "",
  "Permutation N="+str(N)+", fixed RNG seed "+str(SEED)+", equal-size random cap placement.",
  "Random med DD "+str(report["randomDDPercentilesPct"]["50"])+"%, 5–95% "+str(report["randomDDPercentilesPct"]["5"])+"–"+str(report["randomDDPercentilesPct"]["95"])+
  "%. Random med NAV ¥"+str(report["randomNAVPercentilesJPY"]["50"])+".",
  "Random capped sets with DD <= targeted: "+str(report["randomPlacementDDAsGoodOrLowerFraction"])+
  "; NAV >= targeted: "+str(report["randomPlacementNAVAsGoodOrHigherFraction"])+
  "; DD and NAV jointly as good: "+str(report["randomPlacementDDandNAVJointAsGoodOrBetterFraction"])+".",
  "",
  "THIS IS EXPLORATORY ONLY. Current historical 53 already researched, no venue signed fills or independent untouched Aster OOS. Cross-market score cannot be promoted without true fresh evidence.",""]
 MD.write_text("\n".join(lines),encoding="utf8")
 print("P72_SOURCE33_RANDOM_RISK_CAP_PERMUTATION_P71_ECONOMY_INDEPENDENT_PARITY_PASS",
  json.dumps({"n":N,"capped":nMacro,"cappedOriginalWins":report["originalSelectedMacroNativeWinners"],
   "baseDDNAV":baseCheck,"targetDDNAV":capCheck,
   "randomDDmedian":report["randomDDPercentilesPct"]["50"],
   "randomNAVmedian":report["randomNAVPercentilesJPY"]["50"],
   "randomBetterDD":report["randomPlacementDDAsGoodOrLowerFraction"],
   "randomBetterNAV":report["randomPlacementNAVAsGoodOrHigherFraction"],
   "randomBetterBoth":report["randomPlacementDDandNAVJointAsGoodOrBetterFraction"]},
   ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
