#!/usr/bin/env python3
"""Q102 HIGH_VOL native-candidate -> integrated admission/exit audit (offline).

Account for ALL 19 source candidates (not just losing fills). Decision and
fill status is model-only. Target-year losses cannot choose a production gate.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from datetime import datetime,timezone
from collections import Counter,defaultdict
from pathlib import Path

SOURCE_SHA="ef1ab178e26a7bf5bddb6473467765edba242e1d"
SYMBOLS={"ARBUSDT","SUIUSDT","ONDOUSDT"}
START=1759276800000;END=1790812800000  # UTC: 2025-10-01, 2026-10-01

def digest(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
def source_candidates(path:Path)->dict:
    allrows=[json.loads(line) for line in path.read_text("utf8").splitlines() if line.strip()]
    if len(allrows)!=224:raise ValueError("Q102_ADOPTED_ON_RAW_COHORT_DRIFT")
    candidates={};ids=set()
    for i,row in enumerate(allrows,1):
        if not str(row.get("route","")).startswith("HIGH_VOL"):continue
        cid=f"Q102P_{i:05d}"
        sid=row.get("productionV4SourceSignalId")
        if cid in candidates or not sid or sid in ids:raise ValueError("HIGH_VOL_DUPLICATE_SOURCE_SIGNAL")
        ids.add(sid)
        if (row["symbol"] not in SYMBOLS or row["route"]!="HIGH_VOL|"+row["symbol"]
            or row["strategy"]!="Q102_CAUSAL_V4" or row["sourceRuntimeSha"]!=SOURCE_SHA
            or row["family"]!="HIGH_VOL" or row["layer"]!="S1"
            or row["side"] not in ("LONG","SHORT")):
            raise ValueError("HIGH_VOL_PINNED_NATIVE_IDENTITY_DRIFT")
        t=int(row["entryTs"]);e=int(row["exitTs"])
        if not START<=t<e<END+72*3600000:raise ValueError("HIGH_VOL_CANDIDATE_OUTSIDE_PERIOD")
        if float(row["entryPrice"])<=0 or float(row["exitPrice"])<=0:raise ValueError("INVALID_CANDIDATE_PRICE")
        if row["requestedGross"] not in (0.6,1.0):raise ValueError("HIGH_VOL_GROSS_POLICY_DRIFT")
        candidates[cid]={
          "symbol":row["symbol"],"side":row["side"],"route":row["route"],
          "entryTs":t,"exitTs":e,"entryPrice":float(row["entryPrice"]),
          "exitPrice":float(row["exitPrice"]),"gross":float(row["requestedGross"]),
          "nativeCandidateId":row["id"],
          "productionSignalId":sid,
          "priceAdverse":float(row["exitPrice"])<float(row["entryPrice"])
              if row["side"]=="LONG" else float(row["exitPrice"])>float(row["entryPrice"])
        }
    if len(candidates)!=19:raise ValueError("HIGH_VOL_NATIVE_CANDIDATES_NOT_19")
    if Counter(r["symbol"] for r in candidates.values())!=Counter({"ARBUSDT":2,"SUIUSDT":7,"ONDOUSDT":10}):
        raise ValueError("HIGH_VOL_RAW_SYMBOL_COVERAGE_DRIFT")
    return candidates
def iso_ms(t:int)->str:
    return datetime.fromtimestamp(t/1000,timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def audit_case(candidates:dict,decisions_path:Path,entries_path:Path,fills_path:Path,bps:int)->dict:
    if bps not in (10,30):raise ValueError("UNKNOWN_COST_MODEL")
    decisions={}
    with decisions_path.open(encoding="utf-8-sig",newline="") as f:
      for row in csv.DictReader(f):
        key=row["signal_id"]
        if key not in candidates:continue
        if key in decisions:raise ValueError("DUPLICATE_HIGH_VOL_DECISION")
        ref=candidates[key]
        if row["strategy"]!="Q102" or row["utc"]!=iso_ms(ref["entryTs"]):
            raise ValueError("HIGH_VOL_DECISION_SOURCE_TIME_DRIFT")
        if not math.isclose(float(row["requested_gross"]),ref["gross"],abs_tol=1e-12):
            raise ValueError("HIGH_VOL_DECISION_GROSS_DRIFT")
        decision=row["decision"]
        if decision not in ("MODEL_ENTER","BLOCK"):raise ValueError("UNKNOWN_DECISION_TYPE")
        if decision=="MODEL_ENTER" and row["reason"]!="MODELED_EXIT_NOT_VENUE_FILL":
            raise ValueError("HIGH_VOL_MODEL_ADMISSION_REASON_DRIFT")
        decisions[key]={"decision":decision,"reason":row["reason"]}
    if set(decisions)!=set(candidates):raise ValueError("MISSING_SOURCE_HIGH_VOL_DECISIONS")
    entries={}
    with entries_path.open(encoding="utf-8-sig",newline="") as f:
      for row in csv.DictReader(f):
        if row["logic"]!="Q102" or not row["route"].startswith("HIGH_VOL"):continue
        key=row["source_signal_id"]
        if key not in candidates or key in entries:raise ValueError("UNEXPECTED_OR_DUPLICATE_HIGH_VOL_ADMISSION")
        ref=candidates[key]
        if (row["route"]!=ref["route"] or row["symbol"]!=ref["symbol"] or
           row["side"]!=ref["side"] or row["utc"]!=iso_ms(ref["entryTs"]) or
           row["source_runtime_sha"]!=SOURCE_SHA or
           not math.isclose(float(row["entry_gross_x"]),ref["gross"],abs_tol=1e-12)):
            raise ValueError("HIGH_VOL_ADMISSION_SOURCE_PIN_DRIFT")
        entries[key]=row
    accepted={k for k,v in decisions.items() if v["decision"]=="MODEL_ENTER"}
    if set(entries)!=accepted:raise ValueError("HIGH_VOL_ADMISSIONS_NOT_MATCH_DECISIONS")
    # Compare model fills by matching the research source signal ID, not
    # position trade ID (the latter changes with portfolio case).
    fills={}
    with fills_path.open(encoding="utf-8-sig",newline="") as f:
      for row in csv.DictReader(f):
        if row["strategy"]!="Q102" or not row["route"].startswith("HIGH_VOL"):continue
        key=row["source_signal_id"]
        if key not in accepted or key in fills:raise ValueError("HIGH_VOL_FILL_NOT_ADMITTED_OR_DUPLICATE")
        if (row["actual_venue_order_id"] or row["actual_filled_quantity"] or
           row["signed_execution_verified"]!="False"):
            raise ValueError("HIGH_VOL_MODEL_PRETENDS_VENUE_FILL")
        r=candidates[key]
        if row["route"]!=r["route"] or row["symbol"]!=r["symbol"] or row["side"]!=r["side"]:
            raise ValueError("HIGH_VOL_FILL_IDENTITY_DRIFT")
        pnl=float(row["net_pnl_jpy"])
        if not math.isfinite(pnl):raise ValueError("HIGH_VOL_NONFINITE_MODEL_PNL")
        fills[key]={"netPnlJpy":pnl,"exitUtc":row["exit_utc"],
             "modelExitReason":row["exit_model_reason"],
             "priceAdverse":float(row["model_exit_price"])<float(row["model_entry_price"])
              if row["side"]=="LONG" else float(row["model_exit_price"])>float(row["model_entry_price"])}
    open_until_period_end={k for k in accepted if candidates[k]["exitTs"]>=END}
    if set(fills)!=accepted-open_until_period_end:
        raise ValueError("HIGH_VOL_ADMITTED_WITHOUT_CLOSED_OR_VERIFIED_OPEN_MODEL_POSITION")
    by_symbol={}
    for symbol in sorted(SYMBOLS):
        subset=[k for k,v in candidates.items() if v["symbol"]==symbol]
        on=[k for k in subset if k in accepted]
        blocked=[k for k in subset if k not in accepted]
        vals=[fills[k] for k in on if k in fills]
        still_open=[k for k in on if k in open_until_period_end]
        by_symbol[symbol]={
          "nativeCandidates":len(subset),"modeledAdmissions":len(on),
          "modeledClosed":len(vals),"openAtModelPeriodEnd":len(still_open),
          "blocked":len(blocked),"modelWins":sum(x["netPnlJpy"]>0 for x in vals),
          "modelLosses":sum(x["netPnlJpy"]<0 for x in vals),
          "adverseModeledPriceMoves":sum(x["priceAdverse"] for x in vals),
          "modelNetPnlJpy":sum(x["netPnlJpy"] for x in vals),
          "blockedReasons":dict(Counter(decisions[k]["reason"] for k in blocked))
        }
    return {
      "costBps":bps,"nativeCandidates":len(candidates),"modeledAdmissions":len(accepted),
      "modeledBlocked":len(candidates)-len(accepted),
      "modeledClosed":len(fills),
      "openAtModelPeriodEnd":len(open_until_period_end),
      "openCandidateIdsAtEnd":sorted(open_until_period_end),
      "bySymbol":by_symbol,
      "blockedReasons":dict(Counter(decisions[k]["reason"] for k in candidates if k not in accepted)),
      "sourceDecisionAudit":[{"candidate":k,"symbol":candidates[k]["symbol"],
          "nativeTime":iso_ms(candidates[k]["entryTs"]),**decisions[k],
          "modeledNetPnlJpy":fills[k]["netPnlJpy"] if k in fills else None}
         for k in candidates]
    }
def compare(candidates:dict,ten:dict,thirty:dict)->dict:
    if ten["nativeCandidates"]!=19 or thirty["nativeCandidates"]!=19:
        raise ValueError("MISSING_HIGH_VOL_COHORT")
    return {"schema":"disdex-bt-q102-highvol-source-decision-audit/v1",
      "status":"FULL_CANDIDATE_DECISION_COVERAGE_NO_INDEPENDENT_OOS_CERTIFICATION",
      "sourceCandidateCount":len(candidates),
      "sourceSymbolCandidates":dict(Counter(x["symbol"] for x in candidates.values())),
      "10bps":ten,"30bps":thirty,
      "targetYearFitAllowed":False,
      "independentPretargetOutOfSampleVerification":False,
      "nativeEntryBuilder19Of19SeparateAuditOnly":True,
      "signedVenueFillsCertified":False,
      "modelGrossNotActualVenueQuantity":True,
      "productionChanges":0}
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source",required=True,type=Path)
    for bp in ("10","30"):
      for suffix in ("decisions","entries","fills"):
        ap.add_argument("--"+suffix+bp,required=True,type=Path)
    ap.add_argument("--output",required=True,type=Path)
    a=ap.parse_args()
    candidates=source_candidates(a.source)
    rows={bp:audit_case(candidates,getattr(a,"decisions"+str(bp)),
          getattr(a,"entries"+str(bp)),getattr(a,"fills"+str(bp)),bp)
          for bp in (10,30)}
    output=compare(candidates,rows[10],rows[30])
    output["sourceSha256"]={"source":digest(a.source),
      **{suffix+str(bp):digest(getattr(a,suffix+str(bp)))
        for bp in (10,30) for suffix in ("decisions","entries","fills")}}
    a.output.write_text(json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({"status":output["status"],
        "models":{str(bp):{"admissions":rows[bp]["modeledAdmissions"],
          "blocked":rows[bp]["modeledBlocked"],"symbols":rows[bp]["bySymbol"]}
              for bp in (10,30)}},ensure_ascii=False))
if __name__=="__main__":main()
