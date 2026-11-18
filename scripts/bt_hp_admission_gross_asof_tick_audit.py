#!/usr/bin/env python3
"""Audit pre-entry modeled Gross at each 5m tick vs cumulatively admitted requests.

Model equity/Gross samples are before same-tick entries. Pre-existing MTM
overshoots remain distinct from a NEW entry creating an overshoot.
This is NOT signed exchange order or production admission verification.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import Counter,defaultdict
from pathlib import Path

CAPS={"crypto":3.0,"stock":1.5,"total":3.5}
EXPECT_ENTER={10:1025,30:1026}
EXPECT_TICKS={10:842,30:845}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):
 with p.open(encoding="utf-8-sig",newline="") as f:yield from csv.DictReader(f)
def num(x):
 try:v=float(x)
 except (ValueError,TypeError):raise ValueError("NON_NUMERIC_GROSS")
 if not math.isfinite(v):raise ValueError("NONFINITE_GROSS")
 return v
def check_requested(pre:dict,requested:dict,tol:float=1e-7)->dict:
 if set(pre)!=set(CAPS) or set(requested)!={"crypto","stock"}:
  raise ValueError("GROSS_PROVENANCE_FIELDS_INCOMPLETE")
 if any(num(v)<0 for v in (*pre.values(),*requested.values())):
  raise ValueError("NEGATIVE_GROSS")
 if abs(pre["total"]-pre["crypto"]-pre["stock"])>tol:
  raise ValueError("BASE_GROSS_CATEGORY_INCONSISTENT")
 after={"crypto":pre["crypto"]+requested["crypto"],
         "stock":pre["stock"]+requested["stock"],
         "total":pre["total"]+sum(requested.values())}
 before_over={k:pre[k]>lim+tol for k,lim in CAPS.items()}
 after_over={k:after[k]>lim+tol for k,lim in CAPS.items()}
 fresh=[k for k in CAPS if after_over[k] and not before_over[k]]
 exacerbated=[k for k in CAPS if before_over[k] and after[k]>pre[k]+tol]
 return {"freshBreaches":fresh,
   "alreadyOverCap":sorted(k for k in CAPS if before_over[k]),
   "admittedIncreaseToAlreadyOverCap":exacerbated,
   "after":after}
def files(folder:Path,bps:int,suffix:str)->Path:
 found=list(folder.glob(f"*_{bps}BPS_{suffix}"))
 if len(found)!=1:raise ValueError("CASE_SOURCE_FILE_NOT_UNIQUE:"+suffix)
 return found[0]
def audit_case(folder:Path,bps:int)->dict:
 if bps not in EXPECT_ENTER:raise ValueError("UNSUPPORTED_COST_CASE")
 eq={}
 p=files(folder,bps,"EQUITY_30MIN.csv")
 for r in rows(p):
  t=r["utc"]
  if t in eq:raise ValueError("DUPLICATE_EQUITY_SNAPSHOT")
  vals={k:num(r[k+"_gross_x"]) for k in CAPS}
  if abs(vals["total"]-vals["crypto"]-vals["stock"])>1e-7:
   raise ValueError("GROSS_CATEGORIES_SOURCE_SUM_INVALID")
  if r["daily_gate_block"] not in ("False","True"):
   raise ValueError("INVALID_SHARED_GATE_RECORD")
  eq[t]={"gross":vals,"gate":r["daily_gate_block"]=="True"}
 if len(eq)!=105121:raise ValueError("YEARLY_EQUITY_5M_SNAPSHOT_COUNT_DRIFT")
 ticks=defaultdict(list);nenter=0;blocked=0;all_signals=set()
 d=files(folder,bps,"DECISIONS.csv")
 for r in rows(d):
  sig=r["signal_id"];t=r["utc"]
  if not sig or sig in all_signals:raise ValueError("DUPLICATE_CANDIDATE_ID")
  all_signals.add(sig)
  if t not in eq:raise ValueError("ENTRY_NOT_ON_MTM_SOURCE_SNAPSHOT")
  if r["decision"]=="BLOCK":
   blocked+=1;continue
  if r["decision"]!="MODEL_ENTER":raise ValueError("DECISION_UNKNOWN")
  if eq[t]["gate"]:raise ValueError("MODEL_ENTER_DURING_DAILY_LOSS_GATE")
  gross=num(r["requested_gross"])
  if gross<=0:raise ValueError("REQUESTED_GROSS_NOT_POSITIVE")
  group="stock" if r["strategy"]=="V52" else "crypto"
  ticks[t].append({"strategy":r["strategy"],"sourceSignalId":sig,
    "gross":gross,"category":group})
  nenter+=1
 if nenter!=EXPECT_ENTER[bps] or len(ticks)!=EXPECT_TICKS[bps]:
  raise ValueError("ADMISSION_COHORT_COUNT_DRIFT")
 counts=Counter();maxsim=0;bad=[]
 for t,items in ticks.items():
  maxsim=max(maxsim,len(items))
  requested={"crypto":sum(x["gross"] for x in items if x["category"]=="crypto"),
             "stock":sum(x["gross"] for x in items if x["category"]=="stock")}
  chk=check_requested(eq[t]["gross"],requested)
  for cat in chk["alreadyOverCap"]:counts["existingMtm_"+cat]+=1
  for cat in chk["freshBreaches"]:counts["freshAdmissionBreach_"+cat]+=1
  for cat in chk["admittedIncreaseToAlreadyOverCap"]:counts["increaseAlreadyBreached_"+cat]+=1
  counts["multipleAdmissions"]+=len(items)>1
  if chk["freshBreaches"] or chk["admittedIncreaseToAlreadyOverCap"]:
   bad.append({"utc":t,"sourceBeforeGross":eq[t]["gross"],"requests":items,
               "breaches":chk["freshBreaches"],"exacerbated":chk["admittedIncreaseToAlreadyOverCap"]})
 if bad:
  raise ValueError("SOURCE_ADMISSION_MODEL_GROSS_BREACH:"+json.dumps(bad[:2]))
 return {"bps":bps,"modeledEnterCount":nenter,"modelBlockedCount":blocked,
  "entryTickCount":len(ticks),"ticksWithConcurrentAdmission":counts["multipleAdmissions"],
  "maxConcurrentSameTick":maxsim,
  "preexistingStockMtmOverCapAtCryptoEntry":counts["existingMtm_stock"],
  "preexistingCryptoMtmOverCapAtEntry":counts["existingMtm_crypto"],
  "preexistingTotalMtmOverCapAtEntry":counts["existingMtm_total"],
  "freshOverCapAfterCumulativeAdmission":0,
  "newAdmissionIncreasedAnAlreadyBreachedCategory":0,
  "venueOrderPriceOrPositionRiskCertified":False,
  "originalSourceDecisionOrderWithinTickCertifiable":False,
  "sourceSha256":{"decisions":sha(d),"equity":sha(p)}}
def build(folder:Path)->dict:
 manifest=json.loads((folder/"RUN_MANIFEST.json").read_text("utf8"))
 if manifest.get("status")!="STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY":
  raise ValueError("RESEARCH_MANIFEST_SOURCE_UNKNOWN")
 return {"schema":"disdex-bt-source-admission-gross-cap-tick-audit/v1",
  "status":"MODEL_ADMISSION_GROSS_CUMULATIVE_VALID_EXISTING_MTM_OVERRUNS_NOT_ORDERS",
  "cases":{str(b):audit_case(folder,b) for b in (10,30)},
  "sameTickPreEntrySnapshotOrderSourceConfirmed":True,
  "fullLiveGrossGateAndPositionParityCertified":False,
  "productionMutations":0}
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--case-dir",type=Path,required=True)
 p.add_argument("--output",type=Path,required=True)
 a=p.parse_args();d=build(a.case_dir)
 a.output.write_text(json.dumps(d,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
 print(json.dumps({"status":d["status"],
   "cases":{b:{"entries":x["modeledEnterCount"],"multiTicks":x["ticksWithConcurrentAdmission"],
      "alreadyStockMTMOver":x["preexistingStockMtmOverCapAtCryptoEntry"],
      "freshBreach":x["freshOverCapAfterCumulativeAdmission"]}
      for b,x in d["cases"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
