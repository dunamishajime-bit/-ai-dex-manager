#!/usr/bin/env python3
"""PENGU S3 CONFIRM V1 — new causal state machine: H1 structure -> M5 seller confirmation -> order-proxy -> native-reference STOP72.

Historical in-sample experimental architecture, not production, not signed fills.
All 120 P20 setups preserved, no retroactive M5 close at same-bar open.
"""
from __future__ import annotations
import argparse,csv,hashlib,json
from pathlib import Path
from collections import Counter,defaultdict
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122 import (
 H,M5,FEES,EXIT_SLIP_BPS,ENGINE,DATA_END,stop72,
 h1_source,cohort,aggregate
)
# Empty ask-book/venue fill provenance: all positive M5 open are model proxies.
NAME="PENGU_S3_CONFIRM_V1"
def rows(path):
 with Path(path).open("r",encoding="utf-8",newline="") as f:
  return list(csv.DictReader(f))
def research_confirm(cand,m5,signal_low):
 start=int(cand["intentTs"])
 end=start+2*H
 prints=[]
 observed=0
 for k in range(24):
  t=start+k*M5
  b=m5.get(t)
  if b is None:
   raise ValueError("P21_SOURCE_M5_PENDING_GAP:"+str(t))
  vol=float(b[5])
  if vol<=0:continue
  observed+=1
  prints.append((t,b))
  if len(prints)<3:continue
  trio=prints[-3:]
  if t-trio[0][0]>35*60000:continue
  total=sum(float(x[5]) for _,x in trio)
  taker=sum(float(x[9]) for _,x in trio)
  if total<=0 or taker/total>.42:continue
  if float(b[4])>signal_low*(1-.002):continue
  if float(b[4])>float(trio[-2][1][4]):continue
  end_of_bar=t+M5
  if end_of_bar>=end:continue
  # Price proxy begins only AFTER the confirming candle is fully complete.
  for h in range(k+1,24):
   fill_t=start+h*M5
   fill=m5.get(fill_t)
   if fill is None:raise ValueError("P21_SOURCE_M5_FILL_GAP:"+str(fill_t))
   if float(fill[5])>0:
    return {
      "status":"M5_SELLER_CONFIRMED_EXECUTION_PRICE_OBSERVED",
      "confirmationM5StartTs":t,"confirmationM5CloseTs":end_of_bar,
      "confirmedPriceClose":float(b[4]),
      "confirmationThreePrintsStartTs":trio[0][0],
      "confirmationThreePrintsEndTs":t,
      "confirmationTakerBuyRatio":taker/total,
      "H1StructureLowFixedAtSetup":signal_low,
      "entryProxyTs":fill_t,"entryProxyPrice":float(fill[1]),
      "entryIntentTs":start,
      "entryDelayFromSetupMin":(fill_t-start)/60000,
      "entryDelayFromConfirmCloseMin":(fill_t-end_of_bar)/60000,
      "M5SignalPriceKnownAtFillProxyTime":True,
      "withinFirst2HConfirmationExecution":True,
    }
  return {
    "status":"NO_ENTRY_PRINT_AFTER_CONFIRMED_M5_BEFORE_2H",
    "confirmationM5StartTs":t,"confirmationM5CloseTs":end_of_bar,
    "confirmationThreePrintsStartTs":trio[0][0],
    "confirmationTakerBuyRatio":taker/total,
  }
 return {
   "status":"NO_SELLER_CONFIRMATION_WITHIN_2H",
   "positiveM5PrintCountInPending":observed,
   "entryIntentTs":start,
 }

def apply_all(raw,m5,h1_by_ts):
 out=[]
 for c in raw:
  t=int(c["signalReferenceTs"])
  bar=h1_by_ts.get(t)
  if not bar:raise ValueError("P21_ORIGINAL_H1_SETUP_MISSING")
  setupLow=bar["low"]
  r=research_confirm(c,m5,setupLow)
  result={**c,"engine":NAME,"sellerState":r,
          "status":r["status"],"sourceVenueSignedFillProven":False,
          "sourceEconomicStop72ReferenceOnly":True,
          "entryProxyTs":None,"entryProxyPrice":None,
          "exitProxyTs":None,"exitProxyPrice":None,
          "exitReason":None,"entryIntentStillCounted":True}
  if r["status"]=="M5_SELLER_CONFIRMED_EXECUTION_PRICE_OBSERVED":
   exit=stop72(m5,r["entryProxyTs"],r["entryProxyPrice"])
   result.update(status=exit["status"],
      entryProxyTs=r["entryProxyTs"],entryProxyPrice=r["entryProxyPrice"],
      exitProxyTs=exit.get("exitTs"),exitProxyPrice=exit.get("exitPrice"),
      exitReason=exit.get("exitReason"),exitKind=exit.get("exitKind"),
      stopLevel=exit.get("stopLevel"),
      sameEntryM5StopTouchAmbiguous=exit.get("sameEntryM5StopTouchAmbiguous",False),
      earlyMarketSellConfirmed=True)
   if result["exitProxyTs"] is not None and result["exitProxyTs"]<result["entryProxyTs"]:
    raise ValueError("P21_SOURCE_STOP_BEFORE_FIRST_POST_CONFIRM_PRINT")
  out.append(result)
 return out

def apply_single_slot(cases):
 # Match candidate opportunity count from P20, but order by observable candidate entry time,
 # NOT by future profit, not by future exit, and never choose winner retroactively.
 statuses=[]
 engaged_until=-1
 for x in sorted(cases,key=lambda z:(
   z["entryProxyTs"] if z["entryProxyTs"] is not None else z["intentTs"]+2*H,
   z["intentTs"],z["id"])):
  y={**x}
  if y["entryProxyTs"] is not None and y["entryProxyTs"]<engaged_until:
   y.update(status="OCCUPIED_SLOT",exitProxyTs=None,exitProxyPrice=None,
      exitReason=None,opportunityWithoutSelectedExecution=True)
  elif y["entryProxyTs"] is not None:
   if y["status"]=="PRICE_PROXY_CLOSED":
    engaged_until=y["exitProxyTs"]+M5
   else:
    engaged_until=DATA_END
  statuses.append(y)
 return sorted(statuses,key=lambda z:z["intentTs"])

def calculate(rows,fee,slip,subset=None):
 item=[x for x in rows if subset(x)] if subset else rows
 a=aggregate(item,fee,slip)
 a["sourceInitialStructuralSetupsCount"]=len(item)
 a["unconfirmedSellingWithin2H"]=sum(x["status"]=="NO_SELLER_CONFIRMATION_WITHIN_2H" for x in item)
 a["confirmedNoExecutionPrint"]=sum(x["status"]=="NO_ENTRY_PRINT_AFTER_CONFIRMED_M5_BEFORE_2H" for x in item)
 a["confirmedThenOccupiedSlot"]=sum(x["status"]=="OCCUPIED_SLOT" for x in item)
 a["profitPctPointsPerAllInitialSetups"]=round(a["netProfitPctPoints"]/len(item),8) if item else None
 return a

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--p20-raw-candidates",type=Path,required=True)
 ap.add_argument("--p20-summary",type=Path,required=True)
 ap.add_argument("--pengu-h1",nargs="+",type=Path,required=True)
 ap.add_argument("--pengu-m5",nargs="+",type=Path,required=True)
 ap.add_argument("--out-summary",type=Path,required=True)
 ap.add_argument("--out-events",type=Path,required=True)
 args=ap.parse_args()
 previous=json.loads(args.p20_summary.read_text(encoding="utf-8"))
 if previous["researchEngineName"]!=ENGINE or previous["newCandidateIntentsBeforeSingleSlot"]!=120:
  raise ValueError("P21_S3_COMPARABLE_PRECOMMITMENT_MISSING")
 p,hashes=h1_source(args.pengu_h1)
 pmap={r["time"]:r for r in p}
 m5,mhash=load_m5(args.pengu_m5)
 raw=[]
 for x in rows(args.p20_raw_candidates):
  raw.append({
    "id":x["id"],"intentTs":int(x["intentTs"]),
    "signalReferenceTs":int(x["signalReferenceTs"]),
    "cohort":x["cohort"],"route":x["route"],
    "allMatchedRoutes":json.loads(x["allMatchedRoutes"]),
    "asofFeatures":json.loads(x["asofFeatures"]),
  })
 if len(raw)!=120 or len(set(x["id"] for x in raw))!=120:
  raise ValueError("P21_ORIGINAL_P20_120_SETUPS_NOT_PRESERVED")
 all_candidates=apply_all(raw,m5,pmap)
 single=apply_single_slot(all_candidates)
 if len(single)!=120 or len(all_candidates)!=120:
  raise ValueError("P21_SETUP_CANDIDATE_DROP")
 results=[]
 for group,events in [("S3_CONFIRM_ALL_STRUCTURAL_SETUPS",all_candidates),
                      ("S3_CONFIRM_SINGLE_SLOT",single)]:
  for fee in FEES:
   for slip in EXIT_SLIP_BPS:
    results.append({"group":group,"feeBps":fee,"additionalExitSlippageBps":slip,
      **calculate(events,fee,slip)})
  for name,_,_ in (
       ("PRE_2025_AUG_SEP",0,0),("BASE_2025_2026",0,0),("POST_2026_OCT_NOV",0,0)):
    results.append({"group":group,"cohort":name,"feeBps":30,
      "additionalExitSlippageBps":0,
      **calculate(events,30,0,lambda x:x["cohort"]==name)})
  for route in ("SELLER_PULLBACK_REJECTION","BREAKDOWN_RETEST_FAILURE",
                "RELATIVE_WEAKNESS_DOWNSHIFT"):
    results.append({"group":group,"route":route,"feeBps":30,
      "additionalExitSlippageBps":0,
      **calculate(events,30,0,lambda x:x["route"]==route)})
 base={a["strategyGroup"]:a for a in previous["economic"]
       if "cohort" not in a and a["feeBps"]==30 and a["additionalExitSlippageBps"]==0}
 output={
  "schema":"prism7-p21-stateful-M5-seller-confirm-S3-source120/v1",
  "researchEngineName":NAME,
  "frozenP20Engine":ENGINE,
  "originalSourceNativeV20PinnedSha":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "original120H1StructureCandidatesPreserved":len(raw),
  "p20SameReferenceStop72Comparators":base,
  "inputsSHA256":{
    "P20SourceCandidateLedger":hashlib.sha256(args.p20_raw_candidates.read_bytes()).hexdigest(),
    "P20BaselineSummary":hashlib.sha256(args.p20_summary.read_bytes()).hexdigest(),
    "penguH1":hashes,"penguM5":mhash,
  },
  "resultSummary":results,
  "allPrecommitThresholds":{
     "sellerConfirmPriceBreakLowPct":.002,
     "sellerThreePositiveM5PrintsWithinMinutes":35,
     "takerBuyVolumeRatioMax":.42,
     "maxPendingHours":2,
     "mustFillAtFirstPositiveM5AfterSignalClose":True,
     "hardStopPct":.08,"trailingActivationPct":.15,
     "trailingRetracePct":.04,"maxHoldH":72,
  },
  "limitations":[
     "120 structural setups includes no confirmations and occupied-slot cases, which cannot be counted as profitable fills.",
     "Original P20 plus source native53 data were previously inspected; P21 is exploratory in-sample not blind OOS.",
     "M5 first positive print OPEN is a proxy, not executable bid/ask, actual signed quantity or quote depth.",
     "Stop72 is a same-price-model reference overlay, not the full original pinned V20 position/phase logic.",
     "Sequence at M5 bar resolution cannot prove intrabar STOP touch vs actual market order submission.",
     "A high winrate on a small subset is not strategy edge; compare sum PnL per all 120 structural setups.",
     "No funding, multi-runner shared gross, portfolio mark-to-market DD or user Live order changes.",
  ]
 }
 args.out_summary.parent.mkdir(parents=True,exist_ok=True)
 args.out_summary.write_text(json.dumps(output,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
 with args.out_events.open("w",encoding="utf-8") as f:
  for group,items in [("S3_CONFIRM_ALL_STRUCTURAL_SETUPS",all_candidates),
                     ("S3_CONFIRM_SINGLE_SLOT",single)]:
   for x in items:
    f.write(json.dumps({"group":group,**x},ensure_ascii=False,sort_keys=True)+"\n")
 print("PRISM7_P21_S3_CONFIRMING_M5_STATE_MACHINE_PASS",
  json.dumps({z["group"]:z for z in results if "cohort" not in z and "route" not in z and
    z["feeBps"]==30 and z["additionalExitSlippageBps"]==0},ensure_ascii=False))
 print("OUT",args.out_summary,args.out_events)
if __name__=="__main__":main()
