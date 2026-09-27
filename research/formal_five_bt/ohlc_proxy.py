"""Separate, explicit OHLC-only *research proxy* for inaccessible historical venue L2.

This does NOT substitute for the formal five-logic replay. The pinned production
signal scans are inputs, but the execution, allocator, and some exit semantics
below are deliberately marked MODEL ASSUMPTIONS. Never describe these outputs as
verified Aster fills, official strategy profitability, or a five-logic BT.
The original fail-closed engine and its null performance metrics are unchanged.
"""
from __future__ import annotations

from bisect import bisect_left
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any, Mapping

from .datasets import load_aster_dataset, load_fred_fx
from .engine import PERIOD_START, PERIOD_END_EXCLUSIVE, _load_signal_rows, _load_signal_scan_manifests, _write_jsonl_gz
from .execution import resolve_ohlc_exit
from .manifest import load_manifest
from .portfolio import monthly_deposit_events

HOUR=3_600_000
MODEL_NAME="INDEPENDENT_ASTER_H1_OHLC_PROXY_NOT_FORMAL_BT"
MAX_MARK_GAP_HOURS=1
SIDE={"LONG":1,"SHORT":-1}
PRIORITY={"PENGU":1,"V12":2,"Q102":3,"FET":4}
# These are intentionally research assumptions, never represented as live fees.
MODELS={
    "NORMAL":{"entry_bps":10.0,"exit_bps":10.0,"fee_bps_each_side":5.0},
    "SEVERE":{"entry_bps":35.0,"exit_bps":50.0,"fee_bps_each_side":8.0},
}

def canonical(obj:Any)->bytes:
    return (json.dumps(obj,sort_keys=True,separators=(",",":"),allow_nan=False,ensure_ascii=False)+"\n").encode()

def sha(path:Path)->str:return hashlib.sha256(path.read_bytes()).hexdigest()

def positive(v:Any)->float|None:
    try:
        n=float(v)
        return n if math.isfinite(n) and n>0 else None
    except (TypeError,ValueError):return None

@dataclass(frozen=True)
class Candidate:
    strategy:str
    symbol:str
    decision_ms:int
    enter_ms:int
    side:str
    gross:float
    max_hold_h:int
    source_cutoff_ms:int
    rank:int|None
    family:str|None
    variant:str|None
    raw:dict[str,Any]

def to_candidate(strategy:str,row:Mapping[str,Any])->Candidate|None:
    if row.get("status")!="SIGNAL":return None
    symbol=str(row.get("symbol") or "").upper()
    signal=row.get("signal") or {}
    selected=row.get("item") or {}
    decision=int(row["decision_ts_ms"])
    if strategy=="V12":
        side=str(signal.get("side") or "").upper()
        rank=int(signal.get("rank") or 1)
        gross=0.10 if rank==3 else 1.0
        hold=46
        entry=int(signal.get("entryTs") or decision)
        family=None
        variant=str(signal.get("entryGateReason") or "")
    elif strategy=="PENGU":
        side="LONG" if row.get("side")==1 else "SHORT" if row.get("side")==-1 else "WAIT"
        rank=None;gross=1.0
        hold=72 if side=="LONG" else 120
        entry=decision
        family=None;variant=str(row.get("runtime_reason") or "")
    elif strategy=="Q102":
        side=str(selected.get("side") or "WAIT").upper()
        gross=float(selected.get("requestedGross") or 0)
        rank=None
        family=str(selected.get("family") or "") or None
        variant=str(selected.get("variant") or "") or None
        match=re.search(r"(?:^|_)H(\d+)(?:_|$)",variant or "")
        hold=int(match.group(1)) if match else 24
        entry=decision
    elif strategy=="FET":
        side="LONG";gross=2.25;rank=None;family=None;variant="BRK48"
        hold=24
        entry=int(signal.get("entryTs") or decision)
    else:return None
    if not symbol.endswith("USDT") or side not in SIDE or gross<=0 or not (1<=hold<=168):return None
    entered=((max(entry,decision)+HOUR-1)//HOUR)*HOUR
    cutoff=int(row.get("data_cutoff_ms") or 0)
    if entered<decision or cutoff>decision:return None
    return Candidate(strategy,symbol,decision,entered,side,gross,hold,cutoff,rank,family,variant,dict(row))

def _bar_valid(bar:Any)->bool:
    if bar is None:return False
    return (math.isfinite(bar.open) and math.isfinite(bar.close) and math.isfinite(bar.high)
            and math.isfinite(bar.low) and bar.open>0 and bar.low>0
            and bar.high>=max(bar.open,bar.close,bar.low) and bar.low<=min(bar.open,bar.close,bar.high))

def atr_h1(bars:Mapping[int,Any],entry_ts:int,hours:int=28)->float|None:
    """Proxy H1 ATR; LIVE V12 uses its own H2 variant, not claimed equivalent."""
    values=[]
    previous=None
    for ts in range(entry_ts-(hours+1)*HOUR,entry_ts,HOUR):
        b=bars.get(ts)
        if not _bar_valid(b):return None
        if previous is not None:
            values.append(max(b.high-b.low,abs(b.high-previous),abs(b.low-previous)))
        previous=b.close
    return (sum(values[-hours:])/hours) if len(values)>=hours else None

def model_protection(candidate:Candidate,open_price:float,history:Mapping[int,Any])->tuple[float|None,float|None,str]:
    side=SIDE[candidate.side]
    if candidate.strategy=="FET":
        raw=positive((candidate.raw.get("signal") or {}).get("hardStopPrice"))
        stop=raw if raw and raw<open_price else open_price*0.95
        return stop,None,"LIVE_FET_HARD_STOP_REFERENCE_PLUS_PROXY_GAP"
    if candidate.strategy=="PENGU":
        return open_price*(1-side*0.08),None,"PENGU_8PCT_HARD_STOP_PROXY_NO_EXACT_ROUTE_TRAIL"
    if candidate.strategy=="V12":
        atr=atr_h1(history,candidate.enter_ms)
        if not atr:return None,None,"V12_PROXY_ATR_WARMUP_MISSING"
        return open_price-side*2.477*atr,open_price+side*3.1995*atr,"H1_PROXY_ATR_NOT_EXACT_LIVE_H2_ATR"
    # Q102 exact family exits need intrahour venue replay: only hold-time
    # model allowed, no invented stop/TP prices or live-route equivalence.
    return None,None,"Q102_MODEL_TIME_EXIT_ONLY_EXACT_FAMILY_EXITS_UNVERIFIED"

def _funding_map(dataset:Any)->dict[int,float]:
    return {int(x.event_time_ms):float(x.funding_rate) for x in dataset.funding if math.isfinite(x.funding_rate)}

def _nav(cash:float,positions:list[dict],bars:Mapping[str,Mapping[int,Any]],ts:int,field:str)->float|None:
    equity=cash
    for p in positions:
        b=bars[p["symbol"]].get(ts)
        if not _bar_valid(b):return None
        mark=getattr(b,field)
        equity+=SIDE[p["side"]]*p["quantity"]*(mark-p["entry_price"])
    return equity

def simulate(candidates:list[Candidate],bars:Mapping[str,Mapping[int,Any]],
             funding:Mapping[str,Mapping[int,float]],deposits:list[Any],model:str)->dict[str,Any]:
    if model not in MODELS:raise ValueError("UNSUPPORTED_PROXY_MODEL")
    costs=MODELS[model];candidate_hour=defaultdict(list)
    for c in candidates:candidate_hour[c.enter_ms].append(c)
    all_hours=range(int(PERIOD_START.timestamp()*1000),int(PERIOD_END_EXCLUSIVE.timestamp()*1000),HOUR)
    deposits_at=defaultdict(list)
    for d in deposits:deposits_at[d.timestamp_ms].append(d)
    cash=0.0;positions=[];ledger=[];rejects=Counter();per_strategy=Counter()
    month_nav=[];highest_adjusted=0.0;max_dd=0.0;total_contrib=0.0
    pending_funding_missing=0;closed_pnl=[];daily_loss_start=None;daily_loss_date=None
    for ts in all_hours:
        day=datetime.fromtimestamp(ts/1000,timezone.utc).strftime("%Y-%m-%d")
        if day!=daily_loss_date:
            daily_loss_date=day
            daily_loss_start=_nav(cash,positions,bars,ts,"open")
        for d in deposits_at.get(ts,[]):
            cash+=d.amount_usdt;total_contrib+=d.amount_usdt
        next_positions=[]
        for p in positions:
            b=bars[p["symbol"]].get(ts)
            if not _bar_valid(b):
                # If an open position has unpriceable H1 data, scenario equity
                # ceases to be complete; exit is NOT guessed.
                raise ValueError("OPEN_POSITION_BAR_UNAVAILABLE:"+p["symbol"]+":"+str(ts))
            if ts>p["entry_ts"]:
                rate=funding.get(p["symbol"],{}).get(ts)
                if rate is not None:
                    charged=-p["quantity"]*b.open*rate*SIDE[p["side"]]
                    cash+=charged;p["funding"]+=charged
                if p["strategy"]=="FET" and p["highest_favorable"]>=p["entry_price"]*1.05:
                    p["stop"]=max(p["stop"] or 0,p["entry_price"]*1.005)
                expiry=ts>=p["entry_ts"]+p["hold_hours"]*HOUR
                resolution=resolve_ohlc_exit(p["side"],bar_open=b.open,bar_high=b.high,
                    bar_low=b.low,bar_close=b.close,stop_price=p["stop"],target_price=p["target"],time_exit=expiry)
                if resolution.status=="NOT_VERIFIABLE":
                    raise ValueError("MODEL_INVALID_INTRABAR")
                if resolution.exit_price is not None:
                    raw=resolution.exit_price
                    exit_price=raw*(1-(costs["exit_bps"]/10000)*SIDE[p["side"]])
                    exit_fee=p["quantity"]*exit_price*costs["fee_bps_each_side"]/10000
                    gross=SIDE[p["side"]]*p["quantity"]*(exit_price-p["entry_price"])
                    pnl=gross-exit_fee+p["funding"]-p["entry_fee"]
                    cash+=gross-exit_fee
                    closed_pnl.append(pnl);per_strategy[p["strategy"]]+=pnl
                    ledger.append({**{key:p[key] for key in ("strategy","symbol","side","entry_ts","entry_price","quantity","gross",
                        "family","variant","source_sha","protection_note")},"exit_ts":ts,
                        "exit_price":exit_price,"gross_pnl_usdt":round(gross,9),
                        "net_pnl_usdt":round(pnl,9),"funding_usdt":round(p["funding"],9),
                        "entry_fee_usdt":round(p["entry_fee"],9),"exit_fee_usdt":round(exit_fee,9),
                        "exit_reason":resolution.reason,"ambiguous_intrabar":resolution.ambiguous_bar,
                        "fill_provenance":"ASSUMED_NEXT_ASTER_H1_OPEN_AND_OHLC_EXIT_NEVER_VERIFIED_L2"})
                    continue
                # Do not grant same-bar trailing activation if the hour touched
                # stop too; resolve the old stop first and update next hour only.
                p["highest_favorable"]=(max(p["highest_favorable"],b.high) if p["side"]=="LONG"
                                         else min(p["highest_favorable"],b.low))
                if p["strategy"]=="PENGU":
                    trigger=0.15 if p["side"]=="LONG" else 0.10
                    retrace=0.04 if p["side"]=="LONG" else 0.03
                    if SIDE[p["side"]]*(p["highest_favorable"]/p["entry_price"]-1)>=trigger:
                        trailing=p["highest_favorable"]*(1-retrace*SIDE[p["side"]])
                        p["stop"]=max(p["stop"],trailing) if p["side"]=="LONG" else min(p["stop"],trailing)
            next_positions.append(p)
        positions=next_positions
        equity=_nav(cash,positions,bars,ts,"open")
        if equity is None or equity<=0:raise ValueError("MODEL_EQUITY_UNPRICEABLE_OR_DEPLETED")
        total_gross=sum(p["quantity"]*bars[p["symbol"]][ts].open for p in positions)/equity
        v12_gross=sum(p["quantity"]*bars[p["symbol"]][ts].open for p in positions if p["strategy"]=="V12")/equity
        if candidate_hour.get(ts):
            due=sorted(candidate_hour[ts],key=lambda c:(PRIORITY[c.strategy],c.rank or 1,c.symbol))
            for c in due:
                b=bars.get(c.symbol,{}).get(ts)
                if not _bar_valid(b):
                    rejects["ENTRY_BAR_UNAVAILABLE_OR_INVALID"]+=1;continue
                if any(p["symbol"]==c.symbol for p in positions):
                    rejects["SYMBOL_OWNED"]+=1;continue
                count=sum(p["strategy"]==c.strategy for p in positions)
                limit=3 if c.strategy=="V12" else 1
                if count>=limit:
                    rejects["SLEEVE_POSITION_CAP"]+=1;continue
                requested=c.gross
                if c.strategy=="V12":requested=min(requested,2.0-v12_gross)
                if c.strategy=="Q102":requested=min(requested,3.0)
                if c.strategy=="FET":requested=min(requested,2.25)
                granted=min(requested,3.0-total_gross)
                if granted<0.05:
                    rejects["RESEARCH_CRYPTO_GROSS_CAP"]+=1;continue
                # All bars needed to model the intended holding window must
                # exist. This is a COVERAGE filter, not an entry signal.
                horizon=min(c.max_hold_h,int((PERIOD_END_EXCLUSIVE.timestamp()*1000-ts)//HOUR))
                if any(not _bar_valid(bars[c.symbol].get(ts+i*HOUR)) for i in range(horizon)):
                    rejects["FUTURE_OUTCOME_COVERAGE_INCOMPLETE"]+=1;continue
                stop,target,note=model_protection(c,b.open,bars[c.symbol])
                if c.strategy=="V12" and stop is None:
                    rejects["PROXY_ATR_UNAVAILABLE"]+=1;continue
                if stop is not None and stop<=0:
                    rejects["INVALID_STOP_PROXY"]+=1;continue
                if c.strategy=="Q102" and not c.family:
                    rejects["UNKNOWN_Q102_FAMILY"]+=1;continue
                if daily_loss_start is not None and cash+sum(SIDE[p["side"]]*p["quantity"]*(bars[p["symbol"]][ts].open-p["entry_price"]) for p in positions)<daily_loss_start*0.925:
                    rejects["RESEARCH_DAILY_LOSS_LIMIT"]+=1;continue
                mid=b.open;entry_price=mid*(1+SIDE[c.side]*costs["entry_bps"]/10000)
                notional=equity*granted
                qty=notional/entry_price
                fee=notional*costs["fee_bps_each_side"]/10000
                if fee>=cash:
                    rejects["RESEARCH_CASH_FEE_SHORTAGE"]+=1;continue
                cash-=fee
                positions.append({"strategy":c.strategy,"symbol":c.symbol,"side":c.side,
                    "entry_ts":ts,"entry_price":entry_price,"quantity":qty,"gross":granted,
                    "family":c.family,"variant":c.variant,"stop":stop,"target":target,
                    "hold_hours":c.max_hold_h,"highest_favorable":entry_price,
                    "funding":0.0,"entry_fee":fee,"source_sha":c.raw.get("source_runtime_sha"),
                    "protection_note":note})
                total_gross+=granted
                if c.strategy=="V12":v12_gross+=granted
        # Record month-end NAV as-of each final H1 close. This includes model
        # marks, not an observed executable liquidation quote.
        next_hour=ts+HOUR
        if next_hour>=int(PERIOD_END_EXCLUSIVE.timestamp()*1000) or datetime.fromtimestamp(next_hour/1000,timezone.utc).month!=datetime.fromtimestamp(ts/1000,timezone.utc).month:
            nav=_nav(cash,positions,bars,ts,"close")
            if nav is None:raise ValueError("MONTH_END_MARK_UNAVAILABLE")
            net=nav-total_contrib
            adjusted=nav/max(total_contrib,1e-12)
            highest_adjusted=max(highest_adjusted,adjusted)
            max_dd=min(max_dd,(adjusted/highest_adjusted-1) if highest_adjusted>0 else 0)
            month_nav.append({"month":datetime.fromtimestamp(ts/1000,timezone.utc).strftime("%Y-%m"),
                "nav_usdt_proxy":round(nav,6),"contributions_usdt":round(total_contrib,6),
                "net_after_contributions_usdt":round(net,6),
                "open_positions":len(positions)})
    # No guessed forced liquidation if the last bar still has a position.
    final=month_nav[-1]["nav_usdt_proxy"] if month_nav else None
    profit=sum(v for v in closed_pnl if v>0)
    losses=-sum(v for v in closed_pnl if v<0)
    return {"model":model,"status":"MODELED_RESEARCH_ONLY_NOT_FORMAL_VERIFIED",
        "final_nav_usdt_proxy":final,
        "net_return_after_usdt_contributions":round(final-total_contrib,6) if final is not None else None,
        "closed_proxy_trades":len(closed_pnl),
        "wins":sum(v>0 for v in closed_pnl),"losses":sum(v<0 for v in closed_pnl),
        "win_rate_pct":round(100*sum(v>0 for v in closed_pnl)/len(closed_pnl),4) if closed_pnl else None,
        "profit_factor":round(profit/losses,4) if losses else None,
        "monthly_model_marks":month_nav,"max_contribution_adjusted_month_end_drawdown_pct":round(max_dd*100,4),
        "strategy_proxy_net_pnl_usdt":dict(sorted((k,round(v,6)) for k,v in per_strategy.items())),
        "rejection_reasons":dict(rejects),
        "unclosed_proxy_positions":len(positions),
        "ledger":ledger,
        "assumed_fees_bps_per_side":costs["fee_bps_each_side"],
        "assumed_entry_impact_bps":costs["entry_bps"],
        "assumed_exit_impact_bps":costs["exit_bps"]}

def run(data_root:Path,scan_root:Path,output_root:Path)->dict[str,Any]:
    manifest=load_manifest(Path(__file__).with_name("runtime_source_manifest.json"))
    active=manifest["verified_repository_commit"]
    if not(active==manifest["runtime_sha"]==manifest["active_release_id"]==
           "a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"):
        raise ValueError("PINNED_ACTIVE_SOURCE_NOT_IDENTICAL")
    acquisition=json.loads((data_root/"acquisition-manifest.json").read_text())
    if acquisition["runtime_sha"]!=active:raise ValueError("ACQUISITION_SHA_MISMATCH")
    scan_manifests,_=_load_signal_scan_manifests(scan_root)
    if len(scan_manifests)!=2 or any(x.get("runtime_sha")!=active for x in scan_manifests.values()):
        raise ValueError("SCAN_PROVENANCE_NOT_VERIFIED")
    scans,scan_sha=_load_signal_rows(scan_root)
    candidates=[]
    for strategy,rows in scans.items():
        for row in rows:
            if row.get("source_runtime_sha")!=active:raise ValueError("ROW_SOURCE_SHA_MISMATCH")
            c=to_candidate(strategy,row)
            if c and int(PERIOD_START.timestamp()*1000)<=c.enter_ms<int(PERIOD_END_EXCLUSIVE.timestamp()*1000):
                candidates.append(c)
    symbols={c.symbol for c in candidates}
    bars={};funding={};coverage={}
    for symbol in sorted(symbols):
        dataset=load_aster_dataset(data_root,symbol)
        bars[symbol]={b.event_time_ms:b for b in dataset.bars}
        funding[symbol]=_funding_map(dataset)
        coverage[symbol]={"bars":len(dataset.bars),"funding_rows":len(dataset.funding),
            "blocking_issues":[x.code for x in dataset.issues if x.blocking][:12],
            "aster_normalized_sha256":dataset.normalized_sha256}
    fx,issues=load_fred_fx(data_root)
    if issues or not fx:raise ValueError("FX_OBSERVATIONS_UNAVAILABLE")
    deposits=list(monthly_deposit_events(fx))
    scenarios=[];output_root.mkdir(parents=True,exist_ok=True)
    for name in MODELS:
        result=simulate(candidates,bars,funding,deposits,name)
        ledger=result.pop("ledger")
        ledger_meta=_write_jsonl_gz(output_root/f"{name}-model-ledger.jsonl.gz",ledger)
        result["ledger_file"]=ledger_meta
        # No private trade/price series leave this local run directory.
        (output_root/f"{name}-research-proxy-metrics.json").write_bytes(canonical(result))
        scenarios.append({k:v for k,v in result.items() if k!="monthly_model_marks"})
    report={"status":"MODELED_RESEARCH_ONLY_NOT_FORMAL_VERIFIED",
        "reason":"Unverified historical orderbook sequence, fee tiers, exit parity, margin guard, V52 stock perpetual prices. All fills modeled on Aster H1 bars.",
        "runtime_sha":active,"candidate_count":len(candidates),
        "signal_counts":dict(Counter(c.strategy for c in candidates)),
        "coverage":coverage,"scan_sha256":scan_sha,"fx_observations":len(fx),
        "fx_source":fx[0].exchange,"contribution_events":len(deposits),
        "excluded_logic":{"V52":"HISTORICAL_STOCK_PERPETUAL_QUOTES_BOOK_AND_EXECUTION_UNVERIFIED",
            "HYPE":"NOT_IN_PINNED_A09_PRODUCTION_RELEASE","ZEC":"NOT_IN_PINNED_A09_PRODUCTION_RELEASE"},
        "assumptions":["ASTER_NEXT_H1_OPEN_MODEL_FILL","COSTS_AND_FEE_BPS_RESEARCH_ASSUMPTIONS",
            "MAX_THREE_CRYPTO_GROSS_AND_SIMPLE_SLEEVE_CAPS_NOT_EXACT_LIVE_ALLOCATOR",
            "NO_INTRABAR_TICK_ORDERING_STOP_FIRST","Q102_TIME_EXIT_ONLY_EXACT_FAMILY_EXITS_NOT_REPLAYED",
            "NO_VERIFIED_HISTORICAL_L2_DEPTH","NOT_A_FORMAL_FIVE_LOGIC_BACKTEST"],
        "scenarios":scenarios}
    (output_root/"ohlc-proxy-run-manifest.json").write_bytes(canonical(report))
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root",required=True,type=Path)
    parser.add_argument("--scan-root",required=True,type=Path)
    parser.add_argument("--output-root",required=True,type=Path)
    a=parser.parse_args()
    r=run(a.data_root,a.scan_root,a.output_root)
    # Only non-licensed summary metrics go to the workflow log.
    print(json.dumps({"status":r["status"],"runtime_sha":r["runtime_sha"],
        "candidate_count":r["candidate_count"],"counts":r["signal_counts"],
        "summary":[{"model":s["model"],"status":s["status"],
            "closed_proxy_trades":s["closed_proxy_trades"],
            "win_rate_pct":s["win_rate_pct"],"profit_factor":s["profit_factor"],
            "final_nav_usdt_proxy":s["final_nav_usdt_proxy"],
            "unclosed_proxy_positions":s["unclosed_proxy_positions"],
            "rejections":s["rejection_reasons"]} for s in r["scenarios"]]},sort_keys=True))
if __name__=="__main__":main()
