"""Five-sleeve chronological modeled BT: existing pinned crypto signals + Yahoo-priced V52.

The user authorizes a V52 no-L2 assumed-fill counterfactual. This is NOT
historically observed Aster executions or exact full production strategy
parity: crypto H1 bar and fee models, V12 ATR, Q102 family-specific exits,
V52 10s snapshots and live portfolio preemption are approximations.
The audited formal engine remains unchanged and NOT_VERIFIABLE.
"""
from __future__ import annotations

from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
import argparse
import hashlib
import json
import math

from . import v52_yahoo as stock
from .datasets import load_aster_dataset, load_fred_fx
from .engine import (PERIOD_START, PERIOD_END_EXCLUSIVE, _load_signal_rows,
                     _load_signal_scan_manifests, _write_jsonl_gz)
from .execution import resolve_ohlc_exit
from .ohlc_proxy import (HOUR, MODELS, PRIORITY, SIDE, _bar_valid, _funding_map,
                         canonical, model_protection, to_candidate)
from .portfolio import monthly_deposit_events

SOURCE_SHA="a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"
LABEL="RESEARCH_FIVE_SLEEVE_YAHOO_V52_NO_L2_ASSUMED_FILL_NOT_LIVE_PARITY"
START_MS=int(PERIOD_START.timestamp()*1000)
END_MS=int(PERIOD_END_EXCLUSIVE.timestamp()*1000)
STOCK_COST={"NORMAL":20.0,"SEVERE":55.0}
STOCK_LIMIT=4.0
STOCK_SLOT=2.0
TOTAL_LIMIT=4.25
CRYPTO_LIMIT=3.0
V12_LIMIT=2.0
FET_LIMIT=2.25
MAX_CANDIDATES=100000

def stock_opportunities(yahoo:Mapping[str,tuple],perp:Mapping[str,tuple],cost_bps:float)->tuple[list[dict],dict]:
    """All independent pre-allocation eligible V11/V50 candidates.

    Unlike the standalone V52 model, this does not reject an opportunity
    merely because *the standalone* earlier stock trade occupied its slot:
    the integrated account decides occupation at the true entry timestamp.
    """
    if set(yahoo)!=set(stock.SYMBOLS) or set(perp)!=set(stock.SYMBOLS):
        raise ValueError("V52_NATIVE_AND_REFERENCE_FIVE_SYMBOL_UNIVERSE_REQUIRED")
    candidates=[]
    counters=Counter()
    sessions=stock._stock_sessions(yahoo)
    for day in sessions:
        snapshots={sym:stock.observe(yahoo[sym],perp[sym],stock._ts(day,10,0))
                   for sym in stock.SYMBOLS}
        ranked=sorted(((-abs(q["basis_bps"]),sym) for sym,q in snapshots.items() if q))
        first=ranked[0][1] if ranked else None
        for route,window,capture,decision in (
            ("V11_EQ","10:30",(10,0,0),(10,30,0)),
            ("V50_POST_OPEN_BASIS","11:30",(11,29,50),(11,30,0)),
            ("V50_POST_OPEN_BASIS","12:30",(12,29,50),(12,30,0)),
            ("V50_POST_OPEN_BASIS","13:30",(13,29,50),(13,30,0))):
            entry=stock._ts(day,*decision)
            close=stock.nyse_close_utc(day)
            if close is None or entry>=int(close.timestamp()):
                continue
            signals=snapshots if route=="V11_EQ" else {
                s:stock.observe(yahoo[s],perp[s],stock._ts(day,*capture))
                for s in stock.SYMBOLS}
            entries={s:stock.observe(yahoo[s],perp[s],entry) for s in stock.SYMBOLS}
            for sym in ((first,) if route=="V11_EQ" and first else stock.SYMBOLS if route!="V11_EQ" else ()):
                r=stock._decision(sym,day,route,window,signals[sym],entries[sym],
                                  cost_bps,entries)
                counters["all_route_decisions"]+=1
                if r["gate_status"]!="PASS_ASSUMED_FILL":
                    counters.update("GATE_"+str(x) for x in r.get("gate_reasons",[]))
                    continue
                counters["gate_passed_before_portfolio"]+=1
                outcome=stock._modeled_exit(r,day,yahoo[sym],perp[sym],cost_bps)
                if outcome is None:
                    counters["unpriceable_future_exit_excluded_research"]+=1
                    continue
                if not (START_MS<=int(outcome["decision_ts"])*1000<END_MS):
                    continue
                if outcome["decision_ts"]>=outcome["exit_ts"]:
                    raise ValueError("STOCK_NO_VALID_EXIT_TIMESTAMP")
                candidates.append(outcome)
    candidates.sort(key=lambda x:(x["decision_ts"],0 if x["route"]=="V11_EQ" else 1,
                                  -abs(x["entry_basis_bps"]),x["symbol"]))
    counters["all_complete_opportunities"]=len(candidates)
    counters["NYSE_sessions"]=len(sessions)
    return candidates,dict(counters)

def _stock_asof(stock_rows:tuple,at_ms:int)->float|None:
    # Aster stock-perp is ONLY used in the entry/exit basis gate. Portfolio
    # is marked in the user's chosen Yahoo common-stock reference, not Aster.
    seconds=at_ms//1000
    stamps=[x.ts for x in stock_rows]
    i=bisect_right(stamps,seconds)-1
    if i<0 or seconds-stamps[i]>3600:
        return None
    return stock_rows[i].open

def simulate(crypto_candidates:list,crypto_bars:Mapping[str,Mapping[int,Any]],
             funding:Mapping[str,Mapping[int,float]],stock_candidates:list[dict],
             yahoo:Mapping[str,tuple],deposits:list[Any],fx_series:list[Any],
             model:str)->dict[str,Any]:
    if model not in MODELS:raise ValueError("SCENARIO_MISSING")
    crypto_cost=MODELS[model]
    stock_roundtrip=STOCK_COST[model]
    stock_each=stock_roundtrip/2
    by_crypto=defaultdict(list)
    for c in crypto_candidates:
        if c.enter_ms%HOUR:raise ValueError("CRYPTO_ENTRY_NOT_HOUR")
        by_crypto[c.enter_ms].append(c)
    by_stock=defaultdict(list)
    for c in stock_candidates:
        when=int(c["decision_ts"])*1000
        if when%(HOUR//2):raise ValueError("STOCK_ENTRY_NOT_HALFHOUR")
        by_stock[when].append(c)
    deposit_map=defaultdict(list)
    for d in deposits:deposit_map[d.timestamp_ms].append(d)
    fx=sorted(fx_series,key=lambda x:x.event_time_ms)
    fx_times=[x.event_time_ms for x in fx]
    if not fx:raise ValueError("FX_MISSING")
    def fx_asof(ts):
        i=bisect_right(fx_times,ts)-1
        if i<0 or ts-fx_times[i]>7*24*HOUR:
            raise ValueError("FX_STALE_AT_MONTH_END:"+str(ts))
        return fx[i].rate_jpy_per_usd
    open_crypto=[];open_stock=[]
    cash=0.0;units=0.0;contributed=0.0;contributed_jpy=0.0
    fees=0.0;realized_by=Counter();realized_by_stock_route=Counter()
    rejected=Counter();ledger=[];monthly=[];peak_nav_unit=1.0;max_dd=0.0
    daily_start=None;daily_date=None;ny_stock_date=None;ny_stock_start=None;ny_stock_realized=0.0
    peak={"crypto":0.0,"stock":0.0,"total":0.0,"V12":0.0}
    expected_symbol_timeline=set(crypto_bars)
    def crypto_mark(p,ts):
        key=(ts//HOUR)*HOUR
        b=crypto_bars[p["symbol"]].get(key)
        if not _bar_valid(b):
            raise ValueError("OPEN_CRYPTO_UNPRICEABLE:"+p["symbol"]+":"+str(ts))
        return b.open
    def stock_mark(p,ts):
        mark=_stock_asof(yahoo[p["symbol"]],ts)
        if mark is None:
            raise ValueError("OPEN_STOCK_YAHOO_REFERENCE_MISSING:"+p["symbol"]+":"+str(ts))
        return mark
    def marked(ts):
        v=cash
        for p in open_crypto:v+=SIDE[p["side"]]*p["quantity"]*(crypto_mark(p,ts)-p["entry_price"])
        for p in open_stock:v+=SIDE[p["side"]]*p["quantity"]*(stock_mark(p,ts)-p["entry_price"])
        if not math.isfinite(v):
            raise ValueError("NAV_NON_FINITE")
        return v
    def gross(ts,nav):
        cn=sum(p["quantity"]*crypto_mark(p,ts) for p in open_crypto)
        sn=sum(p["quantity"]*stock_mark(p,ts) for p in open_stock)
        vn=sum(p["quantity"]*crypto_mark(p,ts) for p in open_crypto if p["strategy"]=="V12")
        return {"crypto":cn/nav,"stock":sn/nav,"total":(cn+sn)/nav,"V12":vn/nav}
    def settle_crypto(p,when,price,reason,ambiguous):
        nonlocal cash,fees
        exit_price=price*(1-SIDE[p["side"]]*crypto_cost["exit_bps"]/10000)
        gross_pnl=SIDE[p["side"]]*p["quantity"]*(exit_price-p["entry_price"])
        fee=p["quantity"]*exit_price*crypto_cost["fee_bps_each_side"]/10000
        cash+=gross_pnl-fee;fees+=fee
        net=gross_pnl+p["funding"]-fee-p["entry_fee"]
        realized_by[p["strategy"]]+=net
        ledger.append({"strategy":p["strategy"],"symbol":p["symbol"],"side":p["side"],
          "entry_ts_ms":p["entry_ts"],"exit_ts_ms":when,"entry_price":p["entry_price"],
          "exit_price":exit_price,"quantity":p["quantity"],"gross_at_entry":p["gross"],
          "net_pnl_usdt_proxy":net,"funding_usdt":p["funding"],"entry_fee_usdt":p["entry_fee"],
          "exit_fee_usdt":fee,"reason":reason,"ambiguous_intrabar":ambiguous,
          "source_sha":SOURCE_SHA,
          "fill_type":"CRYPTO_ASTER_H1_OHLC_ASSUMED_NOT_NATIVE_HISTORICAL_EXECUTION",
          "assumed_exit_route":p["protection_note"]})
    def settle_stock(p,when):
        nonlocal cash,fees,ny_stock_realized
        x=p["outcome"]
        if when!=int(x["exit_ts"])*1000:
            raise ValueError("STOCK_OUTCOME_TIME_MISMATCH")
        # This is Yahoo equity hypothetical P&L, NOT Aster stock-perp P&L.
        price=float(x["exit_reference_open"])
        gross_pnl=SIDE[p["side"]]*p["quantity"]*(price-p["entry_price"])
        fee=p["quantity"]*price*stock_each/10000
        net=gross_pnl-p["entry_fee"]-fee
        cash+=gross_pnl-fee;fees+=fee
        realized_by["V52"]+=net
        realized_by_stock_route[p["route"]]+=net
        ny_stock_realized+=net
        ledger.append({"strategy":"V52","route":p["route"],"symbol":p["symbol"],
          "side":p["side"],"entry_ts_ms":p["entry_ts"],"exit_ts_ms":when,
          "entry_price":p["entry_price"],"exit_price":price,"quantity":p["quantity"],
          "gross_at_entry":p["gross"],"net_pnl_usdt_proxy":net,
          "entry_fee_usdt":p["entry_fee"],"exit_fee_usdt":fee,
          "reason":x["exit_reason"],"source_sha":SOURCE_SHA,
          "fill_type":"USER_AUTHORIZED_YAHOO_EQUITY_ASSUMED_AT_GATE_AND_EXIT_NO_BOOK",
          "basis_source":"ASTER_NATIVE_STOCK_H1_PLUS_YAHOO_REFERENCE_60M",
          "basis_bps":x["entry_basis_bps"],"window_ny":x["window_ny"]})
    last_month=None;stock_count=0;crypto_count=0;deposit_events=0
    for ts in range(START_MS,END_MS,HOUR//2):
        current=datetime.fromtimestamp(ts/1000,timezone.utc)
        month=current.strftime("%Y-%m")
        if last_month is not None and month!=last_month:
            if open_stock:
                raise ValueError("STOCK_OPEN_AT_UTC_MONTH_ROLLOVER")
            nav=marked(ts)
            rate=fx_asof(ts-1)
            monthly.append({"month":last_month,"asof_ms":ts,"nav_usd_model":round(nav,6),
              "nav_jpy_model":round(nav*rate,2),"fx_source":"ECB_DAILY_CROSS_NOT_FRED",
              "contributions_jpy":round(contributed_jpy,2),
              "net_after_contributions_jpy_model":round(nav*rate-contributed_jpy,2),
              "open_crypto_positions":len(open_crypto),"open_stock_positions":len(open_stock)})
        last_month=month
        utc_day=current.date()
        if utc_day!=daily_date:
            daily_date=utc_day
            daily_start=marked(ts) if (open_crypto or open_stock or cash>0) else 0.0
        # Stock daily guard anchors at NYSE opening (9:30 NY), not UTC midnight.
        ny_time=current.astimezone(stock.NY)
        if ny_time.hour==9 and ny_time.minute==30 and ny_time.date()!=ny_stock_date:
            ny_stock_date=ny_time.date()
            ny_stock_start=marked(ts) if (open_crypto or open_stock or cash>0) else 0.0
            ny_stock_realized=0.0
        if ts%HOUR==0:
            # Resolve the *completed previous* H1 bar; its future OHLC is NOT
            # accessible at the previous hour's opening.
            remaining=[]
            for p in open_crypto:
                if ts<=p["entry_ts"]:
                    remaining.append(p);continue
                prev=ts-HOUR
                b=crypto_bars[p["symbol"]].get(prev)
                if not _bar_valid(b):
                    raise ValueError("MANAGED_CRYPTO_COMPLETED_BAR_MISSING:"+p["symbol"])
                rate=funding.get(p["symbol"],{}).get(ts)
                if rate is not None:
                    funding_charge=-p["quantity"]*b.close*rate*SIDE[p["side"]]
                    cash+=funding_charge;p["funding"]+=funding_charge
                if p["strategy"]=="FET" and p["highest_favorable"]>=p["entry_price"]*1.05:
                    p["stop"]=max(p["stop"] or 0,p["entry_price"]*1.005)
                expiry=ts>=p["entry_ts"]+p["hold_hours"]*HOUR
                resolved=resolve_ohlc_exit(p["side"],bar_open=b.open,bar_high=b.high,
                    bar_low=b.low,bar_close=b.close,stop_price=p["stop"],target_price=p["target"],
                    time_exit=expiry)
                if resolved.status=="NOT_VERIFIABLE":
                    raise ValueError("CRYPTO_OHLC_UNRESOLVED")
                if resolved.exit_price is not None:
                    settle_crypto(p,ts,resolved.exit_price,resolved.reason,resolved.ambiguous_bar)
                    continue
                p["highest_favorable"]=(max(p["highest_favorable"],b.high)
                    if p["side"]=="LONG" else min(p["highest_favorable"],b.low))
                if p["strategy"]=="PENGU":
                    trigger=.15 if p["side"]=="LONG" else .10
                    retrace=.04 if p["side"]=="LONG" else .03
                    if SIDE[p["side"]]*(p["highest_favorable"]/p["entry_price"]-1)>=trigger:
                        trailing=p["highest_favorable"]*(1-retrace*SIDE[p["side"]])
                        p["stop"]=(max(p["stop"],trailing) if p["side"]=="LONG"
                                   else min(p["stop"],trailing))
                remaining.append(p)
            open_crypto=remaining
        if open_stock:
            kept=[]
            for p in open_stock:
                if int(p["outcome"]["exit_ts"])*1000==ts:
                    settle_stock(p,ts)
                elif int(p["outcome"]["exit_ts"])*1000<ts:
                    raise ValueError("STOCK_POSITION_EXIT_MISSED")
                else:kept.append(p)
            open_stock=kept
        # Convert deposits at their exact anniversary timestamps (no hindsight).
        nav=marked(ts)
        for d in deposit_map.get(ts,()):
            nav_per_unit=nav/units if units>0 else 1.0
            if nav_per_unit<=0:raise ValueError("EQUITY_DEPLETED_BEFORE_CONTRIBUTION")
            units+=d.amount_usdt/nav_per_unit
            cash+=d.amount_usdt;nav+=d.amount_usdt
            contributed+=d.amount_usdt;contributed_jpy+=d.amount_jpy;deposit_events+=1
        if nav<=0:
            # Exhausted account cannot fabricate a profitable later entry.
            rejected["MODEL_ACCOUNT_DEPLETED"]+=len(by_crypto.get(ts,[]))+len(by_stock.get(ts,[]))
            continue
        if ts%HOUR==0:
            due=sorted(by_crypto.get(ts,[]),key=lambda c:(PRIORITY[c.strategy],c.rank or 1,c.symbol))
            for c in due:
                b=crypto_bars.get(c.symbol,{}).get(ts)
                if not _bar_valid(b):
                    rejected["CRYPTO_ENTRY_BAR_UNAVAILABLE"]+=1;continue
                if any(p["symbol"]==c.symbol for p in open_crypto):
                    rejected["CRYPTO_SAME_SYMBOL_OWNED"]+=1;continue
                if sum(p["strategy"]==c.strategy for p in open_crypto)>=(3 if c.strategy=="V12" else 1):
                    rejected["CRYPTO_SLEEVE_SLOT_OCCUPIED"]+=1;continue
                nav=marked(ts);g=gross(ts,nav)
                permitted=min(c.gross,CRYPTO_LIMIT-g["crypto"],TOTAL_LIMIT-g["total"])
                if c.strategy=="V12":permitted=min(permitted,V12_LIMIT-g["V12"])
                if c.strategy=="Q102":permitted=min(permitted,3.0)
                if c.strategy=="FET":permitted=min(permitted,FET_LIMIT)
                if c.strategy=="PENGU":permitted=min(permitted,1.0)
                if permitted<.05:
                    rejected["INTEGRATED_CRYPTO_OR_TOTAL_GROSS_CAP"]+=1;continue
                if daily_start and nav<daily_start*(1-.075):
                    rejected["RESEARCH_SHARED_CRYPTO_DAILY_LOSS"]+=1;continue
                stop,target,note=model_protection(c,b.open,crypto_bars[c.symbol])
                if c.strategy=="V12" and stop is None:
                    rejected["V12_ASSUMED_ATR_PAST_CANDLES_INSUFFICIENT"]+=1;continue
                if stop is not None and stop<=0:
                    rejected["MODEL_INVALID_PROTECTION"]+=1;continue
                if c.strategy=="Q102" and not c.family:
                    rejected["MODEL_Q102_FAMILY_UNAVAILABLE"]+=1;continue
                price=b.open*(1+SIDE[c.side]*crypto_cost["entry_bps"]/10000)
                notional=nav*permitted
                qty=notional/price
                fee=notional*crypto_cost["fee_bps_each_side"]/10000
                if fee>=cash:
                    rejected["CRYPTO_CASH_FEE_SHORTAGE"]+=1;continue
                cash-=fee;fees+=fee
                open_crypto.append({"strategy":c.strategy,"symbol":c.symbol,"side":c.side,
                    "entry_ts":ts,"entry_price":price,"quantity":qty,"gross":permitted,
                    "stop":stop,"target":target,"hold_hours":c.max_hold_h,
                    "highest_favorable":price,"funding":0.0,"entry_fee":fee,
                    "protection_note":note})
                crypto_count+=1
        if ts in by_stock:
            # Only one V11/V50 slot per event, sorted on observed basis.
            for candidate in by_stock[ts]:
                if candidate.get("gate_status")!="PASS_ASSUMED_FILL":
                    rejected["STOCK_GATE_NOT_PASSED"]+=1;continue
                if not (float(candidate.get("source_reference_open") or 0)>0
                        and float(candidate.get("source_perp_open") or 0)>0):
                    rejected["STOCK_SOURCE_PRICE_INVALID"]+=1;continue
                if any(p["route"]==candidate["route"] for p in open_stock):
                    rejected["INTEGRATED_STOCK_ROUTE_OCCUPIED"]+=1;continue
                if any(p["symbol"]==candidate["symbol"] for p in open_stock):
                    rejected["INTEGRATED_STOCK_SYMBOL_OWNED"]+=1;continue
                nav=marked(ts);g=gross(ts,nav)
                if ny_stock_start and ny_stock_realized<=-.035*ny_stock_start:
                    rejected["RESEARCH_STOCK_DAILY_LOSS"]+=1;continue
                permitted=min(STOCK_SLOT,STOCK_LIMIT-g["stock"],TOTAL_LIMIT-g["total"])
                if permitted<.05:
                    rejected["INTEGRATED_STOCK_OR_TOTAL_GROSS_CAP_NO_PREEMPTION"]+=1
                    continue
                # User expressly replaces L2/queue checks with a deterministic
                # assumed fill at this gate timestamp, at Yahoo reference open.
                price=float(candidate["source_reference_open"])
                notional=nav*permitted
                fee=notional*stock_each/10000
                if fee>=cash:
                    rejected["STOCK_CASH_FEE_SHORTAGE"]+=1;continue
                cash-=fee;fees+=fee
                qty=notional/price
                open_stock.append({"strategy":"V52","route":candidate["route"],
                    "symbol":candidate["symbol"],"side":candidate["side"],
                    "entry_ts":ts,"entry_price":price,"quantity":qty,"gross":permitted,
                    "entry_fee":fee,"outcome":candidate})
                stock_count+=1
                break # best eligible currently available for this route at time
        nav=marked(ts)
        if units>0:
            per_unit=nav/units
            peak_nav_unit=max(peak_nav_unit,per_unit)
            max_dd=min(max_dd,per_unit/peak_nav_unit-1)
        if nav>0:
            current_g=gross(ts,nav)
            for name in peak:peak[name]=max(peak[name],current_g[name])
        if ts%(HOUR*24)==0 and len(open_stock)>0:
            raise ValueError("STOCK_OVERNIGHT_POSITION_MODEL_FORBIDDEN")
    final_nav=marked(END_MS) if open_crypto else cash
    if open_stock:raise ValueError("STOCK_NOT_CLOSED_AT_END")
    if units<=0:raise ValueError("NO_CONTRIBUTIONS")
    rate=fx_asof(END_MS-1)
    monthly.append({"month":last_month,"asof_ms":END_MS,"nav_usd_model":round(final_nav,6),
      "nav_jpy_model":round(final_nav*rate,2),"fx_source":"ECB_DAILY_CROSS_NOT_FRED",
      "contributions_jpy":round(contributed_jpy,2),
      "net_after_contributions_jpy_model":round(final_nav*rate-contributed_jpy,2),
      "open_crypto_positions":len(open_crypto),"open_stock_positions":len(open_stock)})
    positives=sum(max(0,x["net_pnl_usdt_proxy"]) for x in ledger)
    negatives=-sum(min(0,x["net_pnl_usdt_proxy"]) for x in ledger)
    return {"status":"MODELED_CHRONOLOGICAL_FIVE_NOT_LIVE_PARITY",
      "source_sha":SOURCE_SHA,"model":model,
      "entry_policy":"YAHOO_60M_OPEN_AT_V52_GATE_NO_BOOK_AND_ASTER_CRYPTO_H1_ASSUMED",
      "V52_basis_source":"ASTER_PUBLIC_STOCK_PERP_H1_OVER_YAHOO_FINANCE_60M",
      "contribution_events":deposit_events,"contributions_jpy":contributed_jpy,
      "contributions_usdt":round(contributed,6),
      "final_nav_usdt_model":round(final_nav,6),
      "final_nav_jpy_model":round(final_nav*rate,2),
      "final_net_jpy_model":round(final_nav*rate-contributed_jpy,2),
      "closed_trades_model":len(ledger),"stock_entries_model":stock_count,
      "crypto_entries_model":crypto_count,
      "unclosed_crypto_positions":len(open_crypto),
      "win_rate_pct_model":round(100*sum(x["net_pnl_usdt_proxy"]>0 for x in ledger)/len(ledger),5) if ledger else None,
      "profit_factor_model":round(positives/negatives,5) if negatives else None,
      "max_flow_adjusted_h1_and_30m_dd_pct_model":round(100*max_dd,5),
      "monthly_model":monthly,
      "strategy_net_pnl_usdt_model":{k:round(realized_by.get(k,0),6) for k in ("V12","PENGU","Q102","FET","V52")},
      "stock_route_net_pnl_usdt_model":{k:round(realized_by_stock_route.get(k,0),6)
            for k in ("V11_EQ","V50_POST_OPEN_BASIS")},
      "gross_peaks_model":{k:round(v,5) for k,v in peak.items()},
      "reject_counts":dict(sorted(rejected.items())),
      "fee_total_usdt_model":round(fees,6),
      "funding_input":"Aster native historical financing where provided; missing events untreated as zero-funding accuracy guarantee",
      "no_l2_execution_required_for_research":True,
      "formal_verified_fill_count":None,
      "historical_production_parity_verified":False,
      "limitations":[
        "V52 Yahoo common-stock hypothetical PnL not Aster perpetual PnL",
        "V52 60m bar opens approximate live 10sec signal and same-time reference",
        "V52 no observed spread depth queue or historical fee-tier",
        "No exact live V52 preemption of Q102 FET or dynamic V12 on stock entry",
        "Simplified fixed normal 3x crypto 4x stock and total 4.25x cap",
        "V12 H1 ATR approximates actual production H2 trailing and ATR",
        "Q102 time-expiry proxy does not reproduce exact family stop/reversal exits",
        "OHLC historical paths cannot establish intrabar order sequence",
        "Yahoo/Aster price outcome availability excludes missing-exit eligible stock candidates",
        "Historical Aster crypto slippage and true partial order fills remain unverified"],
      "ledger":ledger}

def run(crypto_data:Path,scan_root:Path,yahoo_root:Path,stock_root:Path,output:Path)->dict[str,Any]:
    frozen=json.loads(Path(__file__).with_name("runtime_source_manifest.json").read_text())
    if frozen["runtime_sha"]!=SOURCE_SHA or frozen["active_release_id"]!=SOURCE_SHA:
        raise ValueError("SOURCE_MANIFEST_DRIFT")
    acquisition=json.loads((crypto_data/"acquisition-manifest.json").read_text())
    if acquisition["runtime_sha"]!=SOURCE_SHA:raise ValueError("CRYPTO_SOURCE_SHA_DRIFT")
    yahoo_manifest=json.loads((yahoo_root/"acquisition-attempt.json").read_text())
    native=json.loads((stock_root/"aster-stock-h1-manifest.json").read_text())
    if yahoo_manifest["status"]!="ALL_5_YAHOO_PRICE_HISTORY_ACQUIRED" or native["pin_production_sha"]!=SOURCE_SHA:
        raise ValueError("STOCK_SOURCE_NOT_VERIFIED")
    yahoo={};perp={}
    for symbol in stock.SYMBOLS:
        p=yahoo_root/"raw-yahoo"/(symbol+".json")
        raw=p.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=yahoo_manifest["symbols"][symbol]["raw_sha256"]:
            raise ValueError("YAHOO_RAW_HASH_MISMATCH:"+symbol)
        yahoo[symbol]=stock.yahoo_chart_to_opens(json.loads(raw),symbol)
        info=native["symbols"][symbol]
        raw_stock=(stock_root/info["relative_path"]).read_bytes()
        if hashlib.sha256(raw_stock).hexdigest()!=info["sha256"]:
            raise ValueError("ASTER_STOCK_RAW_HASH_MISMATCH:"+symbol)
        perp[symbol]=stock.aster_stock_h1_to_opens(json.loads(raw_stock),symbol)
    scan_manifests,_=_load_signal_scan_manifests(scan_root)
    if len(scan_manifests)!=2 or any(x["runtime_sha"]!=SOURCE_SHA for x in scan_manifests.values()):
        raise ValueError("CRYPTO_SCAN_SOURCE_SHA_MISMATCH")
    rows,_=_load_signal_rows(scan_root)
    candidates=[]
    for strategy,items in rows.items():
        for row in items:
            if row["source_runtime_sha"]!=SOURCE_SHA:
                raise ValueError("CRYPTO_SIGNAL_SOURCE_SHA_MISMATCH")
            c=to_candidate(strategy,row)
            if c and START_MS<=c.enter_ms<END_MS:candidates.append(c)
    if len(candidates)>MAX_CANDIDATES:raise ValueError("CRYPTO_CANDIDATE_COUNT_IMPLAUSIBLE")
    symbols={c.symbol for c in candidates}
    bars={};funding={}
    for sym in symbols:
        ds=load_aster_dataset(crypto_data,sym)
        bars[sym]={x.event_time_ms:x for x in ds.bars}
        funding[sym]=_funding_map(ds)
        if not ds.bars:raise ValueError("CRYPTO_BARS_MISSING:"+sym)
    fx,issues=load_fred_fx(crypto_data)
    if not fx or issues:raise ValueError("ECB_FX_UNVERIFIED")
    deposits=list(monthly_deposit_events(fx))
    if len(deposits)!=13 or deposits[-1].cumulative_jpy!=130000:
        raise ValueError("INCORRECT_DEPOSIT_SCHEDULE")
    output.mkdir(parents=True,exist_ok=True)
    reports=[]
    for name in ("NORMAL","SEVERE"):
        stock_due,stats=stock_opportunities(yahoo,perp,STOCK_COST[name])
        result=simulate(candidates,bars,funding,stock_due,yahoo,deposits,list(fx),name)
        ledger=result.pop("ledger")
        meta=_write_jsonl_gz(output/(name+"-five-yahoo-model-ledger.jsonl.gz"),ledger)
        result["ledger_file"]=meta
        result["crypto_candidate_counts"]=dict(Counter(c.strategy for c in candidates))
        result["stock_candidate_availability"]=stats
        result["crypto_source_manifest_sha256"]=hashlib.sha256((crypto_data/"acquisition-manifest.json").read_bytes()).hexdigest()
        result["source_shas"]={
          "yahoo_manifest":hashlib.sha256((yahoo_root/"acquisition-attempt.json").read_bytes()).hexdigest(),
          "aster_stock_manifest":hashlib.sha256((stock_root/"aster-stock-h1-manifest.json").read_bytes()).hexdigest()}
        (output/(name+"-five-yahoo-model-metrics.json")).write_bytes(canonical(result))
        reports.append(result)
    meta={"status":"MODELED_FIVE_CHRONOLOGICAL_NOT_FORMAL",
      "production_sha":SOURCE_SHA,"period":"2025-08-10 through 2026-08-10 UTC inclusive",
      "initial_deposit_jpy":10000,"monthly_deposit_jpy":10000,"deposit_events":13,
      "total_contributions_jpy":130000,"sources":{
        "Yahoo":"YAHOO_FINANCE_VIA_YFINANCE_60M",
        "stock_basis":"ASTER_PUBLIC_NATIVE_USDT_STOCK_H1_OPEN",
        "crypto":"ASTER_PUBLIC_NATIVE_H1_AND_FUNDING",
        "fx":"ECB_DAILY_CROSS_NOT_FRED"},"scenarios":reports,
      "formal_five_strategy_BT_verified":False}
    (output/"five-yahoo-integrated-model-manifest.json").write_bytes(canonical(meta))
    return meta

def main()->None:
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("crypto-data","scan-root","yahoo-root","stock-root","output-root"):
        p.add_argument("--"+name,required=True,type=Path)
    a=p.parse_args()
    result=run(a.crypto_data,a.scan_root,a.yahoo_root,a.stock_root,a.output_root)
    for r in result["scenarios"]:
        print("FIVE_YAHOO_INTEGRATED_MODEL_RESEARCH_ONLY",json.dumps({
            k:r.get(k) for k in ("status","model","closed_trades_model","stock_entries_model",
              "crypto_entries_model","win_rate_pct_model","profit_factor_model",
              "final_nav_jpy_model","final_net_jpy_model",
              "max_flow_adjusted_h1_and_30m_dd_pct_model","strategy_net_pnl_usdt_model",
              "gross_peaks_model","reject_counts","stock_route_net_pnl_usdt_model")},sort_keys=True))
    print("FIVE_YAHOO_FORMAL_STATUS=NOT_VERIFIABLE LIVE_TRADING_MUTATION=0")
if __name__=="__main__":main()
