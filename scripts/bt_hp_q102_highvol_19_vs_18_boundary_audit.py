#!/usr/bin/env python3
"""Q102 native 19 HIGH_VOL candidate ledger vs 18 settled before period end.

Avoid falsely comparing closed-only target shadow (18) with native 19
signals. Member-level identity of all 15 online-admitted target rows is not
available; cardinality match does NOT establish that complete population.
"""
from __future__ import annotations
import argparse,hashlib,json,csv,math
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path

START_MS=1759276800000
END_MS=1790812800000
EXPECTED_OPEN_ID="HIGH_VOL:SUIUSDT:1790650800000"
EXPECTED_ENTRY_MS=1790654400000
def sha(p:Path):return hashlib.sha256(p.read_bytes()).hexdigest()
def jlines(path:Path):
 out=[]
 for line in path.read_text("utf8").splitlines():
  if line.strip():out.append(json.loads(line))
 return out
def signal_bucket(start_ms,end_ms,entry,exit):
 if not START_MS<=entry<END_MS or exit<=entry:
  raise ValueError("NATIVE_HIGHVOL_SIGNAL_BOUNDS_INVALID")
 return "CLOSED_BEFORE_END" if exit<END_MS else "OPEN_AT_END"
def verify(sigs:list,exits:list,base:list,study:dict):
 if len(sigs)!=19 or len(exits)!=19 or len(base)!=19:
  raise ValueError("NATIVE_HIGHVOL_SOURCE_COHORT_NOT_19")
 def uniq(data):
  mapped={}
  for x in data:
   k=x["id"]
   if k in mapped:raise ValueError("DUPLICATE_NATIVE_HIGHVOL_SIGNAL_ID")
   mapped[k]=x
  return mapped
 a,b,c=map(uniq,(sigs,exits,base))
 if set(a)!=set(b) or set(a)!=set(c):
  raise ValueError("NATIVE_HIGHVOL_SIGNAL_EXIT_POPULATION_DRIFT")
 typ=Counter();sym=Counter();unclosed=[];completed={}
 for k,v in a.items():
  if v["family"]!="HIGH_VOL" or v["layer"]!="S1" or v["requestedGross"] not in (.6,1.):
   raise ValueError("NATIVE_HIGHVOL_PIN_CANDIDATE_SCHEMA_CHANGED")
  if v["entryTs"]-v["dataCutoffTs"]!=3600000 or v["entryTs"]<=v["dataCutoffTs"]:
   raise ValueError("NATIVE_SIGNAL_LOOKAHEAD_OR_TS_DRIFT")
  x=b[k];y=c[k]
  for field in ("entryTs","symbol","side"):
   if x[field]!=v[field] or y[field]!=v[field]:
    raise ValueError("NATIVE_SIGNAL_EXIT_OR_BASE_IDENTITY_DRIFT")
  if y["sourceRuntimeSha"]!="ef1ab178e26a7bf5bddb6473467765edba242e1d":
   raise ValueError("NATIVE_Q102_RELEASE_PIN_CHANGED")
  entry=int(v["entryTs"]);end=int(x["exitTs"])
  outcome=signal_bucket(START_MS,END_MS,entry,end)
  if outcome=="OPEN_AT_END":
   if y.get("status")!="RIGHT_CENSORED_PERIOD_END" or "exitTs" in y or "exitPrice" in y:
    raise ValueError("RIGHT_CENSORED_NATIVE_EXIT_WRONGLY_REALIZED")
  elif int(y["exitTs"])!=end or not math.isclose(y["exitPrice"],x["exitPrice"],rel_tol=1e-12):
   raise ValueError("PINNED_VS_BASE_EXIT_DRIFT")
  typ[outcome]+=1;sym[v["symbol"]]+=1
  if outcome=="OPEN_AT_END":
   unclosed.append({"id":k,"symbol":v["symbol"],"entryMs":entry,
         "modeledExitAfterEndMs":end,"exitReason":x["exitReason"]})
  else:completed[k]=v
 if (typ!=Counter({"CLOSED_BEFORE_END":18,"OPEN_AT_END":1}) or
    sym!=Counter({"ONDOUSDT":10,"SUIUSDT":7,"ARBUSDT":2})):
  raise ValueError("CLOSED_VS_OPEN_SOURCE_CANDIDATE_TOTAL_DRIFT")
 if (len(unclosed)!=1 or unclosed[0]["id"]!=EXPECTED_OPEN_ID or
    unclosed[0]["entryMs"]!=EXPECTED_ENTRY_MS):
  raise ValueError("TERMINAL_OPEN_SUI_ID_CHANGED")
 one=study["targetOneShot"]
 if (one["baseline"]["n"]!=18 or one["admittedN"]!=15 or one["blockedN"]!=3
   or len(study["targetBlocked"])!=3):
  raise ValueError("CLOSED_TARGET_SHADOW_18_COHORT_DRIFT")
 blocked={x["id"] for x in study["targetBlocked"]}
 if len(blocked)!=3 or not blocked.issubset(completed):
  raise ValueError("TARGET_SHADOW_BLOCKED_ROWS_NOT_CLOSED_NATIVE_IDS")
 return {"totalNativeSignals":19,"nativeClosedExitsBeforeStudyEnd":18,
   "nativeOpenAtStudyEnd":1,"openAtStudyEnd":unclosed[0],
   "sourceSymbolCounts":dict(sorted(sym.items())),
   "shadowStudyTargetBaseline":one["baseline"]["n"],
   "shadowStudyTargetBlockedIdsInNativeClosedSet":3,
   "shadowStudyTargetAdmitted":15,
   "shadowAll15AdmittedIdsMemberwiseProven":False,
   "shadowAndNativeSignalsSameMemberCohortProven":False,
   "sourceFixedYearEndExclusive":True}
def isodate(epoch):
 return datetime.fromtimestamp(epoch/1000,timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def portfolio_terminal(folder:Path,bps:int,open_signal:dict):
 def source(suffix):
  p=list(folder.glob(f"*_{bps}BPS_{suffix}"))
  if len(p)!=1:raise ValueError("PORTFOLIO_CASE_NOT_UNIQUE")
  return p[0]
 utc=isodate(open_signal["entryMs"])
 entries=[]
 with source("MODEL_ENTRIES.csv").open(encoding="utf-8-sig",newline="") as f:
  for x in csv.DictReader(f):
   if x["logic"]=="Q102" and x["symbol"]=="SUIUSDT" and x["route"]=="HIGH_VOL|SUIUSDT" and x["utc"]==utc:
    entries.append(x)
 if len(entries)!=1 or entries[0]["side"]!="LONG":
  raise ValueError("OPEN_SUI_NATIVECANDIDATE_NOT_MODEL_ADMITTED")
 tid=entries[0]["trade_id"]
 with source("FILLS.csv").open(encoding="utf-8-sig",newline="") as f:
  fills=[r for r in csv.DictReader(f) if r["trade_id"]==tid]
 if fills:raise ValueError("OPEN_SUI_WRONGLY_ASSIGNED_REALIZED_MODEL_FILL")
 manifest=json.loads((folder/"RUN_MANIFEST.json").read_text("utf8"))
 row=[r for r in manifest["results"] if r["cost_bps_roundtrip"]==bps]
 if len(row)!=1:raise ValueError("MANIFEST_COST_MISSING")
 openrows=row[0]["terminal_open_positions"]
 if (len(openrows)!=1 or openrows[0]["symbol"]!="SUIUSDT" or
     openrows[0]["route"]!="HIGH_VOL|SUIUSDT" or
     openrows[0]["entry_utc"]!=utc):
  raise ValueError("TERMINAL_OPEN_MANIFEST_SOURCE_DRIFT")
 return {"bps":bps,"terminalModelEntrySourceSignalId":entries[0]["source_signal_id"],
   "terminalModelEntryUtc":utc,"terminalModelFillCount":0,
   "sourceManifestOpenCount":row[0]["terminal_open_count"],
   "notAnExecutedOrClosedExchangeTrade":True}
def build(folder:Path,signals:Path,exits:Path,base:Path,study_path:Path):
 result=verify(jlines(signals),jlines(exits),jlines(base),
     json.loads(study_path.read_text("utf8")))
 return {"schema":"bt481-q102-highvol-19-signal-18-settled-boundary/v1",
  "status":"Q102_NATIVE_19_SIGNAL_18_CLOSED_ONE_OPEN_PERIOD_END_EXPLAINED",
  "candidateCoverage":result,
  "integratedTerminalByCost":{str(b):portfolio_terminal(folder,b,result["openAtStudyEnd"]) for b in (10,30)},
  "sourcesSha256":{k:sha(v) for k,v in (("signals",signals),("exits",exits),("baseExits",base),("shadowStudy",study_path))},
  "frozenOnlineGateEconomicallyApproved":False,"productionMutations":0}
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ("case-dir","signals","exits","base","study","output"):
  p.add_argument("--"+name,type=Path,required=True)
 a=p.parse_args();d=build(a.case_dir,a.signals,a.exits,a.base,a.study)
 a.output.write_text(json.dumps(d,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
 print(json.dumps({"status":d["status"],"candidate":d["candidateCoverage"],
   "terminal":d["integratedTerminalByCost"]},ensure_ascii=False))
if __name__=="__main__":main()
