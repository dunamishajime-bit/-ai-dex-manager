#!/usr/bin/env python3
"""Q102 HIGH_VOL pretarg frozen gates vs target-one-shot/model portfolio.

Study cohort is NOT an additional untouched post-2026-10 forward sample.
The proxy 2025 source and the target venue model are different. No trading.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import Counter
from pathlib import Path

TARGET_END="2026-10-01T00:00:00Z"
def sha(p:Path):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p:Path):
 with p.open(encoding="utf-8-sig",newline="") as f:yield from csv.DictReader(f)
def check_stats(stats:dict,n:int,label:str):
 if stats["n"]!=n or n<=0 or not 0<=stats["wr"]<=1 or stats["pf"]<0:
  raise ValueError("STUDY_COHORT_INVALID:"+label)
 if not math.isclose(stats["mean"]*n,stats["sum"],abs_tol=1e-7,rel_tol=1e-10):
  raise ValueError("STUDY_RETURN_SUM_INCONSISTENT:"+label)
 return {"n":n,"winRatePct":100*stats["wr"],"profitFactor":stats["pf"],"mean":stats["mean"],
  "sum":stats["sum"]}
def source_case(study:dict,context:dict,structure:dict):
 if study.get("status")!="Q102_HIGHVOL_GENERIC_PRETARGET_FROZEN_ONLINE_SHADOW_HEALTH_RESEARCH_ONLY":
  raise ValueError("HIGHVOL_ONLINE_SOURCE_STATUS_DRIFT")
 if study.get("frozenPolicy")!={"lookbackDays":90,"minN":5,"pfMax":0.6}:
  raise ValueError("HIGHVOL_PRETARGET_FROZEN_POLICY_DRIFT")
 if (context.get("status")!="Q102_HIGHVOL_PREDEFINED_STRUCTURAL_HYPOTHESIS_FALSIFICATION" or
    structure.get("status")!="Q102_HIGHVOL_STRUCTURAL_PRETARGET_TRAIN_VALID_PREHOLD_ONE_SHOT_TARGET"):
  raise ValueError("STRUCTURAL_SOURCE_STATUS_UNKNOWN")
 hashes=[x.get("hashes") for x in (study,context,structure)]
 if len({json.dumps(x,sort_keys=True) for x in hashes})!=1:
  raise ValueError("Q102_HIGHVOL_SHARED_TARGET_PROXY_SOURCE_HASH_DRIFT")
 if set(hashes[0])!={"pre","target"} or any(len(x)!=64 for x in hashes[0].values()):
  raise ValueError("HIGHVOL_PRETARGET_SOURCE_HASH_MISSING")
 pre=study["pretarget"];target=study["targetOneShot"]
 cohorts={}
 for label,part,nbase,nadmitted,nblocked in (
  ("pretarget",pre,202,138,64),("targetOneShot",target,18,15,3)):
  if part["blockedN"]!=nblocked or part["admittedN"]!=nadmitted:
   raise ValueError("HIGHVOL_PRETARGET_ADMISSION_COUNTS_DRIFT:"+label)
  if part["baseline"]["n"]!=part["admitted"]["n"]+part["blockedShadow"]["n"]:
   raise ValueError("HIGHVOL_COHORT_BREAKDOWN_BROKEN:"+label)
  cohorts[label]={z:check_stats(part[z],n,z+"_"+label)
    for z,n in (("baseline",nbase),("admitted",nadmitted),("blockedShadow",nblocked))}
 if len(study["targetBlocked"])!=3:
  raise ValueError("HIGHVOL_TARGET_BLOCKED_POPULATION_INVALID")
 blocked_sig=set()
 for x in study["targetBlocked"]:
  if x["id"] in blocked_sig:raise ValueError("HIGHVOL_BLOCKED_ID_DUPLICATE")
  blocked_sig.add(x["id"])
  if not x["id"].startswith("HIGH_VOL:ONDOUSDT:") or x["symbol"]!="ONDOUSDT" or x["side"]!=1:
   raise ValueError("HIGHVOL_BLOCKED_SYMBOL_OR_DIRECTION_CHANGED")
  health=x["health"]
  if health["n"]!=5 or health["pf"]>=.6 or x["entryTs"]<=1759276800000 or x["entryTs"]>=1790812800000:
   raise ValueError("HIGHVOL_SHADOW_HEALTH_OUTSIDE_FROZEN_POLICY")
 if not(cohorts["pretarget"]["admitted"]["winRatePct"]<
        cohorts["pretarget"]["baseline"]["winRatePct"] and
        cohorts["targetOneShot"]["admitted"]["winRatePct"]<
        cohorts["targetOneShot"]["baseline"]["winRatePct"]):
  raise ValueError("HIGHVOL_ONLINE_GATE_LOSS_OF_QUALITY_PATTERN_DRIFT")
 if len(context["hypotheses"])!=4 or context["qualifiedPretarget"]!=["PULLBACK_IN_14D_TREND"]:
  raise ValueError("HIGHVOL_CONTEXT_PREDEFINED_HYPOTHESES_CHANGED")
 if sum(bool(x["qualifiesPretarget"]) for x in context["hypotheses"])!=1:
  raise ValueError("HIGHVOL_PRETARGET_CONTEXT_QUALIFIED_COUNT_DRIFT")
 qual=context["hypotheses"][0]
 if qual["name"]!="PULLBACK_IN_14D_TREND" or qual["targetOneShot"]["n"]!=0:
  raise ValueError("HIGHVOL_STRUCTURAL_CONTEXT_TARGET_POPULATION_DRIFT")
 if (structure["candidateRules"]!=150 or structure["robustRules"]!=0 or
    structure["selectedPretargetOnly"] is not None or
    structure["targetOneShot"] is not None):
  raise ValueError("HIGHVOL_NO_SURVIVING_STRUCTURAL_GATE_NOT_PROVEN")
 if context["costBps"]!=30 or structure["costBps"]!=30:
  raise ValueError("HIGHVOL_COST_RESEARCH_NOT_30BPS")
 return {"frozenOnlinePolicy":study["frozenPolicy"],"proxyAndTargetSourceHashes":hashes[0],
  "cohorts":cohorts,"targetBlockedCount":3,
  "targetBlockedIsAllONDO":True,
  "targetBlockedShadowWinRatePct":cohorts["targetOneShot"]["blockedShadow"]["winRatePct"],
  "pretargQualifiedStructuralContextCount":1,
  "qualifyingContextTargetOneShotSignals":0,
  "structuralThresholdCandidateRules":150,
  "structuralRulesSurvivedPretarget":0,
  "onlineFrozenPolicyImprovesBaselineOnTarget":False,
  "noTargetYearRetuningPermitted":True}
def portfolio(folder:Path,bps:int):
 files=list(folder.glob(f"*_{bps}BPS_FILLS.csv"))
 if len(files)!=1:raise ValueError("INTEGRATED_PORTFOLIO_FILLS_FILE_UNIQUE_REQUIRED")
 hits=[];p=files[0]
 for x in rows(p):
  if x["strategy"]!="Q102" or not x["route"].startswith("HIGH_VOL|"):continue
  if x["signed_execution_verified"]!="False" or x["actual_venue_order_id"]:
   raise ValueError("PORTFOLIO_MODEL_FILL_WRONGLY_LABELED_VENUE")
  if not x["entry_utc"]<x["exit_utc"]<=TARGET_END:
   raise ValueError("PORTFOLIO_Q102_HIGHVOL_TIME_INVALID")
  n=float(x["net_pnl_jpy"])
  if not math.isfinite(n):raise ValueError("HIGHVOL_NET_RETURN_NONFINITE")
  hits.append({"symbol":x["symbol"],"side":x["side"],
    "entryUtc":x["entry_utc"],"exitUtc":x["exit_utc"],
    "route":x["route"],"netModelJpy":n})
 if len(hits)!={10:6,30:7}[bps]:
  raise ValueError("SOURCE_MODEL_PORTFOLIO_HIGHVOL_ADMISSION_COUNT_DRIFT")
 c=Counter(x["symbol"] for x in hits)
 return {"bps":bps,"admittedModeledFills":len(hits),
     "bySymbol":dict(sorted(c.items())),
     "wins":sum(x["netModelJpy"]>0 for x in hits),
     "losses":sum(x["netModelJpy"]<0 for x in hits),
     "modeledNetJpy":sum(x["netModelJpy"] for x in hits),
     "mustNotMapOneToOneOntoTarget18CandidateShadow":True,
     "sourceHash":sha(p),"fills":hits}
def build(study:dict,context:dict,structure:dict,folder:Path):
 source=source_case(study,context,structure)
 return {"schema":"bt481-q102-highvol-frozen-shadow-postmortem/v1",
  "status":"Q102_HIGHVOL_ONLINE_WORSENS_TARGET_18_AND_POSTTARGET_FORWARD_NOT_PROVEN",
  "source":source,"integratedModeledFills":{str(b):portfolio(folder,b) for b in (10,30)},
  "oneShot18IsNotSameAsNative19Candidates":True,
  "separatePost20261001ForwardPopulationAvailable":False,
  "sourceNativeQ102CurrentPinFullEconomicParityProven":False,
  "noProductionEconomicUpdates":True,"productionMutations":0}
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for q in ("study","context","structure","case-dir","output"):
  p.add_argument("--"+q,required=True,type=Path)
 a=p.parse_args()
 d=build(json.loads(a.study.read_text("utf8")),
       json.loads(a.context.read_text("utf8")),
       json.loads(a.structure.read_text("utf8")),a.case_dir)
 d["sourceFileSha256"]={k:sha(getattr(a,k)) for k in ("study","context","structure")}
 a.output.write_text(json.dumps(d,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
 print(json.dumps({"status":d["status"],
  "pretarget":d["source"]["cohorts"]["pretarget"],
  "target":d["source"]["cohorts"]["targetOneShot"],
  "portfolio":{k:{"n":v["admittedModeledFills"],"losses":v["losses"]}
   for k,v in d["integratedModeledFills"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
