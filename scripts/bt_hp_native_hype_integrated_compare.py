#!/usr/bin/env python3
"""Compare isolated STABLE4 HYPE H48/native TREND integrated source replays.

Reconciles all model equity/Gross observations and all fill/entry identities
without inferring venue quantity, FX, orders, or historical live gates.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math,sys
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path
from bt_hp_source_model_gross import (
    load_model_entries,load_model_gross,GrossReconciler,utc,
)

EXPECTED_CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
OLD_ROUTE="HYPE_REDESIGN_CAUSAL_H48R4_WSIG"
NATIVE_ROUTE="HYPE_TREND_LONG_PINNED"
FAMILIES={"V4","Q102","PENGU","V52","HYPE","IDLE","FET"}

def pathof(folder:Path,bps:int,kind:str)->Path:
    matches=list(folder.glob(f"*_{bps}BPS_{kind}"))
    if len(matches)!=1:raise ValueError(f"EXPECTED_ONE_{bps}BPS_{kind}:{len(matches)}")
    return matches[0]

def sha(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def nclose(a,b)->bool:
    return math.isfinite(float(a)) and math.isfinite(float(b)) and math.isclose(float(a),float(b),rel_tol=1e-9,abs_tol=1e-6)

def parse_case(folder:Path,bps:int,allowed_route:str,valid_native_times:dict,*,full_gross:bool=True)->dict:
    summary_path=pathof(folder,bps,"SUMMARY.json")
    entries_path=pathof(folder,bps,"MODEL_ENTRIES.csv")
    fills_path=pathof(folder,bps,"FILLS.csv")
    equity_path=pathof(folder,bps,"EQUITY_30MIN.csv")
    gross_path=pathof(folder,bps,"POSITION_GROSS_SNAPSHOTS.csv")
    summary=json.loads(summary_path.read_text("utf8"))
    if summary.get("case")!=EXPECTED_CASE or summary.get("cost_bps_roundtrip")!=bps:
        raise ValueError("REPLAY_RESEARCH_CASE_OR_FEE_MISMATCH")
    raw_entries=load_model_entries(entries_path)
    entry_counter=Counter(x["logic"] for x in raw_entries.values())
    expected_families=FAMILIES-{"HYPE"} if allowed_route=="NO_HYPE" else FAMILIES
    if set(entry_counter)!=expected_families or entry_counter!=Counter(summary["admitted_by_runner"]):
        raise ValueError("MODEL_ENTRY_FAMILY_RECONCILIATION_MISMATCH")
    hentries=sorted((x for x in raw_entries.values() if x["logic"]=="HYPE"),key=lambda x:x["openedAt"])
    if allowed_route=="NO_HYPE":
        if hentries:raise ValueError("NO_HYPE_ABLATION_HAS_HYPE_ADMISSIONS")
    elif not hentries or any(x["route"]!=allowed_route or x["symbol"]!="HYPEUSDT" or x["side"]!="LONG" for x in hentries):
        raise ValueError("HYPE_ROUTE_NOT_EXPECTED")
    if allowed_route==NATIVE_ROUTE:
        for row in hentries:
            when=datetime.fromisoformat(row["openedAt"].replace("Z","+00:00")).timestamp()*1000
            if when not in valid_native_times:
                raise ValueError("NATIVE_HYPE_ENTRY_NOT_IN_ARCHIVED_SIGNAL_SET")
            intended=float(valid_native_times[when]["requested_gross"])
            if not nclose(row["grossAtEntry"],intended):
                raise ValueError("NATIVE_HYPE_REQUESTED_GROSS_MODEL_DRIFT")
    fill_rows=[]
    seen=set()
    with fills_path.open(encoding="utf-8-sig",newline="") as f:
        for record in csv.DictReader(f):
            key=record["trade_id"]
            if key in seen or key not in raw_entries:raise ValueError("SOURCE_FILL_ID_DUPLICATED_OR_MISSING")
            seen.add(key)
            x=raw_entries[key]
            if record["strategy"]!=x["logic"] or record["symbol"]!=x["symbol"]:
                raise ValueError("MODEL_FILL_STRATEGY_OR_SYMBOL_DRIFT")
            if record["entry_utc"]!=x["openedAt"]:
                raise ValueError("MODEL_FILL_ENTRY_TIME_DRIFT")
            if record["actual_venue_order_id"] or record["actual_filled_quantity"] or record["signed_execution_verified"]!="False":
                raise ValueError("UNTRUSTED_LIVE_EXECUTION_CLAIM_IN_RESEARCH_LEDGER")
            fill_rows.append(record)
    if len(fill_rows)!=int(summary["modeled_fills"]):raise ValueError("SUMMARY_FILL_COUNT_MISMATCH")
    pnl=defaultdict(float);fills_by_runner=Counter()
    positive=negative=0.
    for fill in fill_rows:
        strat=fill["strategy"]
        n=float(fill["net_pnl_jpy"])
        if not math.isfinite(n):raise ValueError("FILL_PNL_NONFINITE")
        pnl[strat]+=n;fills_by_runner[strat]+=1
        if n>0:positive+=n
        elif n<0:negative+=-n
    if not negative>0:raise ValueError("PNL_PROFIT_FACTOR_UNDEFINED")
    if not nclose(positive/negative,summary["profit_factor"]):
        raise ValueError("SUMMARY_PROFIT_FACTOR_MISMATCH")
    if not nclose(100*sum(float(x["net_pnl_jpy"])>0 for x in fill_rows)/len(fill_rows),summary["win_rate_pct"]):
        raise ValueError("SUMMARY_WIN_RATE_MISMATCH")
    snaps=load_model_gross(gross_path) if full_gross else None
    reconciler=GrossReconciler(raw_entries,snaps,fills_path) if full_gross else None
    first=True;last_t="";max_dd=0.;dd_t=None;peak=0.;equity_count=0
    gmax={"total":0.,"crypto":0.,"stock":0.}
    with equity_path.open(encoding="utf-8-sig",newline="") as f:
        for row in csv.DictReader(f):
            t=utc(row["utc"])
            v=float(row["compounded_mtm_equity_jpy"])
            if first and not nclose(v,10000.):raise ValueError("INITIAL_EQUITY_NOT_10000_JPY")
            first=False
            if last_t and t<=last_t:raise ValueError("EQUITY_TIMESTAMPS_NOT_STRICT_ASCENDING")
            if v<=0 or not math.isfinite(v):raise ValueError("MODEL_EQUITY_INVALID")
            last_t=t
            peak=max(peak,v)
            dd=100*(v/peak-1)
            if dd<max_dd:max_dd=dd;dd_t=t
            gross={
                "total":float(row["total_gross_x"]),
                "crypto":float(row["crypto_gross_x"]),
                "stock":float(row["stock_gross_x"]),
            }
            for k,x in gross.items():
                if not math.isfinite(x) or x<-1e-9:raise ValueError("SOURCE_GROSS_INVALID")
                gmax[k]=max(gmax[k],x)
            if not nclose(gross["crypto"]+gross["stock"],gross["total"]):
                raise ValueError("CRYPTO_STOCK_GROSS_SUM_DIFFERENCE")
            if reconciler:reconciler.check(t,row,gross)
            equity_count+=1
    if reconciler:reconciler.finish()
    if equity_count!=105121:raise ValueError("MODEL_SAMPLE_COMPLETENESS_FAILED")
    if not nclose(max_dd,summary["max_hourly_dd_pct"]) or dd_t!=summary["dd_time_utc"]:
        raise ValueError("DRAWDOWN_RECOMPUTE_MISMATCH")
    if not nclose(float(summary["initial_jpy"]),10_000):
        raise ValueError("MODEL_INITIAL_CAPITAL_DRIFT")
    return {
        "costBps":bps,
        "summary":{
            "initialJpy":summary["initial_jpy"],
            "finalJpy":summary["final_compounded_jpy"],
            "winRatePct":summary["win_rate_pct"],
            "maxDdPct":summary["max_hourly_dd_pct"],
            "maxDdUtc":summary["dd_time_utc"],
            "profitFactor":summary["profit_factor"],
            "modelFills":summary["modeled_fills"],
        },
        "entryCount":len(raw_entries),"entriesByLogic":dict(entry_counter),
        "filledCount":len(fill_rows),"fillsByLogic":dict(fills_by_runner),
        "modeledPnlJpyByLogic":dict(pnl),
        "hypeSelectedCount":len(hentries),
        "hypeSelected":{
            "entryUtc":[r["openedAt"] for r in hentries],
            "route":allowed_route,
            "modeledNetPnlJpy":pnl["HYPE"],
            "filledCount":fills_by_runner["HYPE"],
        },
        "blockedByReason":{
            k:int(summary.get("blocked_by_reason",{}).get(k,0))
            for k in ("DAILY_LOSS_7P5_GATE","HYPE_FORMAL_BASELINE_OPEN_GATE",
                      "V4_MAX_DRAWDOWN_21PCT_HOLD")
        },
        "equityGrossObservations":equity_count,
        "positionGrossReconciled":bool(full_gross),
        "maxMarkedGrossX":gmax,
        "terminalModeledOpenCount":len(raw_entries)-len(fill_rows),
        "sourceHashes":{
            "summary":sha(summary_path),"entries":sha(entries_path),"fills":sha(fills_path),
            "equity":sha(equity_path),"gross":sha(gross_path)
        },
    }

def compare(old:dict,native:dict,expected_candidates:int)->dict:
    if expected_candidates!=78:raise ValueError("NATIVE_HYPE_CANDIDATE_COUNT_INVALID")
    if set(old)!={"10","30"} or set(native)!={"10","30"}:raise ValueError("INCOMPLETE_COST_CASE_COMPARISON")
    result={}
    for b in ("10","30"):
        a=old[b];n=native[b]
        if set(a["entriesByLogic"])!=FAMILIES or set(n["entriesByLogic"])!=FAMILIES:
            raise ValueError("FAMILY_COVERAGE_DRIFT")
        if n["hypeSelectedCount"]>expected_candidates:raise ValueError("HYPE_SELECTED_MORE_THAN_SIGNAL_POOL")
        result[b]={
          "baselineResearch":a,
          "nativeTrendResearch":n,
          "delta": {
            "maxDdPctPoints":n["summary"]["maxDdPct"]-a["summary"]["maxDdPct"],
            "winRatePctPoints":n["summary"]["winRatePct"]-a["summary"]["winRatePct"],
            "finalEquityJpy":n["summary"]["finalJpy"]-a["summary"]["finalJpy"],
            "modeledHypeNetPnlJpy":n["hypeSelected"]["modeledNetPnlJpy"]-a["hypeSelected"]["modeledNetPnlJpy"],
            "sharedDailyLossGateBlocks":n["blockedByReason"]["DAILY_LOSS_7P5_GATE"]-
                 a["blockedByReason"]["DAILY_LOSS_7P5_GATE"],
            "nativeHypeSelectedCountMinusBaselineH48":n["hypeSelectedCount"]-a["hypeSelectedCount"],
          }
        }
    return {
      "schema":"disdex-bt-native-hype-integrated-controlled-comparison/v1",
      "status":"RESEARCH_SENSITIVITY_DD_WORSE_NOT_PRODUCTION_PARITY",
      "sourceCase":"STABLE4 experimental PRETARGET STABLE3, not an exact LIVE economic implementation",
      "hypeOldRoute":OLD_ROUTE,
      "hypeNativeRoute":NATIVE_ROUTE,
      "hypeNativeSignalCandidates":expected_candidates,
      "yearUtc":"2025-10-01T00:00:00Z..2026-10-01T00:00:00Z end-exclusive",
      "models":result,
      "attributionCaution":"Different HYPE timing changes shared risk, preemption, gross and all runners; per-logic JPY modeled PnL is not a causal decomposition of portfolio DD",
      "historicalKillSwitchAndStopOwnershipCertified":False,
      "signedVenueFillsCertified":False,
      "allLiveLogicPinsEconomicParityCertified":False,
      "productionMutations":0
    }

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline",type=Path,required=True)
    ap.add_argument("--native",type=Path,required=True)
    ap.add_argument("--native-candidates",type=Path,required=True)
    ap.add_argument("--no-hype-control",type=Path)
    ap.add_argument("--output",type=Path)
    ap.add_argument("--skip-full-gross",action="store_true")
    a=ap.parse_args()
    native_candidates=json.loads(a.native_candidates.read_text("utf8"))
    if len(native_candidates)!=78:raise ValueError("NATIVE_HYPE_CANDIDATES_EXPECTED_78")
    cand={}
    for row in native_candidates:
        stamp=row["entry_ts_ms"]
        if row["route"]!=NATIVE_ROUTE or stamp in cand:raise ValueError("NATIVE_HYPE_CANDIDATE_UNIQUENESS")
        cand[stamp]=row
    attr_path=a.native/"NATIVE_HYPE_RESEARCH_SENSITIVITY_ATTESTATION.json"
    meta=json.loads(attr_path.read_text("utf8"))
    if (meta.get("status")!="RESEARCH_ONLY_NATIVE_HYPE_CANDIDATE_PORTFOLIO_REPLAY" or
       meta.get("nativeHypeSourceCandidatesSha256")!=sha(a.native_candidates)):
        raise ValueError("NATIVE_SENSITIVITY_SOURCE_PROVENANCE_INVALID")
    old={str(b):parse_case(a.baseline,b,OLD_ROUTE,cand,full_gross=not a.skip_full_gross) for b in (10,30)}
    new={str(b):parse_case(a.native,b,NATIVE_ROUTE,cand,full_gross=not a.skip_full_gross) for b in (10,30)}
    report=compare(old,new,len(cand))
    if a.no_hype_control is not None:
        ablation_path=a.no_hype_control/"NO_HYPE_RESEARCH_CONTROL_ATTESTATION.json"
        ablation=json.loads(ablation_path.read_text("utf8"))
        if ablation.get("status")!="RESEARCH_ONLY_ZERO_HYPE_SIDECAR_ABLATION" or ablation.get("hypeCandidatesAdmittedExpected")!=0:
            raise ValueError("NO_HYPE_CONTROL_ATTESTATION_INVALID")
        zero={str(b):parse_case(a.no_hype_control,b,"NO_HYPE",cand,
            full_gross=not a.skip_full_gross) for b in (10,30)}
        report["noHypeControl"]={
            "status":"MATCHED_RESEARCH_NO_HYPE_ABLATION_NOT_LIVE",
            "controlAttestationSha256":sha(ablation_path),
            "models":zero,
            "deltaNativeMinusNoHype":{
                b:{
                  "maxDdPctPoints":new[b]["summary"]["maxDdPct"]-zero[b]["summary"]["maxDdPct"],
                  "finalEquityJpy":new[b]["summary"]["finalJpy"]-zero[b]["summary"]["finalJpy"],
                  "winRatePctPoints":new[b]["summary"]["winRatePct"]-zero[b]["summary"]["winRatePct"],
                  "sharedDailyLossGateBlocks":new[b]["blockedByReason"]["DAILY_LOSS_7P5_GATE"]-
                      zero[b]["blockedByReason"]["DAILY_LOSS_7P5_GATE"]
                } for b in ("10","30")
            }
        }
    report["inputSha256"]={"nativeCandidates":sha(a.native_candidates),
                         "nativeAttestation":sha(attr_path)}
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf8")
    print(json.dumps({"status":report["status"],"gross":not a.skip_full_gross,
      "10bps":report["models"]["10"]["delta"],"30bps":report["models"]["30"]["delta"]},ensure_ascii=False))
if __name__=="__main__":main()
