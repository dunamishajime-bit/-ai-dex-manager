#!/usr/bin/env python3
"""Offline IDLE vNext 1x one-slot pretarget/frozen-forward verification.

No target-year fitting and no live runner size/Gross modification.
"""
from __future__ import annotations
import argparse,hashlib,json,math
from datetime import datetime,timezone
from pathlib import Path

TARGET_START=1759276800000  # 2025-10-01T00:00Z
TARGET_END=1790812800000    # 2026-10-01T00:00Z
FORWARD_END=1796083200000   # 2026-12-01T00:00Z (coverage upper guard)
SYMBOLS={"RENDERUSDT","DOTUSDT","JUPUSDT","TIAUSDT"}
def sha(p:Path)->str:return hashlib.sha256(p.read_bytes()).hexdigest()
def near(a,b):return math.isclose(float(a),float(b),abs_tol=1e-9,rel_tol=1e-9)
def read(p):return json.loads(p.read_text("utf8"))
def verify_performance(x:dict,expected_n:int,summary_name:str)->dict:
 if x["n"]!=expected_n or not 0<=x["winRate"]<=1 or x["profitFactor"]<0:
  raise ValueError("IDLE_PERFORMANCE_METRICS_POPULATION_DRIFT:"+summary_name)
 if not near(x["n"]*x["meanReturn"],x["sumReturn"]):
  raise ValueError("IDLE_PERFORMANCE_RETURN_ARITHMETIC_DRIFT:"+summary_name)
 if not -1<x["tradeCloseMaxDD"]<=0:
  raise ValueError("IDLE_DD_INVALID:"+summary_name)
 if sum(x["bySymbol"].values())!=expected_n or sum(x["bySide"].values())!=expected_n:
  raise ValueError("IDLE_COMPONENT_COUNTS_NOT_SUMMED:"+summary_name)
 return {"n":x["n"],"winRate":x["winRate"],"profitFactor":x["profitFactor"],
  "modeledCloseDDPct":x["tradeCloseMaxDD"]*100,
  "meanModeledReturn":x["meanReturn"],"symbols":x["bySymbol"],"sides":x["bySide"]}
def vnext(doc:dict)->dict:
 if doc.get("status")!="RESEARCH_ONLY_IDLE_VNEXT_CORE_1X_ONE_SLOT" or doc.get("selectionUsesTarget") is not False:
  raise ValueError("IDLE_VNEXT_SELECTION_POLICY_DRIFT")
 if doc.get("priorityRule")!="descending worst/pretarget validation mean only; never target metrics":
  raise ValueError("IDLE_VNEXT_PRETARGET_PRIORITIES_UNKNOWN")
 if doc.get("acceptedN")!=303 or doc.get("blockedN")!=352 or len(doc.get("accepted",[]))!=303:
  raise ValueError("IDLE_VNEXT_ADMITTED_BLOCKED_SET_DRIFT")
 components=doc.get("components",{})
 if set(components)!=SYMBOLS or set(doc.get("componentSignalCounts",{}))!=SYMBOLS:
  raise ValueError("IDLE_VNEXT_COMPONENT_SET_CHANGED")
 if (components["RENDERUSDT"]["side"]!="SHORT" or
     components["DOTUSDT"]["side"]!="LONG" or
     components["JUPUSDT"]["kind"]!="online" or
     components["TIAUSDT"]["kind"]!="online"):
  raise ValueError("IDLE_VNEXT_DIRECTION_OR_ONLINE_COMPONENT_CHANGED")
 total=sum(v["signalsTarget"]+v["signalsForward"] for v in doc["componentSignalCounts"].values())
 if total!=doc["acceptedN"]+doc["blockedN"]:
  raise ValueError("IDLE_VNEXT_CANDIDATE_DEDUPE_COUNT_DRIFT")
 accepted=doc["accepted"];nTarget=nForward=0;srcTarget={};srcForward={}
 prev=None
 for event in accepted:
  entry=event["entryTs"];leave=event["exitTs"]
  if not isinstance(entry,int) or not isinstance(leave,int) or entry>=leave:
   raise ValueError("IDLE_VNEXT_ENTRY_EXIT_TIME_INVALID")
  if prev is not None and entry<prev:
   raise ValueError("IDLE_VNEXT_ENTRY_NOT_MONOTONIC")
  prev=entry
  if (event["symbol"] not in SYMBOLS or event["side"] not in ("LONG","SHORT") or
      event["source"] not in ("ASTER","GAP")):
   raise ValueError("IDLE_VNEXT_ADMITTED_SOURCE_INVALID")
  if TARGET_START<=entry<TARGET_END:
   nTarget+=1;srcTarget[event["source"]]=srcTarget.get(event["source"],0)+1
  elif TARGET_END<=entry<FORWARD_END:
   nForward+=1;srcForward[event["source"]]=srcForward.get(event["source"],0)+1
  else:raise ValueError("IDLE_VNEXT_ADMISSION_OUTSIDE_FROZEN_STUDY")
 if (nTarget,nForward)!=(270,33):
  raise ValueError("IDLE_VNEXT_TARGET_FORWARD_ADMISSION_DRIFT")
 totals={}
 for bps in (10,30):
  totals[str(bps)]={"target":verify_performance(doc["target"+str(bps)],270,f"TGT{bps}"),
                    "forward":verify_performance(doc["forward"+str(bps)],33,f"FWD{bps}")}
 return {"admitted303":len(accepted),"blocked352":doc["blockedN"],
     "modelTargetN":nTarget,"modelForwardN":nForward,
     "targetSourceKinds":srcTarget,"forwardSourceKinds":srcForward,
     "oneSlotResearchNotProductionOrderSizing":True,
     "componentKinds":{k:{"kind":v["kind"],"side":v.get("side")} for k,v in components.items()},
     "modelPerformance":totals}
def online_confirm(doc:dict)->dict:
 if (doc.get("status")!="RESEARCH_ONLY_IDLE_ALL5P_ONLINE_CONFIRMATION_GATE" or
     doc.get("selectionUsesTarget") is not False):
  raise ValueError("IDLE_ALL5P_CAUSAL_GATE_PROVENANCE_DRIFT")
 if len(doc["rows"])!=218:raise ValueError("IDLE_ALL5P_CANDIDATE_COHORT_DRIFT")
 for bps in (10,30):
  base=doc["baseline"+str(bps)];conf=doc["confirmed"+str(bps)]
  if base!=conf or base["n"]!=218:raise ValueError("IDLE_ALL5P_ONLINE_GATE_NOT_NOOP")
 for symbol,count in (("JUPUSDT",66),("TIAUSDT",65)):
  s=doc["summary"][symbol]
  if s!={"fixedN":count,"coveredN":count,"confirmN":count,"opposeN":0}:
   raise ValueError("IDLE_ALL5P_ONLINE_OPPOSITE_CONFIRMATION_CHANGED")
 return {"selectedResearchModelFills":218,"jupConfirmedNoOpposition":66,
      "tiaConfirmedNoOpposition":65,"targetModelFillsBlockedByOnline":0,
      "onlineGateFailedToModifyTargetOutcomes":True}
def pretarg_stops(doc:dict)->dict:
 if (doc.get("status")!="RESEARCH_ONLY_IDLE_V3_UNIFORM_STOP_PRETARGET_SELECTED" or
    doc.get("selectionUsesTarget") is not False):
  raise ValueError("IDLE_STOP_PRETARGET_SELECTION_POLICY_DRIFT")
 if doc.get("qualifyingPretarget")!=6 or len(doc["topPretargetFrozen"])!=6:
  raise ValueError("IDLE_UNIFORM_STOPS_COHORT_DRIFT")
 if len(doc.get("stopsTested",[]))!=7:
  raise ValueError("IDLE_UNIFORM_STOPS_GRID_MISSING")
 options=[];seen=set()
 for row in doc["topPretargetFrozen"]:
  stops=row["stops"];values=set(stops.values())
  if set(stops)!=SYMBOLS or len(values)!=1:
   raise ValueError("IDLE_UNIFORM_STOP_NOT_SAME_FOR_ALL")
  val=next(iter(values))
  if val in seen:raise ValueError("IDLE_DUPLICATE_FROZEN_STOP")
  seen.add(val)
  for seg in ("E1","E2","E3"):
   x=row["pre30"][seg]
   if x["n"]<=0 or not near(x["sum"],x["n"]*x["mean"]):
    raise ValueError("IDLE_FROZEN_PRETARGET_METRIC_DRIFT")
  f=row["FORWARD30"];t=row["TARGET30"]
  if f["n"]<=0 or t["n"]<=0:
   raise ValueError("IDLE_FROZEN_STOP_TARGET_FORWARD_MISSING")
  options.append({"uniformStop":val,"targetN":t["n"],"targetWinRate":t["wr"],
    "targetMean":t["mean"],"forwardN":f["n"],"forwardWinRate":f["wr"],
    "forwardMean":f["mean"],"pickedByForward":False})
 return {"pretargetQualified":len(options),"frozenRank1UniformStop":options[0]["uniformStop"],
     "targetOrForwardBestThresholdNotSelected":True,"frozenOptions":options}
def build(core:dict,online:dict,stop:dict)->dict:
 c=vnext(core);o=online_confirm(online);s=pretarg_stops(stop)
 if s["frozenRank1UniformStop"] is not None:
  raise ValueError("IDLE_FROZEN_PRETARGET_RANK1_CHANGED")
 if (not near(c["modelPerformance"]["30"]["target"]["winRate"],s["frozenOptions"][0]["targetWinRate"]) or
    not near(c["modelPerformance"]["30"]["forward"]["winRate"],s["frozenOptions"][0]["forwardWinRate"])):
  raise ValueError("IDLE_VNEXT_UNIFORM_NO_STOP_AND_CORE_CASE_DISAGREE")
 return {"schema":"bt481-idle-vnext-one-slot-online-forward-audit/v1",
     "status":"IDLE_ONE_X_FORWARD_SMALL_SAMPLE_NO_INTEGRATED_DD20_CERTIFICATION",
     "vnextCore":c,"all5pOnlineConfirmation":o,"pretargetUniformStops":s,
     "targetYearUsedToSelectThresholds":False,
     "forwardPeriodUsedToChooseBestThreshold":False,
     "fullPortfolioSharedGrossAndSTOPCertified":False,
     "sourcePinCurrentLiveCertified":False,
     "productionMutations":0}
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for x in ("core","online","stops","output"):
  p.add_argument("--"+x,type=Path,required=True)
 a=p.parse_args();d=build(read(a.core),read(a.online),read(a.stops))
 d["sourceSha256"]={x:sha(getattr(a,x)) for x in ("core","online","stops")}
 a.output.write_text(json.dumps(d,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
 print(json.dumps({"status":d["status"],
     "target30":d["vnextCore"]["modelPerformance"]["30"]["target"],
     "forward30":d["vnextCore"]["modelPerformance"]["30"]["forward"],
     "onlineOppositeBlocks":d["all5pOnlineConfirmation"]["targetModelFillsBlockedByOnline"]},ensure_ascii=False))
if __name__=="__main__":main()
