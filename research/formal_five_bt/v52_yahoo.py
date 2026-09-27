"""V52 Yahoo-Finance 60m historical *assumed-fill* research replay.

No L2, depth, queue, or fill audit is required in this user-authorized
counterfactual. Yahoo is the equity *reference*; optional Aster H1 stock-perp
marks supply V52's distinct basis denominator. Yahoo alone cannot prove the
V11/V50 basis signals, so source-incomplete decisions stay unavailable by
default. An explicitly opted-in Yahoo-only momentum experiment is a DIFFERENT
STRATEGY and must never be labeled production V52.

All quote observations use their 60m bar OPEN available at the quoted time.
The intrabar close/high/low cannot be consulted for earlier signal decisions.
10-second V50 capture and true venue price/volume are unavailable; the
snapshot is a labeled point-in-time H1 approximation.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping
from zoneinfo import ZoneInfo
import hashlib
import json
import math

from .calendars import nyse_close_utc

NY = ZoneInfo("America/New_York")
SYMBOLS = ("AMZN", "META", "MSFT", "NVDA", "TSLA")
SOURCE = "YAHOO_FINANCE_60M_UNADJUSTED_CHART"
LIVE_SHA = "a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"
PERIOD_START = date(2025,8,10)
PERIOD_END = date(2026,8,10)
V11_BASIS_MIN = 50.
V11_CONVERGENCE = 15.
V11_STOP_MULT = 1.5
V50_BASIS_MIN = 60.
V50_CONVERGENCE = 20.
V50_STOP_MULT = 1.75
V50_NET_EDGE_MIN = 7.5
V50_COST_MAX = 60.
V50_HOLD_HOURS = 3
USD_NOTE = "ASTER_STOCK_USDT_PERP_VS_YAHOO_USD_STOCK_USDT_USD_PARITY_ASSUMED"
ASSUMED_NORMAL_COST_BPS = 20.
ASSUMED_SEVERE_COST_BPS = 55.
MAX_OBSERVATION_AGE_SECS = 3600

@dataclass(frozen=True)
class HourOpen:
    symbol: str
    ts: int
    open: float
    high: float
    low: float
    close: float
    source: str

def _positive(x: Any) -> float:
    value = float(x)
    if not math.isfinite(value) or value<=0:
        raise ValueError("INVALID_PRICE")
    return value

def _ts(local_day: date, h:int, m:int, s:int=0)->int:
    return int(datetime.combine(local_day,time(h,m,s),tzinfo=NY).timestamp())

def yahoo_chart_to_opens(raw: Mapping[str,Any],symbol:str) -> tuple[HourOpen,...]:
    """One-year chart JSON only; refuse Yahoo daily bars and future-bar leakage."""
    if symbol not in SYMBOLS: raise ValueError("UNKNOWN_STOCK")
    chart=raw.get("chart") or {}
    if chart.get("error"):raise ValueError("YAHOO_CHART_ERROR:"+str(chart["error"]))
    results=chart.get("result") or []
    if len(results)!=1:raise ValueError("YAHOO_CHART_RESULT_MISSING")
    data=results[0]
    meta=data.get("meta") or {}
    if str(meta.get("symbol") or "").upper()!=symbol:raise ValueError("YAHOO_SYMBOL_MISMATCH")
    if meta.get("currency")!="USD":raise ValueError("YAHOO_CURRENCY_NOT_USD")
    if meta.get("exchangeTimezoneName")!="America/New_York":
        raise ValueError("YAHOO_EXCHANGE_TIMEZONE_MISMATCH")
    if meta.get("dataGranularity") not in ("60m","1h"):
        raise ValueError("YAHOO_INTRADAY_60M_REQUIRED")
    if (data.get("events") or {}).get("splits"):
        raise ValueError("YAHOO_SPLIT_UNADJUSTED_SERIES_REQUIRES_RECONCILIATION")
    stamp=data.get("timestamp") or []
    quote=((data.get("indicators") or {}).get("quote") or [None])[0] or {}
    if not stamp or any(len(quote.get(k) or [])!=len(stamp) for k in ("open","high","low","close")):
        raise ValueError("YAHOO_INCOMPLETE_QUOTE_ARRAYS")
    rows=[]
    last=0
    for i,t in enumerate(stamp):
        ts=int(t)
        if ts<=last:raise ValueError("YAHOO_TIMESTAMPS_NOT_ASCENDING")
        last=ts
        local=datetime.fromtimestamp(ts,NY)
        if local.weekday()>=5 or not (9<=local.hour<=15):continue
        if local.minute!=30:raise ValueError("YAHOO_UNEXPECTED_BAR_ANCHOR")
        prices=tuple(quote[k][i] for k in ("open","high","low","close"))
        if any(x is None for x in prices):continue
        o,h,l,c=(_positive(x) for x in prices)
        if l>min(o,c) or h<max(o,c) or h<l:
            raise ValueError("YAHOO_INVALID_OHLC")
        rows.append(HourOpen(symbol,ts,o,h,l,c,SOURCE))
    if not rows:raise ValueError("YAHOO_NO_VALID_SESSION_OPENS")
    return tuple(rows)

def aster_stock_h1_to_opens(raw: list[list[Any]],symbol:str)->tuple[HourOpen,...]:
    if symbol not in SYMBOLS:raise ValueError("UNKNOWN_STOCK")
    rows=[];last=0
    for x in raw:
        if not isinstance(x,list) or len(x)<7:raise ValueError("ASTER_INVALID_KLINE")
        ts=int(x[0])//1000
        if ts<=last or ts%3600!=0:raise ValueError("ASTER_STOCK_H1_BAD_TIMELINE")
        last=ts
        o,h,l,c=(_positive(x[i]) for i in (1,2,3,4))
        if l>min(o,c) or h<max(o,c) or h<l:raise ValueError("ASTER_STOCK_BAD_OHLC")
        rows.append(HourOpen(symbol,ts,o,h,l,c,"ASTER_NATIVE_STOCK_PERP_H1_OPEN"))
    return tuple(rows)

def _available(rows: tuple[HourOpen,...],at:int)->HourOpen|None:
    # Never pick next candle's opening price: its start timestamp is unknown.
    from bisect import bisect_right
    ts=[b.ts for b in rows]
    idx=bisect_right(ts,at)-1
    if idx<0:return None
    b=rows[idx]
    return b if 0<=at-b.ts<=MAX_OBSERVATION_AGE_SECS else None

def observe(stock:tuple[HourOpen,...],perp:tuple[HourOpen,...],at:int)->dict|None:
    cash=_available(stock,at);future=_available(perp,at)
    if cash is None or future is None:return None
    basis=(future.open/cash.open-1)*10000.
    return {"time":at,"yahoo_ref":cash.open,"yahoo_observed_ts":cash.ts,
      "aster_perp":future.open,"aster_observed_ts":future.ts,
      "basis_bps":basis,"reference_source":SOURCE,
      "perp_source":future.source,"quote_precision":"60M_OPEN_PROXY_NOT_TRUE_INTRAMINUTE"}

def _valid_session(day:date)->bool:
    return nyse_close_utc(day) is not None

def _stock_sessions(yahoo:Mapping[str,tuple[HourOpen,...]])->list[date]:
    dates=set()
    for rows in yahoo.values():
        for b in rows:
            d=datetime.fromtimestamp(b.ts,NY).date()
            if PERIOD_START<=d<=PERIOD_END and _valid_session(d):dates.add(d)
    return sorted(dates)

def _decision(symbol:str,day:date,route:str,window:str,signal:dict|None,
              entry:dict|None,cost_bps:float,others:Mapping[str,dict|None])->dict:
    ts=(_ts(day,10,30) if route=="V11_EQ" else _ts(day,int(window.split(":")[0]),30))
    record={"strategy":"V52","route":route,"symbol":symbol,"window_ny":window,
      "date_ny":day.isoformat(),"decision_ts":ts,"source":SOURCE,
      "fill_assumption":"AT_DECISION_YAHOO_60M_BAR_OPEN_IF_GATE_PASSES_NO_BOOK",
      "execution_provenance":"COUNTERFACTUAL_NOT_OBSERVED",
      "gate_status":"NOT_VERIFIABLE","gate_reasons":[]}
    if signal is None or entry is None:
        record["gate_reasons"]=["YAHOO_OR_ASTER_PRICE_AT_SIGNAL_OR_ENTRY_UNAVAILABLE"]
        return record
    sb=signal["basis_bps"];eb=entry["basis_bps"]
    ranking={sym:abs(q["basis_bps"]) for sym,q in others.items() if q is not None}
    winner=min((sym for sym in ranking if ranking[sym]==max(ranking.values())),default=None) if ranking else None
    if route=="V11_EQ":
        checks={"MIN_BASIS_50":abs(eb)>=V11_BASIS_MIN,
          "SAME_SELECTED_TOP1":winner==symbol,
          "NO_ADVERSE_BASIS_OVER_10":max(0,abs(eb)-abs(sb))<=10.,
          "NET_EDGE_AT_LEAST_10":abs(eb)-V11_CONVERGENCE-cost_bps>=10.,
          "COST_TO_BASIS_UP_TO_75PCT":cost_bps<=.75*abs(eb),
          "COST_AT_MOST_60":cost_bps<=60.}
    else:
        checks={"MIN_BASIS_60":abs(eb)>=V50_BASIS_MIN,
          "SAME_BASIS_SIGN":sb*eb>0.,
          "NO_ADVERSE_BASIS_OVER_10":max(0,abs(eb)-abs(sb))<=10.,
          "NET_EDGE_AT_LEAST_7_5":abs(eb)-V50_CONVERGENCE-cost_bps>=V50_NET_EDGE_MIN,
          "COST_AT_MOST_60":cost_bps<=V50_COST_MAX}
    record.update({"captured_signal_basis_bps":sb,"entry_basis_bps":eb,
      "side":"SHORT" if eb>0 else "LONG",
      "source_reference_open":entry["yahoo_ref"],
      "source_perp_open":entry["aster_perp"],
      "signal_time":signal["time"],"basis_stock_perp":True,
      "gates":checks,"gate_reasons":[k for k,v in checks.items() if not v],
      "gate_status":"PASS_ASSUMED_FILL" if all(checks.values()) else "BLOCKED"})
    return record

def _modeled_exit(record:dict,day:date,stock:tuple[HourOpen,...],perp:tuple[HourOpen,...],
                 cost_bps:float)->dict|None:
    start=int(record["decision_ts"]);eb=float(record["entry_basis_bps"])
    expiry=min(start+(3 if record["route"]=="V50_POST_OPEN_BASIS" else 5)*3600,
               _ts(day,15,30))
    if expiry<=start:return None
    stride=3600
    checkpoints=[]
    for when in range(start+stride,expiry+1,stride):
        point=observe(stock,perp,when)
        if point is not None:checkpoints.append(point)
    if not checkpoints:return None
    threshold=V50_CONVERGENCE if record["route"]=="V50_POST_OPEN_BASIS" else V11_CONVERGENCE
    multiple=V50_STOP_MULT if record["route"]=="V50_POST_OPEN_BASIS" else V11_STOP_MULT
    exit=checkpoints[-1];why="MODELED_TIME_EXIT"
    for point in checkpoints:
        b=point["basis_bps"]
        if abs(b)<=threshold or b*eb<=0:
            exit=point;why="MODELED_BASIS_CONVERGED";break
        if abs(b)>=multiple*abs(eb):
            exit=point;why="MODELED_BASIS_STOP";break
    side=-1 if record["side"]=="SHORT" else 1
    # User-authorized fill on Yahoo equity reference price, NOT an Aster order.
    entry=float(record["source_reference_open"])
    exit_price=exit["yahoo_ref"]
    raw=side*(exit_price/entry-1.)
    cost=cost_bps/10000.
    return {**record,"exit_ts":exit["time"],"exit_reference_open":exit_price,
      "gross_reference_return":raw,"net_reference_return_after_assumed_roundtrip_cost":raw-cost,
      "assumed_roundtrip_cost_bps":cost_bps,"exit_reason":why,
      "entry_price_type":"YAHOO_60M_OPEN_MODEL","exit_price_type":"YAHOO_60M_OPEN_MODEL",
      "price_venue":"YAHOO_EQUITY_REFERENCE_NOT_ASTER_PERP_FILL",
      "funding_unverified":True}

def replay_yahoo_v52(yahoo:Mapping[str,tuple[HourOpen,...]],
                     aster:Mapping[str,tuple[HourOpen,...]],
                     *,assumed_cost_bps:float=ASSUMED_NORMAL_COST_BPS)->dict:
    """Rebuild all V11/V50 decisions; each user-specified eligible entry assumes fill."""
    if not (0<=assumed_cost_bps<=60):raise ValueError("ASSUMED_COST_OUT_OF_RANGE")
    if set(yahoo)!=set(SYMBOLS):raise ValueError("YAHOO_FIVE_EQUITIES_REQUIRED")
    if set(aster)!=set(SYMBOLS):raise ValueError("ASTER_PERP_FIVE_EQUITIES_REQUIRED")
    decisions=[];trades=[];blocked=Counter();positions={}
    for day in _stock_sessions(yahoo):
        if not _valid_session(day):continue
        # V11 capture 10:00, entry at 10:30. V50 captures 10s before each gate.
        snapshots={sym:observe(yahoo[sym],aster[sym],_ts(day,10,0)) for sym in SYMBOLS}
        winner=min((sym for sym,q in snapshots.items() if q and
             abs(q["basis_bps"])==max(abs(z["basis_bps"]) for z in snapshots.values() if z)),default=None)
        # Cash proxy chart has no 10-second data: mark sampling approximation explicitly.
        for route,window,signal_at,gate_at in (
            ("V11_EQ","10:30",(10,0,0),(10,30,0)),
            ("V50_POST_OPEN_BASIS","11:30",(11,29,50),(11,30,0)),
            ("V50_POST_OPEN_BASIS","12:30",(12,29,50),(12,30,0)),
            ("V50_POST_OPEN_BASIS","13:30",(13,29,50),(13,30,0))):
            local_gate=datetime.combine(day,time(*gate_at),tzinfo=NY).astimezone(timezone.utc)
            if not (datetime.fromtimestamp(PERIOD_START.toordinal(),timezone.utc) if False else True):
                pass
            if nyse_close_utc(day) is None or local_gate>=nyse_close_utc(day):
                continue
            signal_time=_ts(day,*signal_at);entry_time=_ts(day,*gate_at)
            signals=snapshots if route=="V11_EQ" else {
                sym:observe(yahoo[sym],aster[sym],signal_time) for sym in SYMBOLS}
            entries={sym:observe(yahoo[sym],aster[sym],entry_time) for sym in SYMBOLS}
            ordered=(winner,) if route=="V11_EQ" and winner is not None else SYMBOLS
            for sym in ordered:
                r=_decision(sym,day,route,window,signals[sym],entries[sym],assumed_cost_bps,entries)
                if r["gate_status"]!="PASS_ASSUMED_FILL":
                    decisions.append(r);blocked.update(r["gate_reasons"]);continue
                # Keep stock symbol and route slot competition; do not create
                # multiple fills from one assumed account allocation.
                key=(day,route)
                if any(x.get("date_ny")==day.isoformat() and x["symbol"]==sym
                       and not (int(x["exit_ts"])<=entry_time) for x in trades):
                    r["gate_status"]="BLOCKED";r["gate_reasons"]=["SAME_STOCK_SYMBOL_ACTIVE"]
                    decisions.append(r);blocked.update(r["gate_reasons"]);continue
                if any(x.get("date_ny")==day.isoformat() and x["route"]==route
                       and not (int(x["exit_ts"])<=entry_time) for x in trades):
                    r["gate_status"]="BLOCKED";r["gate_reasons"]=["V52_ROUTE_SLOT_OCCUPIED"]
                    decisions.append(r);blocked.update(r["gate_reasons"]);continue
                completed=_modeled_exit(r,day,yahoo[sym],aster[sym],assumed_cost_bps)
                if completed is None:
                    r["gate_status"]="NOT_VERIFIABLE";r["gate_reasons"]=["FUTURE_YAHOO_OR_PERP_EXIT_MARK_UNAVAILABLE"]
                    decisions.append(r);blocked.update(r["gate_reasons"]);continue
                decisions.append(r);trades.append(completed)
    pnl=[t["net_reference_return_after_assumed_roundtrip_cost"] for t in trades]
    wins=sum(v>0 for v in pnl);profit=sum(v for v in pnl if v>0);loss=-sum(v for v in pnl if v<0)
    return {"schema":"YAHOO_V52_ASSUMED_FILL_RESEARCH_V1",
      "status":"MODELED_YAHOO_REFERENCE_NOT_FORMAL_ASTER_EXECUTION",
      "production_source_sha":LIVE_SHA,
      "stock_price_source":SOURCE,"basis_source":"ASTER_STOCK_PERP_H1_OPEN",
      "roundtrip_cost_bps_assumed":assumed_cost_bps,
      "not_real_v52_tick_parity":True,
      "assumptions":[USD_NOTE,"YAHOO_60M_OPEN_BOTH_ENTRY_EXIT","ASTER_H1_OPEN_BASIS",
                     "NO_BOOK_SPREAD_DEPTH_REJECTION","V50_10SEC_CAPTURE_APPROXIMATED",
                     "SAME_HOUR_QUOTES_ARE_LAST_KNOWN_BAR_OPEN","NO_STOCK_FUNDING",
                     "NO_STOCK_OR_TOTAL_PORTFOLIO_GROSS_SIMULATION"],
      "decisions":decisions,"trades":trades,"rejections":dict(blocked),
      "modeled_closed_trades":len(trades),"win_rate_pct":round(wins/len(pnl)*100,5) if pnl else None,
      "unit_profit_factor":round(profit/loss,5) if loss else None}

def save_results(result:dict,output:Path)->dict:
    output.mkdir(parents=True,exist_ok=True)
    artifacts={}
    for name,rows in (("decision-gates.jsonl",result["decisions"]),("trades.jsonl",result["trades"])):
        path=output/name
        with path.open("w",encoding="utf8") as f:
            for row in rows:f.write(json.dumps(row,sort_keys=True,allow_nan=False)+"\n")
        artifacts[name]={"rows":len(rows),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}
    summary={k:v for k,v in result.items() if k not in ("decisions","trades")}
    summary["artifacts"]=artifacts
    (output/"result.json").write_text(json.dumps(summary,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
    return summary
