#!/usr/bin/env python3
"""PRISM VII P22 — Alternative seller entry: failed buyer retest (Route A only).

Route B/C stay exactly P21, original 120 structural setups and P20 frozen
REFERENCE_STOP72 unchanged. Counterfactual historical research only.
"""
from __future__ import annotations
import argparse,json,hashlib
from pathlib import Path
from collections import Counter
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import (
 H,M5,DATA_END,FEES,EXIT_SLIP_BPS,stop72,h1_source,moving_ema
)
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import (
 apply_single_slot,calculate
)
NAME="PENGU_S4_FAILED_REBOUND_V1"
P20="PENGU_S3_STRUCTURE_V1"
P21="PENGU_S3_CONFIRM_V1"
ROUTE_A="SELLER_PULLBACK_REJECTION"
ROUTE_B="BREAKDOWN_RETEST_FAILURE"
ROUTE_C="RELATIVE_WEAKNESS_DOWNSHIFT"

def failed_rebound_asof(source,m5,b_by_time,b_index,b_ema):
 start=int(source["intentTs"])
 ending=start+8*H
 signal=source["signalReferenceTs"]
 close=source["signalH1Close"]
 if not close>0:raise ValueError("P22_BAD_FROZEN_H1_SIGNAL_CLOSE")
 allprints=[]
 retest_ts=None
 peak=None
 retest_price=None
 candidate_debug={"positiveM5Observed8H":0}
 for k in range(8*12):
  t=start+k*M5
  row=m5.get(t)
  if row is None:raise ValueError("P22_PENGU_M5_SOURCE_GAP:"+str(t))
  if float(row[5])<=0:continue
  allprints.append((t,row));candidate_debug["positiveM5Observed8H"]+=1
  low,high,closeM=float(row[3]),float(row[2]),float(row[4])
  if retest_ts is None:
   if high+1e-12>=close*1.015:
    retest_ts=t;peak=high;retest_price=high
   continue  # a retest high and rejection in the same M5 is NOT causally ordered.
  peak=max(peak,high)
  if len(allprints)<3:continue
  recent=allprints[-3:]
  if t-recent[0][0]>35*60000:continue
  vv=sum(float(x[5]) for _,x in recent)
  if vv<=0:continue
  buy=sum(float(x[9]) for _,x in recent)/vv
  if buy>.42:continue
  if not(closeM<=peak*(1-.0075) and
         closeM>=close*1.005 and
         closeM<float(recent[-2][1][4])):
    continue
  # BTC previous FULLY completed H1, never current hour partial close.
  btc_last_completed_open=(t//H)*H-H
  ix=b_index.get(btc_last_completed_open)
  if ix is None or ix<72:continue
  bt=b_by_time[btc_last_completed_open]
  btc_ret6=bt["close"]/b_by_time[btc_last_completed_open-6*H]["close"]-1
  if bt["close"]>b_ema[ix] or btc_ret6>0:continue
  signal_close=t+M5
  for j in range(k+1,8*12):
   fill_ts=start+j*M5
   fill=m5.get(fill_ts)
   if fill is None:raise ValueError("P22_FILL_GAP:"+str(fill_ts))
   if float(fill[5])<=0:continue
   if fill_ts<signal_close or fill_ts>=ending:
    raise ValueError("P22_FILL_BEFORE_COMPLETED_REJECTION")
   return {
     "status":"FAILED_REBOUND_REJECTION_CONFIRMED",
     "initialStructureSignalH1Close":close,
     "retestM5StartTs":retest_ts,
     "retestPeakPriceAsOfSignal":peak,
     "retestGainFromH1Close":retest_price/close-1,
     "rejectionM5StartTs":t,
     "rejectionM5ClosedTs":signal_close,
     "rejectionClose":closeM,
     "reboundFromPeakPct":100*(1-closeM/peak),
     "sellerThreeM5PositivePrintSpanMinutes":(t-recent[0][0])/60000,
     "sellerThreeM5BuyRatio":buy,
     "btcLatestCompletedH1StartTs":btc_last_completed_open,
     "btcCompleted6hReturnPct":100*btc_ret6,
     "btcCloseBelowAsOfEMA72":bt["close"]<=b_ema[ix],
     "entryProxyTs":fill_ts,
     "entryProxyPrice":float(fill[1]),
     "entryDelayFromSetupMinutes":(fill_ts-start)/60000,
     "entryFromPreviousM5PrintOpenNotSameBar":True,
     "noFutureM5UsedInEntrySignal":True,
   }
  return {
    "status":"REJECTION_CONFIRMED_NO_FUTURE_POSITIVE_PRINT_BEFORE_8H",
    "retestM5StartTs":retest_ts,
    "rejectionM5StartTs":t,
    "sellerThreeM5BuyRatio":buy,
  }
 return {
   "status": "NO_BUYER_RETEST_WITHIN_8H" if retest_ts is None
             else "RETEST_NO_VALID_REJECTION_WITHIN_8H",
   "retestM5StartTs":retest_ts,
   "positiveM5PrintCount8H":candidate_debug["positiveM5Observed8H"],
 }

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--p20-summary",type=Path,required=True)
 ap.add_argument("--p21-summary",type=Path,required=True)
 ap.add_argument("--p21-events",type=Path,required=True)
 ap.add_argument("--pengu-h1",nargs="+",type=Path,required=True)
 ap.add_argument("--btc-h1",nargs="+",type=Path,required=True)
 ap.add_argument("--pengu-m5",nargs="+",type=Path,required=True)
 ap.add_argument("--out-summary",type=Path,required=True)
 ap.add_argument("--out-events",type=Path,required=True)
 args=ap.parse_args()
 p20=json.loads(args.p20_summary.read_text(encoding="utf-8"))
 p21=json.loads(args.p21_summary.read_text(encoding="utf-8"))
 if p20["newCandidateIntentsBeforeSingleSlot"]!=120 or p20["researchEngineName"]!=P20 or p21["researchEngineName"]!=P21:
  raise ValueError("P22_PREVIOUS_FIXED_S3_SOURCE_120_MISSING")
 rows=[json.loads(x) for x in args.p21_events.read_text(encoding="utf-8").splitlines() if x.strip()]
 source=[x for x in rows if x["group"]=="S3_CONFIRM_ALL_STRUCTURAL_SETUPS"]
 if len(source)!=120 or len(set(x["id"] for x in source))!=120:
  raise ValueError("P22_P21_SOURCE120_NATURAL_CANDIDATE_PARITY_FAIL")
 p,pHash=h1_source(args.pengu_h1)
 btc,bHash=h1_source(args.btc_h1)
 if len(p)!=len(btc) or any(x["time"]!=y["time"] for x,y in zip(p,btc)):
  raise ValueError("P22_SOURCE_PENGU_BTC_H1_MISALIGNMENT")
 pmap={r["time"]:r for r in p}
 bmap={r["time"]:r for r in btc}
 bindex={r["time"]:i for i,r in enumerate(btc)}
 bema=moving_ema(btc,72)
 market,mHash=load_m5(args.pengu_m5)
 allnew=[]
 for old in source:
  result={**old,"engine":NAME}
  if old["route"]!=ROUTE_A:
   # Keep B and C P21 behavior, economics, and events EXACTLY unchanged.
   result["routeBCNativeP21ExactParity"]=True
   allnew.append(result)
   continue
  t=int(old["signalReferenceTs"])
  sig=pmap.get(t)
  if sig is None:raise ValueError("P22_P20_SIGNAL_H1_MISSING")
  template={"intentTs":old["intentTs"],"signalReferenceTs":t,
            "signalH1Close":sig["close"]}
  state=failed_rebound_asof(template,market,bmap,bindex,bema)
  result.update(sellerState=state,
    status=state["status"],entryProxyTs=None,entryProxyPrice=None,
    exitProxyTs=None,exitProxyPrice=None,exitReason=None,
    stopLevel=None,earlyMarketSellConfirmed=False,
    routeBCNativeP21ExactParity=False)
  if state["status"]=="FAILED_REBOUND_REJECTION_CONFIRMED":
   ex=stop72(market,state["entryProxyTs"],state["entryProxyPrice"])
   result.update(
     status=ex["status"],
     entryProxyTs=state["entryProxyTs"],
     entryProxyPrice=state["entryProxyPrice"],
     exitProxyTs=ex.get("exitTs"),
     exitProxyPrice=ex.get("exitPrice"),
     exitReason=ex.get("exitReason"),
     exitKind=ex.get("exitKind"),
     stopLevel=ex.get("stopLevel"),
     sameEntryM5StopTouchAmbiguous=ex.get("sameEntryM5StopTouchAmbiguous",False),
     earlyMarketSellConfirmed=True,
   )
  allnew.append(result)
 if len(allnew)!=120 or len([x for x in allnew if x["route"]==ROUTE_A])!=58:
  raise ValueError("P22_ROUTE_A_REDESIGN_DROPPED_INITIAL_STRUCTURAL_SETUP")
 single=apply_single_slot(allnew)
 if len(single)!=120:raise ValueError("P22_SINGLE_SLOT_NOT_ALL_SOURCE_SETUPS")
 aggregates=[]
 for group,arr in [("S4_ALL_CANDIDATES",allnew),("S4_SINGLE_SLOT",single)]:
  for fee in FEES:
   for slip in EXIT_SLIP_BPS:
    aggregates.append({"group":group,"feeBps":fee,"additionalExitSlippageBps":slip,
                       **calculate(arr,fee,slip)})
  for period in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV"):
   aggregates.append({"group":group,"cohort":period,
        "feeBps":30,"additionalExitSlippageBps":0,
        **calculate(arr,30,0,lambda x:x["cohort"]==period)})
  for route in (ROUTE_A,ROUTE_B,ROUTE_C):
   aggregates.append({"group":group,"route":route,
        "feeBps":30,"additionalExitSlippageBps":0,
        **calculate(arr,30,0,lambda x:x["route"]==route)})
 original_by_id={x["id"]:x for x in source if x["route"]!=ROUTE_A}
 for x in allnew:
  if x["route"]!=ROUTE_A:
   old=original_by_id[x["id"]]
   # The only differences are explicit S4 metadata, not economic state.
   for field in ("sellerState","status","entryProxyTs","entryProxyPrice",
                 "exitProxyTs","exitProxyPrice","exitReason","exitKind"):
    if x.get(field)!=old.get(field):
     raise ValueError("P22_ROUTE_BC_CHANGED_P21_STATE:"+x["id"]+":"+field)
 result={
    "schema":"prism7-p22-failed-buyer-retest-routeA-vs-frozen-P21-routeBC/v1",
    "researchEngineName":NAME,
    "originalP20H1Setups":120,
    "routeAReplacedSetups":58,
    "routeBAndCExactSourceP21Count":62,
    "pinnedOriginalV20SourceSha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
    "referenceStopHardPct":.08,
    "referenceStopTrailStartPct":.15,
    "referenceStopTrailRetracePct":.04,
    "referenceStopMaxHoldHours":72,
    "P21Comparison":[x for x in p21["resultSummary"] if x["group"]=="S3_CONFIRM_SINGLE_SLOT" and
         x["feeBps"]==30 and x["additionalExitSlippageBps"]==0 and "cohort" not in x and "route" not in x],
    "inputSHA256":{
       "P20Summary":hashlib.sha256(args.p20_summary.read_bytes()).hexdigest(),
       "P21Summary":hashlib.sha256(args.p21_summary.read_bytes()).hexdigest(),
       "P21FullOriginal120":hashlib.sha256(args.p21_events.read_bytes()).hexdigest(),
       "PENGU_H1":pHash,"BTC_H1":bHash,"PENGU_M5":mHash,
    },
    "outcomes":aggregates,
    "limitations":[
       "SOURCE historical outcomes have been observed and Route A was redesigned after P21 in-sample losses: not out-of-sample.",
       "Route A stops must be compared as all 58 candidate setups, not just selected entries with favorable returns.",
       "BTC latest completed H1 as-of M5 confirmation; no partial current BTC H1 close, no future leakage.",
       "Stop72 is common P20 comparison overlay, not native pinned SHORT V20 phase/deadline.",
       "Positive-volume M5 open is not signed fill or executable short bid/ask orderbook.",
       "Single-slot admission in execution time order, no trading live, no portfolio gross/funding/mark-to-market account DD.",
    ],
 }
 args.out_summary.parent.mkdir(parents=True,exist_ok=True)
 args.out_summary.write_text(json.dumps(result,sort_keys=True,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 with args.out_events.open("w",encoding="utf-8") as f:
  for group,z in [("S4_ALL_CANDIDATES",allnew),("S4_SINGLE_SLOT",single)]:
   for x in z:
    f.write(json.dumps({**x,"group":group},ensure_ascii=False,sort_keys=True)+"\n")
 print("PRISM7_P22_S4_FAILED_REBOUND_RESEARCH_COMPLETE",json.dumps({
  z["group"]:z for z in aggregates if z["feeBps"]==30 and z["additionalExitSlippageBps"]==0
    and "cohort" not in z and "route" not in z},ensure_ascii=False))
 print("OUT",args.out_summary,args.out_events)
if __name__=="__main__":main()
