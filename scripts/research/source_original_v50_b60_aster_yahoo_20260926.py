#!/usr/bin/env python3
"""Use pinned ORIGINAL V50 research's build_raw_trades with CURRENT V50 B60/C20/STOP1.75.

Aster 30m and Yahoo 60m public OHLC open snapshots are NOT the LIVE bid/ask,
depth, per-second pre-entry snapshot, post-only order or fill. Research-only
historical candidate envelope; the unchanged frozen original engine is not
modified. Exclude missing source rows; no ffill across stock sessions.
"""
import argparse, collections, datetime as dt, gzip, hashlib, json, pathlib
from zoneinfo import ZoneInfo
import research_lab_aster_only_v50_post_open_basis_engine as native_v50

NY=ZoneInfo("America/New_York")
START=dt.datetime(2025,8,10,tzinfo=dt.timezone.utc).timestamp()*1000
END=dt.datetime(2026,8,10,tzinfo=dt.timezone.utc).timestamp()*1000
H=3600000; HALF=H//2
RAW_SHA="8e416fe25a9c9e722c428062589151bbd0d8dda4fc98ed4bdb53154a9fe3d7fe"
MARKS=[(11,30),(12,30),(13,30),(14,30),(15,30)]
STOCKS=["AMZNUSDT","METAUSDT","MSFTUSDT","NVDAUSDT","TSLAUSDT"]
EXPECTED_POLICY={"minimumEntryBasisBps":60,"convergenceBps":20,"basisStopMultiple":1.75,
 "maximumHoldingHours":3,"maximumRoundTripCostBps":60,"minimumNetEdgeBps":7.5}
def load_json(p):return json.loads(pathlib.Path(p).read_text())
def build_market(payload):
 market=payload["market"]; aster={}; yahoo={}
 for symbol in STOCKS:
  aster[symbol[:-4]]={int(row[0]):row for row in market["stockAster30m"][symbol]
   if START-30*86400000 <= int(row[0])<END}
  reference=market["yahooCash60m"][symbol]
  stamps=reference["timestamp"]; quotes=reference["indicators"]["quote"][0]
  yahoo[symbol[:-4]]={int(ts)*1000:{"o":quotes["open"][i],"c":quotes["close"][i]}
   for i,ts in enumerate(stamps)
   if quotes["open"][i] is not None and quotes["close"][i] is not None}
 return aster,yahoo
def source_aligned(aster,yahoo):
 all_dates=set()
 for bars in yahoo.values():
  for ts in bars:
   day=dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).astimezone(NY)
   if (day.hour,day.minute)==(11,30):all_dates.add(day.date())
 aligned={s:{} for s in aster};kept=[];reject=collections.Counter()
 for day in sorted(all_dates):
  if day.weekday()>=5:continue
  if not (dt.date(2025,8,10)<=day<dt.date(2026,8,10)):continue
  ts=[int(dt.datetime.combine(day,dt.time(h,m),NY).timestamp()*1000) for h,m in MARKS]
  observations={}
  for sym in STOCKS:
   s=sym[:-4];p=aster[s];c=yahoo[s];rows=[];refs=[]
   for t in ts:
    bar=p.get(t);prior=p.get(t-HALF);cash=c.get(t);cash_prior=c.get(t-H)
    if not bar or not prior or not cash or not cash_prior:break
    entry=float(bar[1]);pre=float(prior[4]);ref=float(cash["o"]);prev=float(cash_prior["c"])
    if min(entry,pre,ref,prev)<=0:break
    # 30m prior close / preceding CASH completed H1 close is signal proxy,
    # while 30m/60m current OPENs are opening-entry proxy; no future OHLC.
    signal_basis=(pre/prev-1)*10000
    rows.append({"basisBps":signal_basis,"signalBasisBps":signal_basis,
       "exit":entry,"exitTs":t,"asterVolumeAtOpenBar":float(bar[5])})
    refs.append({"cash":ref,"timestamp":t})
   if len(rows)!=len(ts):reject["MISSING_ALIGNED_HISTORY"]+=1;break
   observations[s]={"day":day.isoformat(),"checkpoints":rows,
     "cash":{"checkpoints":refs},"perp":{"fundingPoints":[]}}
  if len(observations)!=len(STOCKS):reject["MISSING_STOCKS_AT_DAY"]+=1;continue
  # Day is usable only when all 5 source stocks align at every checkpoint.
  for sym,row in observations.items():aligned[sym][day.isoformat()]=row
  kept.append(day.isoformat())
 return kept,aligned,dict(reject)
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--source",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();raw=gzip.decompress(pathlib.Path(a.source).read_bytes())
 sha=hashlib.sha256(raw).hexdigest()
 if sha!=RAW_SHA:raise RuntimeError("UNVERIFIED_CURRENT_INDEPENDENT_SOURCE_SHA:"+sha)
 data=json.loads(raw)
 if data.get("vpsSha")!="e1b58060d6263a3af7ced51bec854d3e211d2f35":
  raise RuntimeError("CURRENT_VPS_SOURCE_MISMATCH")
 src=pathlib.Path("config/v52V50Runtime.json")
 cfg=json.loads(src.read_text())
 for key,value in EXPECTED_POLICY.items():
  key2={"minimumEntryBasisBps":"minimumEntryBasisBps","convergenceBps":"convergenceBps",
    "basisStopMultiple":"basisStopMultiple","maximumHoldingHours":"maximumHoldingHours",
    "maximumRoundTripCostBps":"maximumRoundTripCostBps","minimumNetEdgeBps":"minimumNetEdgeBps"}[key]
  if cfg.get(key2)!=value:raise RuntimeError("CURRENT_V50_POLICY_DRIFT:"+key)
 if cfg["policyId"]!="V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20":
  raise RuntimeError("CURRENT_V50_POLICY_ID_DRIFT")
 # Import ORIGINAL research functions from 2026-09-18 STOCK source checkout.
 native_v50.CONVERGENCE_BPS=cfg["convergenceBps"]
 native_v50.BASIS_STOP_MULTIPLE=cfg["basisStopMultiple"]
 candidate=native_v50.Candidate("POST_EARLY3__B60__H3__BOTH__NONE",
    "POST_EARLY3",60.,3,"BOTH",False)
 aster,yahoo=build_market(data);days,aligned,gaps=source_aligned(aster,yahoo)
 if len(days)<190:raise RuntimeError("STOCK_ALIGNED_DAYS_INSUFFICIENT:"+str(len(days)))
 raw_trades=native_v50.build_raw_trades(candidate,days,aligned)
 for trade in raw_trades:
  if trade["entryTs"]<START or trade["entryTs"]>=END:raise RuntimeError("STOCK_TRADE_WINDOW_INVALID")
  trade["liveNativeFillVerified"]=False
  trade["historicalSignalSource"]="PREVIOUS_COMPLETED_30M_ASTER_PREVIOUS_COMPLETED_YAHOO_H1"
  trade["historicalEntrySource"]="ASTER_30M_OPEN_YAHOO_60M_OPEN"
  trade["historicalBookSpreadAndDepthVerified"]=False
  trade["historicalFundingVerified"]=False
  trade["estimatedNetEdgeAt40Bps"]=trade["edgeProxyBps"]-40
  trade["estimatedCostGateAt40Bps"]=trade["estimatedNetEdgeAt40Bps"]>=7.5
  # Source-native LIVE post-only book liquidity, clock skew and open-order checks
  # are unobservable in historical OHLC, so these are not executable accepted fills.
  t=int(trade["entryTs"]);sym=trade["symbol"]
  trade["asterEntry30mVolume"]=float(aster[sym][t][5])
  trade["historicalLiquidityUnknown"]=trade["asterEntry30mVolume"]<=0
 output=pathlib.Path(a.output);output.mkdir(parents=True,exist_ok=True)
 (output/"current-v50-b60-raw-price-candidates.json").write_text(json.dumps(raw_trades,ensure_ascii=False,indent=2))
 report={"schema":"original-stock-v50-research-current-B60-price-only/v1",
  "originalResearchFunction":"research_lab_aster_only_v50_post_open_basis_engine::build_raw_trades",
  "stockResearchRef":"04c1a369223bd27e9e42bc93604b3777b9230d92",
  "currentVpsRef":data["vpsSha"],"marketSha256":sha,"policyId":cfg["policyId"],
  "alignedDays":len(days),"rawPriceCandidates":len(raw_trades),
  "cost40CandidateCount":sum(t["estimatedCostGateAt40Bps"] for t in raw_trades),
  "zeroVolumeCandidateCount":sum(t["historicalLiquidityUnknown"] for t in raw_trades),
  "missingReferenceDays":gaps,"syntheticMissingRows":0,
  "nativeCurrentV52ProductionFillsVerified":False,
  "formalFiveLogicBTCompleted":False,
  "qualifications":["B60/C20/STOP1.75 gross candidate construction calls original V50 research code, not a newly devised exit.",
    "Cash 60m and Aster 30m opens proxy real-time bid/ask at NY 11:30/12:30/13:30.",
    "Prior 30m and completed Yahoo H1 proxy 10-second pre-entry signal; cannot verify live spread<=20, depth>=2x, costs, reference staleness, maker fills or 5x cross.",
    "Aster stock funding not in input archive; set empty for price-only research; not source-exact live trade net return.",
    "Raw candidates are not actual admitted portfolio positions."] }
 (output/"summary.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print("ORIGINAL_RESEARCH_B60_SOURCE_PRICE_ONLY",json.dumps({k:report[k] for k in
  ("alignedDays","rawPriceCandidates","cost40CandidateCount","zeroVolumeCandidateCount",
   "nativeCurrentV52ProductionFillsVerified","formalFiveLogicBTCompleted")}),flush=True)
if __name__=="__main__":main()
