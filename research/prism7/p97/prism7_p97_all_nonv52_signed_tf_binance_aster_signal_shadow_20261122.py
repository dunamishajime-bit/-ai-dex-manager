#!/usr/bin/env python3
"""P97: all DisDex non-V52 crypto signal native Aster vs Binance signed
W/D/12H/4H/1H score BEFORE entry, with negative points, directional polarity,
and macro/venue disagreement penalty. PENGU is scored in SHADOW ONLY and
its formally selected Binance V20->Aster M5 entry is not changed.
No candidate native entry, STOP or exit mutated here. No real order.
Binance official SHA verified via P96 315 ZIPs and prior P70 165 ZIPs.
Research 2025-10-01 .. 2026-10-01 source tapes are OLDER research pin,
not current Production Stable4. Only completed candles, no lookahead.
"""
from __future__ import annotations
import json,hashlib,gzip,datetime,bisect,collections,math,statistics
from pathlib import Path
from prism7_p66_native53_multitimeframe_score_size_20261122 import aggregates,state_at,TF_HOURS
from prism7_p71_aster_binance_signed_multitf_entry_points_20261122 import macro_direction
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
WORK=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
N=R/"native-new-signal-20251001-20261001"
BIN=WORK/"p96_non_v52_binance_verified"/"verified_h1"
BIN_OLD=WORK/"p70_binance_same_aster_period_202507_202611"/"verified_series"
P96=WORK/"results"/"PRISM7_P96_NONV52_ALL_SOURCES_BINANCE_USDM_H1_202507_202610_OFFICIAL_SHA_MANIFEST_20261122.json"
P70=WORK/"results"/"PRISM7_P70_BINANCE_ASTER_COMMON_PERIOD_PUBLIC_ARCHIVE_MANIFEST_20261122.json"
OUT=WORK/"results"/"PRISM7_P97_ALLRUNNER_NONV52_WEEK_D_12H_4H_1H_AST_BIN_SIGNED_SCORE_SHADOW_20261122.json"
TAPE=WORK/"results"/"PRISM7_P97_ALLRUNNER_2715_RAW_CANDIDATE_ASOF_BINANCE_AST_SIGNED_SCORE_20261122.jsonl"
H=3600000
START=1759276800000;END=1790812800000
W_ASTER={"W":5,"D":4,"12H":3,"4H":2,"1H":1}
W_BINANCE={"W":3,"D":2,"12H":2,"4H":1,"1H":1}
POLICIES=(
 "NO_FILTER",
 "ASTER_NONNEGATIVE",
 "BINANCE_NONNEGATIVE",
 "DUAL_NONNEGATIVE",
 "DUAL_SOFT_NEGATIVE_VETO",
 "DUAL_RISK_AWARE",
 "DUAL_STRICT"
)
FAMILIES=("V4","Q102","IDLE","FET","HYPE","RESIDUAL","PENGU")
ALL=("AAVEUSDT","ADAUSDT","NEARUSDT","DOGEUSDT","SOLUSDT","XRPUSDT","BNBUSDT",
 "AVAXUSDT","INJUSDT","LINKUSDT","ATOMUSDT","LTCUSDT","FETUSDT","APTUSDT",
 "UNIUSDT","RENDERUSDT","JUPUSDT","TIAUSDT","TAOUSDT","DOTUSDT","HYPEUSDT",
 "BTCUSDT","ETHUSDT","PENGUUSDT")
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def jlines(p):
 with Path(p).open(encoding="utf8") as f:
  for line in f:
   if line.strip():yield json.loads(line)
def date(ts):return datetime.datetime.fromtimestamp(ts/1000,datetime.timezone.utc).isoformat()
def load_gz(p):
 with gzip.open(p,"rt",encoding="utf8") as f:
  out=[]
  for line in f:
   if not line.strip():continue
   z=json.loads(line)
   t=int(z[0])
   if t<END:
    out.append({"time":t,"open":float(z[1]),"high":float(z[2]),
       "low":float(z[3]),"close":float(z[4]),"volume":float(z[5])})
  return out
def cache(rows):
 return {tf:(a,[v["end"] for v in a]) for tf in TF_HOURS
  for a in [aggregates(rows,tf)]}
def trend(tc,t):
 return {tf:state_at(*tc[tf],t) for tf in TF_HOURS}
def signed(trends,weights,direction):
 scores={}
 for tf,w in weights.items():
  a=trends[tf]
  sig=(1 if (a["known"] and a["trend"]==("UP" if direction=="LONG" else "DOWN"))
       else -1 if (a["known"] and a["trend"]==("DOWN" if direction=="LONG" else "UP"))
       else 0)
  scores[tf]=w*sig
 return scores
def gate(policy,feat):
 a=feat["asterScore"];b=feat["binanceScore"];c=feat["combinedScore"]
 weekly=feat["asterWDKnown"] and feat["binanceWDKnown"]
 if policy=="NO_FILTER":return True
 if policy=="ASTER_NONNEGATIVE":return feat["asterWDKnown"] and a>=0
 if policy=="BINANCE_NONNEGATIVE":return feat["binanceWDKnown"] and b>=0
 if policy=="DUAL_NONNEGATIVE":return weekly and a>=0 and b>=0 and c>=0
 if policy=="DUAL_SOFT_NEGATIVE_VETO":return weekly and a>=-3 and b>=-2 and c>=-3
 if policy=="DUAL_RISK_AWARE":
  return weekly and a>=0 and b>=0 and c>=3 and not feat["weeklyVenueConflict"]
 if policy=="DUAL_STRICT":
  return weekly and a>=4 and b>=2 and c>=8 and not feat["weeklyVenueConflict"]
 raise ValueError(policy)
def candidate_inputs():
 z=[]
 tape_sources={}
 def tag(family,sym,route,side,entry,cid,price=None,exitp=None,exitts=None,originalsha=None):
  assert START<=entry<END and side in ("LONG","SHORT")
  z.append({"id":cid,"strategy":family,"symbol":sym,"route":route,"side":side,
   "entryTs":entry,"originalEntryPrice":price,"originalExitPrice":exitp,"originalExitTs":exitts,
   "pinSHA":originalsha,"sourceModelNativeExitAvailable":exitp is not None})
 raw_v4=N/"native-V4-raw-intentions.jsonl"
 v4=list(jlines(raw_v4));v4life={q["id"]:q for q in jlines(R/"V4_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"v4-exits.jsonl")}
 assert len(v4)==len(v4life)==1394
 for i,s in enumerate(v4,1):
  key=f"V4_{i:05d}";e=v4life[key]
  assert s["entryTs"]==e["entryTs"] and s["symbol"]==e["symbol"] and s["route"]==e["route"]
  tag("V4",s["symbol"],s["route"],e["side"],int(s["entryTs"]),key,float(e["entryPrice"]),float(e["exitPrice"]),int(e["exitTs"]),s.get("source_runtime_sha"))
 q102=list(jlines(R/"Q102_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"q102-exits.jsonl"))
 assert len(q102)==205
 for i,s in enumerate(q102,1):
  # The original 205 Q102 native exit IDs contain gaps. The P92 strict replay
  # reindexes those 205 rows sequentially as Q102S34_00001..00205.
  # Preserve exact source row ordering for 1:1 P98 identity/parity.
  tag("Q102",s["symbol"],s["route"],s["side"],int(s["entryTs"]),f"Q102S34_{i:05d}",float(s["entryPrice"]),float(s["exitPrice"]),int(s["exitTs"]),s.get("sourceRuntimeSha"))
 for family in ("IDLE","FET"):
  p=N/f"native-{family}-raw-intentions.jsonl"
  rows=list(jlines(p))
  native=json.loads((N/f"native-{family}-all-intent-modeled-5m-exit-audit.json").read_text(encoding="utf8"))["trades"]
  pool=collections.defaultdict(list)
  for q in native:pool[(q["entryTs"],q["symbol"],q["route"])].append(q)
  assert len(rows)==len(native)
  for i,s in enumerate(rows,1):
   cand=pool[(s["entryTs"],s["symbol"],s["route"])]
   assert cand
   e=cand.pop(0)
   tag(family,s["symbol"],s["route"],s["side"],int(s["entryTs"]),f"{family}_{i:05d}",
    float(e["entryPrice"]),float(e["exitPrice"]),int(e["exitTs"]),s.get("source_runtime_sha"))
 residual=list(jlines(N/"native-RESIDUAL-raw-intentions.jsonl"));assert len(residual)==728
 for i,s in enumerate(residual,1):
  tag("RESIDUAL",s["symbol"],s["route"],s["side"],int(s["entryTs"]),f"RESIDUAL_{i:05d}",
    None,None,None,s.get("source_runtime_sha"))
 hype=json.loads((R/"hype-aster-historical"/"hype-trend-pinned-candidates.json").read_text(encoding="utf8"))
 assert len(hype)==78
 for i,s in enumerate(hype,1):
  ts=int(s["entry_ts_ms"])
  if not START<=ts<END:continue
  tag("HYPE",s["symbol"],s["route"],s["side"],ts,f"HYPE_{i:05d}",
      float(s["entry_price"]),float(s["exit_price"]),int(s["exit_ts_ms"]),s.get("source_runtime_sha"))
 pengu=list(jlines(N/"native-PENGU-raw-intentions.jsonl"));assert len(pengu)==116
 plife={q["id"]:q for q in jlines(R/"PENGU_RECOVERY_EARLY_REVERSAL_20261109"/"pengu-exits.jsonl")}
 for i,s in enumerate(pengu,1):
  key=f"PENGU_{i:05d}";q=plife[key]
  tag("PENGU",s["symbol"],s["route"],s["side"],int(s["entryTs"]),key,
      float(q["entryPrice"]),float(q["exitPrice"]),int(q["exitTs"]),s.get("source_runtime_sha"))
 assert len(z)==2715,("SOURCE_NATIVE_STRICT_V2_ALL_NON_V52",len(z))
 assert len({q["id"] for q in z})==len(z)
 return z
def main():
 p96=json.loads(P96.read_text(encoding="utf8"))
 p70=json.loads(P70.read_text(encoding="utf8"))
 assert p96["officialArchiveVerified"]==315 and not p96["errors"]
 assert p70["officialArchiveCount"]==165
 inputs=candidate_inputs()
 symbols=sorted(set(q["symbol"] for q in inputs)|{"BTCUSDT","ETHUSDT"})
 assert set(symbols)<=set(ALL)
 ac={};bc={};provenance={}; sourceQuality={}
 for sym in symbols:
  mainfile=R/"aster-public-v3-h1"/f"{sym}-1h-20250924-20261001.jsonl.gz"
  early=R/"aster-public-v3-h1-early"/f"{sym}-1h-20250301-20250924.jsonl.gz"
  if not mainfile.exists():raise ValueError("MISSING_ASTER_FULL_YEAR "+sym)
  rows=load_gz(early) if early.exists() else []
  more=load_gz(mainfile)
  if rows and rows[-1]["time"]>=more[0]["time"]:raise ValueError("EARLY_AST_OVERLAP "+sym)
  rows+=more
  assert len(rows)==len({z["time"] for z in rows})
  if not rows:raise ValueError("EMPTY_ASTER_SOURCE "+sym)
  bpath=(BIN_OLD/f"{sym}-1h-20250701-20261118-FUTURES_UM_VERIFIED.jsonl.gz"
    if sym in ("PENGUUSDT","BTCUSDT","ETHUSDT") else
    BIN/f"{sym}-1h-20250701-20261001-FUTURES_UM_VERIFIED.jsonl.gz")
  assert bpath.exists(),("MISSING_CHECKSUM_VERIFIED_BINANCE",sym)
  b=load_gz(bpath)
  assert b and b[0]["time"]<=1751328000000 and b[-1]["time"]==END-H,(sym,len(b),b[0]["time"],b[-1]["time"])
  ac[sym]=cache(rows);bc[sym]=cache(b)
  sourceQuality[sym]={"ASTER_H1":len(rows),"BINANCE_UM_H1":len(b),
   "ASTER_startTs":rows[0]["time"],"BINANCE_startTs":b[0]["time"],
   "asterSourceMissingEarlyHistory":not early.exists()}
  provenance[sym]={"AsterMainSHA":sha(mainfile),"AsterEarlySHA":sha(early) if early.exists() else None,
    "BinanceOfficialVerifiedMergedH1SHA":sha(bpath)}
  print("P97_BUILD_TF_CACHES",sym,"ASTER",len(rows),"BINANCE",len(b),flush=True)
 acBTC=ac["BTCUSDT"];bcBTC=bc["BTCUSDT"];bcETH=bc["ETHUSDT"]
 feature=[]
 originalModelWins=collections.Counter()
 for i,q in enumerate(inputs):
  ts=q["entryTs"]
  a=trend(ac[q["symbol"]],ts);b=trend(bc[q["symbol"]],ts)
  pa=signed(a,W_ASTER,q["side"]);pb=signed(b,W_BINANCE,q["side"])
  scoreA=sum(pa.values());scoreB=sum(pb.values())
  astKnown=bool(a["W"]["known"] and a["D"]["known"])
  binKnown=bool(b["W"]["known"] and b["D"]["known"])
  # Venue conflict is a distinct negative feature; do NOT mix OHLC.
  cf={tf:bool(a[tf]["known"] and b[tf]["known"] and a[tf]["trend"] in ("UP","DOWN") and
    b[tf]["trend"] in ("UP","DOWN") and a[tf]["trend"]!=b[tf]["trend"]) for tf in ("W","D")}
  penalty=-3*int(cf["W"])-2*int(cf["D"])
  # BTC 4 full weeks + 7 complete days, ETH confirms. Both directions mirrored.
  ab=macro_direction(acBTC,ts);bb=macro_direction(bcBTC,ts);be=macro_direction(bcETH,ts)
  opp="DOWN" if q["side"]=="LONG" else "UP"
  sysOpp=bool(ab["W4"]["state"]==opp and bb["W4"]["state"]==opp
          and (be["W4"]["state"]==opp or be["D7"]["state"]==opp))
  macroPen=-3 if sysOpp else 0
  feat={"asterScore":scoreA,"binanceScore":scoreB,
     "asterWeeklyDailyKnown":astKnown,"binanceWeeklyDailyKnown":binKnown,
     "asterWDKnown":astKnown,"binanceWDKnown":binKnown,
     "venueConflict":cf,"weeklyVenueConflict":cf["W"],
     "marketMacroStronglyOpposesEntry":sysOpp,
     "riskMacroPenalty":macroPen,"venueConflictPenalty":penalty,
     "combinedScore":scoreA+scoreB+penalty+macroPen,
     "pointsASTER":pa,"pointsBINANCE":pb,
     "completeAsterState":{tf:{"trend":a[tf]["trend"],"known":a[tf]["known"],
       "lastEnd":a[tf]["lastFullyCompletedEndTs"]} for tf in TF_HOURS},
     "completeBinanceState":{tf:{"trend":b[tf]["trend"],"known":b[tf]["known"],
       "lastEnd":b[tf]["lastFullyCompletedEndTs"]} for tf in TF_HOURS}}
  for st in (a,b):
   assert all(st[tf]["lastFullyCompletedEndTs"] is None or st[tf]["lastFullyCompletedEndTs"]<=ts
    for tf in TF_HOURS),("P97_CAUSAL_MARKET_FUTURE_BAR",q["id"])
  selected={policy:gate(policy,feat) for policy in POLICIES}
  if q["strategy"]=="PENGU":
   # Signed-score SHADOW for already owner-selected PENGU; P98 will not
   # disturb PENGU LONG/RECOVERY or the separately frozen V20 selection.
   selected={"NO_FILTER":True,**{k:True for k in POLICIES if k!="NO_FILTER"}}
  outcome=None
  if q["sourceModelNativeExitAvailable"]:
   price=q["originalEntryPrice"];endp=q["originalExitPrice"]
   gross_move=(endp/price-1) if q["side"]=="LONG" else (1-endp/price)
   outcome={"sourceModelNetPct30BpsBeforeGross":round(gross_move*100-.30,7),
     "sourceModelWon30Bps":gross_move*100>.3}
   originalModelWins["observed"]+=1;originalModelWins["wins"]+=int(outcome["sourceModelWon30Bps"])
  z={**q,"asOfScore":feat,"policies":selected,
    "outcome":outcome,
    "usesOnlyCompletedAsterAndBinanceCandles":True,
    "lastInputTsExclusive":ts,
    "scoreNonPENGUOnlyApplyDuringPortfolioResearch":True}
  feature.append(z)
  if (i+1)%500==0:print("P97_SCORE_EVENT",i+1,"of",len(inputs),flush=True)
 assert len(feature)==2715
 assert sum(z["strategy"]=="PENGU" for z in feature)==116
 assert sum(z["strategy"]=="HYPE" for z in feature)==78
 # Native signal-level source wins/losses are not account realized; sequential
 # portfolio must recompute account admission and funding.
 byPolicy=[]
 for fam in FAMILIES:
  a=[z for z in feature if z["strategy"]==fam]
  for policy in POLICIES:
   keep=[z for z in a if z["policies"][policy]]
   drop=[z for z in a if not z["policies"][policy]]
   win=lambda group:sum(x["outcome"] is not None and x["outcome"]["sourceModelWon30Bps"] for x in group)
   known=lambda group:sum(x["outcome"] is not None for x in group)
   byPolicy.append({"strategy":fam,"policy":policy,"sourceCandidates":len(a),
    "sourceAccepted":len(keep),"sourceBlocked":len(drop),
    "sourceModeledWinsAccepted":win(keep),"sourceModeledWinnersRejected":win(drop),
    "sourceModeledObservedAccepted":known(keep),
    "sourceModeledObservedRejected":known(drop),
    "sourceModeledWinPctAccepted":round(100*win(keep)/known(keep),2) if known(keep) else None,
    "sourceModeledWinPctBaseline":round(100*win(a)/known(a),2) if known(a) else None,
    "missingAsterWeeklyDaily":sum(not x["asOfScore"]["asterWDKnown"] for x in a),
    "missingBinanceWeeklyDaily":sum(not x["asOfScore"]["binanceWDKnown"] for x in a)})
 byRoute=[]
 routes=collections.defaultdict(list)
 for z in feature:
  if z["strategy"]=="PENGU":continue
  routes[(z["strategy"],z["route"],z["symbol"],z["side"])].append(z)
 for (fam,route,sym,side),a in routes.items():
  allWin=sum(x["outcome"] is not None and x["outcome"]["sourceModelWon30Bps"] for x in a)
  allKnown=sum(x["outcome"] is not None for x in a)
  outcomes=[]
  for p in POLICIES:
   keep=[x for x in a if x["policies"][p]]
   drop=[x for x in a if not x["policies"][p]]
   known=sum(x["outcome"] is not None for x in keep)
   win=sum(x["outcome"] is not None and x["outcome"]["sourceModelWon30Bps"] for x in keep)
   rejectwins=sum(x["outcome"] is not None and x["outcome"]["sourceModelWon30Bps"] for x in drop)
   outcomes.append({"policy":p,"retained":len(keep),"rejected":len(drop),"modeledKnown":known,
      "sourceWinPct":round(100*win/known,2) if known else None,"rejectedWinners":rejectwins})
  byRoute.append({"strategy":fam,"route":route,"symbol":sym,"side":side,
    "originalSourceCandidates":len(a),"modeledOriginalWins":allWin,
    "modeledOriginalObserved":allKnown,"originalWinPct":round(100*allWin/allKnown,2) if allKnown else None,
    "policySourceOutcomes":outcomes})
 byRoute.sort(key=lambda z:(z["strategy"],-z["originalSourceCandidates"],z["route"]))
 TAPE.write_text("".join(json.dumps(z,ensure_ascii=True,separators=(",",":"))+"\n" for z in feature),encoding="utf8")
 report={"schema":"prism7-p97-all-disDex-nonV52-signed-week-day-12h-4h-1h-Aster-and-Binance-preentry-research/v1",
  "status":"RESEARCH_ONLY_STABLE4_FULL_PORTFOLIO_GATE_PENDING",
  "officialBinanceZipSHA315Verified":True,"originalBinancePENGUBTCETHZipSHA165Verified":True,
  "totalNativeSourceCandidatesExcludingV52":len(feature),
  "sourceFamilies":dict(collections.Counter(z["strategy"] for z in feature)),
  "dataPeriodUTC":[date(START),date(END)+" excl"],
  "exactSourcePriceOnlyOutcomesNotAccountFills":True,
  "sourcePinnedExitModeledOutcomeKnown":dict(originalModelWins),
  "AsterTFWeights":W_ASTER,"BinanceTFWeights":W_BINANCE,
  "signDefinition":"Long UP positive, DOWN negative. Short DOWN positive, UP negative; 2 contiguous prior fully closed TF close-to-close changes (W Mon-UTC, D,12H,4H,1H). SIDEWAYS/UNKNOWN contribute zero; W,D unknown fail closed for applying gate.",
  "venueConflictPenalty":"Weekly opposite trend -3, Daily opposite trend -2; on the same symbol and completed UTC time",
  "systemOpposingMacroPenalty":"Weekly 4w ASTER+Binance BTC both opposite to intended Long/Short AND Binance ETH weekly or daily opposite: -3",
  "no0p25NewAllocation":True,"sourceGrossAndExitUnmodified":True,
  "userPENGUPreviouslyAdoptedV20NotOverridden":True,
  "v52NotScored":True,
  "policiesFrozenBeforeSourceOutcomeComparison":POLICIES,
  "fullCandidateSourceScoreAuditTapeSHA256":sha(TAPE),
  "sourceQualityBySymbol":sourceQuality,
  "sourceSHA256BySymbol":provenance,
  "sourceP96SHA256":sha(P96),"sourceP70SHA256":sha(P70),
  "familiesAndPoliciesSourceSignalScoreOutcome":byPolicy,
  "nativeRoutesByPolicySourceSignalScoreOutcome":byRoute,
  "nonPENGUIncludesResidualFetIdleHypeQ102V4":True,
  "limits":[
   "Original native source candidate models from 2026-11-09 strict research and old pinned SHA; production Stable4/full current Runner and H48 are not represented.",
   "Q102 uses 205 resolved native S34 selected route candidate events, not raw 519 unresolved or 2026-11-22 full current Q102.",
   "Base V4 already had 0.25 exploratory gross on a few source trades; source gross kept identical for fair experimental comparison, not a new 0.25 sizing approval.",
   "PENGU only scored for completeness and shadow, original user-selected Binance V20->ASTER+5min remains unchanged for portfolio comparison.",
   "Binance context is synchronous independent directional filter, not a replay of each nonPENGU native source generator to create Binance-only entry intents; separately study that extension before any adoption.",
   "Source outcome win/loss does not account for overlapping symbol/runner slots, funding, shared DD, gross, dynamic priority, or actual signed orders. Portfolio re-run needed.",
   "No end-of-bar lookahead: each aggregated TF state fully completed at/before entry UTC. Cross-market timestamp alignment != executable Aster fill.",
   "HYPE sparse Aster early history and any zero-volume weekly periods are UNKNOWN; dual policy fails closed when W/D unavailable.",
   "Source series SHA all official Binance and Aster; do not combine venue OHLCV prices or Binance exit with Aster order.",
   "No changes to Production, Runner, Orders, STOP, Gross or Kill Switch."]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 print("P97_ALL_NONV52_2715_NATIVE_SOURCE_DUAL_VENUE_W_D_12H_4H_1H_SCORED",
  json.dumps({"sourceFamilies":report["sourceFamilies"],
    "scorePolicy":byPolicy,
    "sourceOutcomeKnown":dict(originalModelWins),
    "results":str(OUT),"tapeSHA":report["fullCandidateSourceScoreAuditTapeSHA256"]},ensure_ascii=False)[:17000],flush=True)
 print("FILES",OUT,TAPE)
if __name__=="__main__":main()
