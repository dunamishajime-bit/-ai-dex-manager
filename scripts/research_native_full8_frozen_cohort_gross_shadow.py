"""Frozen-native-entry gross-only counterfactual; not a full candidate reselection BT.

Native accepted IDs / times / exits / side / STOP / ownership stay unchanged.
Only modeled quantity is resized. Counterfactual cannot create additional
previously capacity-rejected entries; venue min qty/margin parity is unproven.
"""
from __future__ import annotations
from collections import Counter, defaultdict, deque
import argparse
import json
import math
from pathlib import Path
from scripts.audit_native_full8_source_locked_baseline import read_rows, event_cashflow, audit_native
from scripts.research_formal_dynamic_score_bt import load_recovered_replay_module
from scripts.research_archived_full8_dynamic_gross_bt import load_hype_h1

CRYPTO_CAP, STOCK_CAP, TOTAL_CAP = 3.0, 4.0, 4.25
STRATEGY_CAP = {"V12":2.0, "PENGU":1.0, "Q102":3.0, "FET":1.0,
                "V52":4.0, "HYPE_LONG":1.5, "IDLE":0.25, "RESIDUAL":1.0}
FULL_HOUR_MS=3600_000


def causal_multiplier(history: deque) -> tuple[float, float]:
    n=len(history)
    if n<10:
        return (1.0,50.0)
    wr=(sum(x>0 for x in history)+5)/(n+10)
    # Bounded 0.85..1.15; no future wins/price outcomes.
    conf=min(1.0,n/50)
    m=max(0.85,min(1.15,1+0.3*(wr-0.5)*conf))
    return m,50+100*(m-1)


def model(native: Path, prices: Path, hype_h1: Path, replay_source: Path,
          fx_root: Path, output: Path) -> dict:
    original=audit_native(native)
    entries=[r for r in read_rows(native/"candidate-decisions.jsonl") if r.get("decision")=="ACCEPTED_MODELED_ENTRY"]
    by_candidate={str(r["candidate_id"]):r for r in entries}
    native_trades=read_rows(native/"portfolio-trades.jsonl")
    trades_by_position={int(t["position_id"]):t for t in native_trades}
    events=read_rows(native/"portfolio-events.jsonl")
    mtm=read_rows(native/"task9-mtm.jsonl")
    replay=load_recovered_replay_module(replay_source)
    symbols={e["symbol"] for e in events if e["event_type"]=="MODELED_ENTRY"}
    market=replay._market(prices,symbols-{"HYPEUSDT"})
    if "HYPEUSDT" in symbols:market["HYPEUSDT"]=load_hype_h1(hype_h1)
    fx=replay.load_ecb_cross(fx_root)
    histories=defaultdict(lambda:deque(maxlen=100))
    positions={}
    wallet=0.0
    trace=[]
    new_sizes=[]
    native_exact_cashflow=0.
    risk_discrepancies=Counter()
    original_event_wallet_max_error=0.
    native_event_wallet=0.
    for event in events:
        kind=event["event_type"]
        ts=int(event["ts_ms"])
        orig_cash=event_cashflow(event)
        native_event_wallet+=orig_cash
        if "wallet_after_event" in event:
            original_event_wallet_max_error=max(
                original_event_wallet_max_error,abs(native_event_wallet-float(event["wallet_after_event"])))
        if kind=="MONTHLY_CONTRIBUTION":
            wallet+=orig_cash
            continue
        pid=event.get("position_id")
        if kind=="MODELED_ENTRY":
            cid=str(event["candidate_id"])
            row=by_candidate[cid]
            strategy=event["strategy_id"]
            equity=replay._equity(wallet,positions,market,ts)
            if equity<=0:raise ValueError("NONPOSITIVE_DYNAMIC_EQUITY")
            mult,score=causal_multiplier(histories[strategy])
            original_gross=float(row["accepted_gross"])
            requested_gross=float(row["requested_gross"])
            proposed=min(original_gross*mult,requested_gross,STRATEGY_CAP[strategy])
            use_gross=defaultdict(float)
            crypto_used=0.
            stock_used=0.
            for item in positions.values():
                gross=replay._gross(item,market,ts,equity)
                use_gross[item["strategy_id"]]+=gross
                if item["strategy_id"]=="V52":stock_used+=gross
                else:crypto_used+=gross
            class_room=(STOCK_CAP-stock_used) if strategy=="V52" else (CRYPTO_CAP-crypto_used)
            total_room=TOTAL_CAP-crypto_used-stock_used
            strategy_room=STRATEGY_CAP[strategy]-use_gross[strategy]
            # Never exceed room; no fabricated extra orders.
            allowed=max(0.,min(class_room,total_room,strategy_room))
            gross=min(proposed,allowed)
            if gross<=0.:
                risk_discrepancies["ORIGINAL_ACCEPTED_ENTRY_NOW_BLOCKED_BY_DYNAMIC_SIZE"]+=1
            original_notional=float(event["notional_settlement"])
            scale=(gross*equity/original_notional) if original_notional>0 else 0.
            wallet-=float(event["fee_settlement"])*scale
            positions[int(pid)]={
                "strategy_id":strategy,"symbol":event["symbol"],
                "side":event["side"],"entry_price":float(event["modeled_price_usd"]),
                "quantity":float(event["quantity"])*scale,"factor":scale,"original_quantity":float(event["quantity"]),
                "original_gross":original_gross,"gross":gross,"score":score,
            }
            new_sizes.append({"candidate_id":cid,"ts":ts,"strategy":strategy,
                              "old_gross":original_gross,"new_gross":gross,
                              "score":score,"scale":scale,"native_exit_locked":True})
        elif kind=="FUNDING":
            wallet+=orig_cash*positions[int(pid)]["factor"]
        elif kind in ("MODELED_PARTIAL_EXIT","HYPE_PRIORITY_PARTIAL_EXIT"):
            item=positions[int(pid)]
            wallet+=orig_cash*item["factor"]
            item["quantity"]-=float(event["quantity"])*item["factor"]
            if item["quantity"]< -1e-7*max(1,item["original_quantity"]):
                raise ValueError("PARTIAL_EXIT_MORE_THAN_POSITION")
        elif kind=="MODELED_EXIT":
            item=positions.pop(int(pid))
            wallet+=orig_cash*item["factor"]
            trade=trades_by_position[int(pid)]
            base_pnl=float(trade["total_pnl_jpy"])
            base_notional=float(trade["notional_entry_jpy"])
            ret=base_pnl/base_notional if base_notional>0 else 0.
            histories[item["strategy_id"]].append(ret)
        elif kind=="TASK9_MODELED_STOP_COOLDOWN":
            continue
        else:
            raise ValueError("UNRECOGNIZED_EVENT_TYPE")
    if positions:raise ValueError("POSITION_LEFT_OPEN_AFTER_NATIVE_EXIT")
    latest_fx=float(events[-1]["reference_fx_jpy_per_usd"])
    final_value=wallet*latest_fx
    changed=sum(abs(x["scale"]-1)>1e-6 for x in new_sizes)
    if not changed:
        raise ValueError("DYNAMIC_PROPOSAL_DID_NOT_CHANGE_ANY_POSITION")
    # H1 Mark/reprice hourly requires reconstructing trade/position state;
    # the frozen-native MTM curve cannot be reused after resizing.
    result={
        "status":("BLOCKED_NATIVE_LOCKED_COHORT_INFEASIBLE_AFTER_GROSS_CHANGE"
                  if risk_discrepancies else "RESEARCH_ONLY_FROZEN_NATIVE_COHORT_GROSS_COUNTERFACTUAL_NOT_VENUE_VERIFIED"),
        "fullDynamicNativeReselectionBTComplete":False,
        "nativeOriginalBaselineJpy":original["nativeFinalEquityJpy"],
        "nativeOriginalDD":original["nativeDD"],
        "nativeOriginalPF":original["nativePF"],
        "grossResizedModeledFinalEquityJpyNoUnrealizedPositionsAtEnd":(
            None if risk_discrepancies else final_value),
        "grossOnlyFinalAssetComparableToNative": False,
        "reasonForBlockedFinancialResult": (
            "Entry sizing changes free margin, so native ownership/admission MUST "
            "be re-evaluated at each timestamp rather than freezing formerly "
            "accepted trades with zero executable gross."),
        "nativeTradeRowsFollowed":len(new_sizes),
        "nonExecutableFormerNativeAdmissions":risk_discrepancies.get("ORIGINAL_ACCEPTED_ENTRY_NOW_BLOCKED_BY_DYNAMIC_SIZE",0),
        "positionsWithChangedQuantity":changed,
        "grossResizedDrawdownCertified":False,
        "modeledCapitalPathIsAnEconomicBacktest":False,
        "nativeEntryCountUnchanged":len(entries),
        "nativeExitCountUnchanged":len(native_trades),
        "allNativeEntryExitTimesAndReasonsLocked":True,
        "nativeRiskGateReselectionExecuted":False,
        "newPreviouslyRejectedTradesAdmitted":0,
        "dynamicPriorIndependentHoldout":False,
        "venueQuantityRoundingAndStopReprotectionCertified":False,
        "nativeBaselineEventReconciled":original["status"],
        "nativeWalletEventMaxAbsoluteErrorUsd":original_event_wallet_max_error,
        "riskDiscrepancies":dict(risk_discrepancies),
        "modelCapsAssumedForResearch":{"crypto":CRYPTO_CAP,"stock":STOCK_CAP,
            "total":TOTAL_CAP,"perStrategy":STRATEGY_CAP},
        "caution":"NO RESULT is published while any native accepted entry becomes non-executable; original postgate engine required.",
    }
    output.mkdir(parents=True,exist_ok=True)
    (output/"gross-only-cohort-research-summary.json").write_text(
        json.dumps(result,sort_keys=True,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
    with (output/"gross-only-sizing-proposals.jsonl").open("w",encoding="utf8") as f:
        for r in new_sizes:f.write(json.dumps(r,sort_keys=True)+"\n")
    return result


def main():
    a=argparse.ArgumentParser(description=__doc__)
    for name in ("native-run","prices","hype-h1","replay-source","fx-root","output"):
        a.add_argument("--"+name,required=True,type=Path)
    x=a.parse_args()
    print(json.dumps(model(x.native_run,x.prices,x.hype_h1,x.replay_source,x.fx_root,x.output),indent=2))


if __name__=="__main__":
    main()
