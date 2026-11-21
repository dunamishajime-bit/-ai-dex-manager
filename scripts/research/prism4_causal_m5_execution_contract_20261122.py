#!/usr/bin/env python3
"""PRISM IV: event-time research entry scenarios, no signed venue execution.

Purpose: prevent **decision-time** lookahead in the BT liquidity gate.
An M5 candle's volume and OHLC become knowable only at bar close.

Two separate and explicitly non-equivalent models:
  - FIRST_PRINT_UPPER_INFORMATION_BOUND: first positive-volume 5m bar OPEN.
    Uses a future observation ex post; NOT an executable as-of strategy.
  - CONFIRMED_NEXT_PRINT: after a completed positive-volume M5 proves activity,
    stage a counterfactual marketable order; model hypothetical fill at
    subsequent positive-volume M5 OPEN before TTL. The observed future print
    represents scenario liquidity, NOT actual quotes or a signed fill.

Additional NATIVE_H1_PRICE assumes an order could itself create a first print
at recorded H1 open (optimistic price-only benchmark). A candle with no prints
DOES NOT prove the user's hypothetical order would be impossible.

Research data-quality contract only. Production code, order gateway, STOP
prices and account/portfolio never changed.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal, Optional, Sequence
from math import isfinite,sqrt

M5_MS=300000
H1_MS=12*M5_MS

@dataclass(frozen=True)
class Bar:
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    def __post_init__(self):
        if self.ts%M5_MS!=0: raise ValueError("M5_OPEN_NOT_ALIGNED")
        if not all(isfinite(float(v)) for v in (self.open,self.high,self.low,self.close,self.volume)):
            raise ValueError("NONFINITE_M5")
        if not (0<self.low<=min(self.open,self.close) and
                self.high>=max(self.open,self.close) and self.volume>=0):
            raise ValueError("INVALID_M5_OHLCV")


@dataclass(frozen=True)
class EntryDecision:
    asof_ts: int
    expires_ts: int
    side: Literal["LONG","SHORT"]

    def __post_init__(self):
        if self.asof_ts%M5_MS or self.expires_ts%M5_MS:
            raise ValueError("NON_ALIGNED_DECISION")
        if not self.asof_ts<self.expires_ts<=self.asof_ts+H1_MS:
            raise ValueError("INVALID_ENTRY_TTL")
        if self.side not in ("LONG","SHORT"):raise ValueError("INVALID_SIDE")


@dataclass(frozen=True)
class EntryResult:
    state: str
    scenario: str
    reference_price: Optional[float]
    modeled_fill_ts: Optional[int]
    decision_or_order_ts: Optional[int]
    first_print_ts: Optional[int]
    provenance: str
    seen_m5_bars: int
    reason: str


def validate_ordered_m5(bars: Sequence[Bar], asof_ts: int, expires_ts: int)->list[Bar]:
    if not isinstance(bars,Sequence) or not bars:
        raise ValueError("M5_HISTORY_ABSENT")
    series=[b for b in bars if asof_ts<=b.ts<expires_ts]
    expected=(expires_ts-asof_ts)//M5_MS
    if len(series)!=expected:
        raise ValueError("M5_HISTORY_INCOMPLETE_FAIL_CLOSED")
    for i,b in enumerate(series):
        if b.ts!=asof_ts+i*M5_MS:
            raise ValueError("M5_HISTORY_MISSING_OR_DUPLICATE")
    return series


def native_h1_ohlcv_from_printed_m5(bars: Sequence[Bar]):
    """Returns first trade OHLCV, or None for an all-zero-print H1.

    Recorded H1 candle in the vendor may be a stale-carried flat candle
    when no trades exist, so None is distinct from a price of zero.
    """
    if len(bars)!=12:raise ValueError("REQUIRES_EXACT_12_M5")
    for i in range(1,12):
        if bars[i].ts-bars[i-1].ts!=M5_MS:raise ValueError("H1_M5_GAP")
    positive=[b for b in bars if b.volume>0]
    if not positive:return None
    return (positive[0].open, max(b.high for b in positive),
        min(b.low for b in positive),positive[-1].close,
        sum(b.volume for b in positive))


def choose_entry(decision:EntryDecision, bars:Sequence[Bar],
                 scenario:Literal["NATIVE_H1_PRICE","FIRST_PRINT_UPPER_INFORMATION_BOUND","CONFIRMED_NEXT_PRINT"],
                 native_h1_open:Optional[float]=None)->EntryResult:
    series=validate_ordered_m5(bars,decision.asof_ts,decision.expires_ts)
    first=next((b for b in series if b.volume>0),None)
    if scenario=="NATIVE_H1_PRICE":
        if native_h1_open is None or not isfinite(native_h1_open) or native_h1_open<=0:
            raise ValueError("INVALID_NATIVE_H1_PRICE")
        return EntryResult("HYPOTHETICAL_PRICE_REFERENCE",scenario,native_h1_open,
            decision.asof_ts,decision.asof_ts,first.ts if first else None,
            "H1_OPEN_NOT_VERIFIED_ACTUAL_MARKET_ORDER_FILL",len(series),
            "Assume order could create the first trade; no L2 or signed fill")
    if scenario=="FIRST_PRINT_UPPER_INFORMATION_BOUND":
        if not first:
            return EntryResult("NO_OBSERVED_PRINT",scenario,None,None,None,None,
                "HISTORICAL_NO_PRINT_NOT_PROVEN_UNFILLABLE",len(series),
                "No public prints in entry H1, no statement about hypothetical orderbook")
        return EntryResult("EX_POST_PRINT_PRICE_ONLY",scenario,first.open,first.ts,
            decision.asof_ts,first.ts,"NOT_ASOF_EXECUTABLE_FIRST_BAR_OPEN",
            len(series),"First print is not known when entry signal is emitted")
    if scenario!="CONFIRMED_NEXT_PRINT":
        raise ValueError("UNKNOWN_SCENARIO")
    # A confirmation of M5 trade volume only exists AFTER the candle closes.
    if not first:
        return EntryResult("EXPIRED_WITHOUT_CONFIRMED_PRINT",scenario,None,None,None,None,
            "HISTORICAL_NO_PRINT_NOT_PROVEN_UNFILLABLE",len(series),
            "No known print confirmation before TTL")
    confirmed_at=first.ts+M5_MS
    for b in series:
        if b.ts<confirmed_at:continue
        if b.volume>0:
            return EntryResult("POST_CONFIRMATION_EXECUTION_PROXY",scenario,b.open,b.ts,
               confirmed_at,first.ts,"ASOF_ORDER_AFTER_KNOWN_PRINT_BUT_FILL_IS_PROXY",
               len(series),"Order could be submitted after prior 5m close; quote and realized fill unknown")
    return EntryResult("EXPIRED_AFTER_CONFIRMATION_WITHOUT_LATER_PRINT",scenario,
        None,None,confirmed_at,first.ts,"NO_OBSERVED_SECOND_PRINT_NOT_PROVEN_UNFILLABLE",
        len(series),"First print confirmed, but no later print inside one-hour signal TTL")


def wilson_95(successes:int,n:int):
    """Wilson confidence interval for a binomial win fraction."""
    if not 0<=successes<=n:raise ValueError("INVALID_WINS")
    if n==0:return None
    z=1.959963984540054
    p=successes/n
    d=1+z*z/n
    mid=(p+z*z/(2*n))/d
    half=z*sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return max(0,mid-half),min(1,mid+half)


def guard_strategy_adoption(records):
    """Fail closed on lack of evidence, never optimize from test outcomes.

    Caller must supply independent current-pin portfolio validation and a
    justified untested period. Experimental samples alone can never PASS.
    """
    needs=("native_pin_parity","causal_execution_proven","venue_fill_model_supported",
      "independent_out_of_sample","portfolio_costs_both_replayed",
      "funding_gross_stop_reconciled")
    missing=[x for x in needs if not records.get(x,False)]
    if missing:return {"decision":"BLOCK","reasons":missing}
    for bps in (10,30):
        x=records.get(f"fee_{bps}")
        if not x or x.get("mdd_pct",float("inf"))>20 or x.get("win_rate_pct",0)<records.get("target_win_rate_pct",70):
            return {"decision":"BLOCK","reasons":[f"FEE_{bps}_DD_OR_WIN_RATE_FAIL"]}
        if x.get("trades",0)<records.get("min_independent_trades",30) or x.get("pf",0)<=1:
            return {"decision":"BLOCK","reasons":[f"FEE_{bps}_INSUFFICIENT_ECONOMIC_EVIDENCE"]}
    return {"decision":"RESEARCH_GATES_PASSED_OWNER_DEPLOY_STILL_REQUIRED","reasons":[]}
