#!/usr/bin/env python3
"""Offline HYPE TREND single-slot realized DD and funding-model ledger audit.

Only research models, never exchange status or real orders. Historical modeled
candles/fills are not a LIVE or multi-runner parity statement.
"""
from __future__ import annotations
import argparse,hashlib,json,math,statistics
from pathlib import Path
from datetime import datetime,timezone

def digest(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def nearly(a,b,tol=1e-8)->bool:
    return math.isfinite(float(a)) and math.isfinite(float(b)) and abs(float(a)-float(b))<=tol*max(1.,abs(float(b)))

def summarize(data:dict,candidates:dict,case:str)->dict:
    if case not in ("10bps","30bps"):raise ValueError("UNKNOWN_COST_MODEL")
    trades=data.get("modelTrades")
    if not isinstance(trades,list) or not trades:raise ValueError("MODEL_TRADES_MISSING")
    expected_cost={"10bps":0.001,"30bps":0.003}[case]
    initial=float(data.get("initialJpy"))
    if not nearly(initial,10_000):raise ValueError("INITIAL_EQUITY_CONTRACT")
    balance=initial;peak=initial;peak_trade=None;trough=None;max_dd=0.
    wins=[];losses=[];history=[];funding_total=0;last_end=-1;peak_at=0
    for i,trade in enumerate(trades):
        start=int(trade["start"]);end=int(trade["end"])
        if start not in candidates or candidates[start]["exit_ts_ms"]!=end:
            raise ValueError("ARCHIVED_CANDIDATE_MISSING_OR_EXIT_DRIFT")
        candidate=candidates[start]
        if candidate["exit_reason"]!=trade["exitReason"]:raise ValueError("CANDIDATE_EXIT_REASON_DRIFT")
        if start<last_end or end<=start:raise ValueError("SINGLE_SLOT_INTERVAL_OVERLAP")
        last_end=end
        gross=float(trade["gross"])
        raw=float(trade["rawReturn"])
        fee=float(trade["feeWalletReturn"])
        funding=float(trade["fundingWalletReturn"])
        realized=float(trade["netWalletReturn"])
        after=float(trade["netCapitalJPY"])
        if not 0<gross<=1.5+1e-9:raise ValueError("MODEL_GROSS_INVALID")
        if not nearly(fee,-gross*expected_cost):raise ValueError("COST_BPS_MODEL_FEE_MISMATCH")
        if not nearly(gross*raw+fee+funding,realized):raise ValueError("MODEL_PNL_IDENTITY_FAILED")
        if not nearly(balance*(1+realized),after):raise ValueError("COMPOUNDING_LEDGER_MISMATCH")
        if not math.isfinite(after) or after<=0:raise ValueError("MODEL_EQUITY_INVALID")
        balance=after
        funding_total+=int(trade["fundingEvents"])
        (wins if realized>0 else losses).append(realized*100)
        if balance>peak:
            peak=balance;peak_at=i+1;peak_trade=i
        dd=(balance/peak-1)*100
        if dd<max_dd:
            max_dd=dd
            trough=i
        history.append({"trade":i+1,"entryUtc":datetime.fromtimestamp(start/1000,timezone.utc).isoformat(),
            "exitUtc":datetime.fromtimestamp(end/1000,timezone.utc).isoformat(),"grossX":gross,
            "pnlPct":realized*100,"balanceJpy":balance,"realizedDdPct":dd,"modelExitReason":trade["exitReason"]})
    if not nearly(balance,data.get("finalJpy")):raise ValueError("FINAL_EQUITY_SUMMARY_DRIFT")
    if not nearly(max_dd,data.get("realizedDDPct")):raise ValueError("DD_SUMMARY_DRIFT")
    if not nearly(100*len(wins)/len(trades),data.get("winRatePct")):raise ValueError("WIN_RATE_SUMMARY_DRIFT")
    if funding_total!=int(data.get("fundingEventsDuringTrades")):raise ValueError("FUNDING_EVENT_COUNT_DRIFT")
    if len(wins)!=int(data.get("strategyTradeWins")):raise ValueError("WIN_COUNT_SUMMARY_DRIFT")
    if not wins or not losses:raise ValueError("UNBALANCED_TEST_DATA")
    return {
      "case":case,"modelTradeCount":len(trades),"wins":len(wins),"losses":len(losses),
      "winRatePct":100*len(wins)/len(trades),
      "averageWinPct":statistics.mean(wins),"averageLossPct":statistics.mean(losses),
      "worstTradePct":min(losses),"bestTradePct":max(wins),
      "initialJpy":initial,"finalJpy":balance,
      "maxRealizedDdPct":max_dd,"maxDd20PctExceeded":max_dd < -20,
      "maxDrawdownTroughTrade":(trough+1 if trough is not None else None),
      "maxDrawdownTrough":history[trough] if trough is not None else None,
      "fundingEventCount":funding_total,"closedTradesReconciled":True,
      "historicalSingleSlotModelOnly":True,
      "tradeContributions":history
    }

def audit(model:dict,candidates:list)->dict:
    if model.get("schema")!="disdex-hype-pinned-aster-funding-sensitivity/v1":
        raise ValueError("MODEL_SCHEMA_UNRECOGNIZED")
    if len(candidates)!=78:raise ValueError("ARCHIVED_NATIVE_HYPE_CANDIDATES_NOT_78")
    by_start={}
    for row in candidates:
        key=row["entry_ts_ms"]
        if (row["strategy_id"]!="HYPE_LONG" or row["symbol"]!="HYPEUSDT" or
           row["route"]!="HYPE_TREND_LONG_PINNED" or key in by_start):
            raise ValueError("ARCHIVED_HYPE_CANDIDATE_IDENTITY_INVALID")
        by_start[key]=row
    output={name:summarize(model["results"][name],by_start,name) for name in ("10bps","30bps")}
    starts={name:[x["start"] for x in model["results"][name]["modelTrades"]] for name in output}
    if starts["10bps"]!=starts["30bps"]:
        raise ValueError("COST_CASE_TRADE_SELECTION_MISMATCH")
    if any(x["maxRealizedDdPct"]!=x["maxRealizedDdPct"] for x in output.values()):
        raise ValueError("NONFINITE_DRAWDOWN")
    return {"schema":"disdex-bt-hype-single-slot-loss-contribution-audit/v1",
      "status":"HYPE_SINGLE_SLOT_RESEARCH_LEDGER_RECONCILED",
      "entryCandidatesFromNativeSignal":len(candidates),
      "singleSlotSelectedModelTrades":len(starts["10bps"]),
      "suppressedOrConcurrentCandidatesNotExecutedAsIndependentTrades":len(candidates)-len(starts["10bps"]),
      "models":output,
      "sourceModelOnly":True,"sharedRiskOrOtherRunnerArbitrationCertified":False,
      "venueFundingCashflowsCertified":False,"productionMutations":0}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--standalone-model",required=True,type=Path)
    p.add_argument("--source-candidates",required=True,type=Path)
    p.add_argument("--output",type=Path)
    args=p.parse_args()
    model=json.loads(args.standalone_model.read_text("utf-8-sig"))
    candidates=json.loads(args.source_candidates.read_text("utf-8-sig"))
    out=audit(model,candidates)
    out["inputSha256"]={
      "standalone":digest(args.standalone_model),"sourceCandidates":digest(args.source_candidates)}
    body=json.dumps(out,indent=2,ensure_ascii=False,allow_nan=False)+"\n"
    if args.output:args.output.write_text(body,encoding="utf8")
    print(json.dumps({"status":out["status"],"nativeCandidates":out["entryCandidatesFromNativeSignal"],
      "selected":out["singleSlotSelectedModelTrades"],
      "10bps":{k:v for k,v in out["models"]["10bps"].items() if k in ("wins","losses","maxRealizedDdPct","finalJpy")},
      "30bps":{k:v for k,v in out["models"]["30bps"].items() if k in ("wins","losses","maxRealizedDdPct","finalJpy")}},ensure_ascii=False))

if __name__=="__main__":main()
