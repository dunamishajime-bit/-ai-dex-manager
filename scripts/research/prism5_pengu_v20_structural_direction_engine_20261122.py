#!/usr/bin/env python3
"""PRISM-V20-STRUCTURE v1: research-only PENGU SHORT entry state machine.

Not an extra numeric stop or production gate. It explicitly separates:
  (1) original pinned SHORT_V20 *candidate*,
  (2) seller-controlled trend continuation,
  (3) rebound / short-squeeze danger,
  (4) uncertain/liquidity-impaired structure requiring wait/abstain.

Every calculation accepts a finite set of CLOSED hourly candles; the caller
must supply candles with closeTime <= decision time. No outcomes, future H1,
real orders, venue fills, mutation of other PENGU routes, or Production code.
The policy thresholds below are frozen BEFORE looking at the resulting scores.
"""
from __future__ import annotations
from dataclasses import dataclass
import math
from typing import Literal, Sequence

H=3600_000
SOURCE_PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
SOURCE_BLOB="06476fed9985a165cf73971e790322ef3d03bd90"
POLICY="PRISM_V20_STRUCTURAL_DIRECTION_V1_FROZEN_20261122"

@dataclass(frozen=True)
class H1:
    ts:int
    open:float
    high:float
    low:float
    close:float
    volume:float
    taker_buy_volume:float
    def __post_init__(self):
        if self.ts%H:raise ValueError("H1_ALIGNMENT")
        values=(self.open,self.high,self.low,self.close,self.volume,self.taker_buy_volume)
        if any(not math.isfinite(v) for v in values):raise ValueError("NONFINITE_H1")
        if self.low<=0 or self.low>min(self.open,self.close) or self.high<max(self.open,self.close,self.low):
            raise ValueError("INVALID_OHLC_PRICE")
        if self.volume<0 or self.taker_buy_volume<0 or self.taker_buy_volume>self.volume+1e-6:
            raise ValueError("INVALID_VOLUME")

@dataclass(frozen=True)
class Evidence:
    decision_ts:int
    source_pengu_ts:int
    source_btc_ts:int
    policy:str
    route:str
    regime:str
    action:str
    continuation_votes:int
    reversal_votes:int
    continuation_reasons:tuple[str,...]
    reversal_reasons:tuple[str,...]
    min_data_quality:str
    features:dict[str,float|int|bool]
    confirmation_limit_ts:int

def source_h1(row:list)->H1:
    if len(row)<11:raise ValueError("MISSING_SOURCE_H1_FIELDS")
    return H1(ts=int(row[0]),open=float(row[1]),high=float(row[2]),low=float(row[3]),
      close=float(row[4]),volume=float(row[5]),taker_buy_volume=float(row[9]))

def _source_window(rows:Sequence[H1],decision_ts:int)->list[H1]:
    # Explicitly enforce as-of: no bar that closed after decision timestamp.
    # All 96 hours are required; a gap/duplicate shuts the gate.
    eligible=[x for x in rows if x.ts+H<=decision_ts]
    if len(eligible)<96:raise ValueError("INSUFFICIENT_PREDECISION_H1_HISTORY")
    tail=eligible[-96:]
    if tail[-1].ts+H!=decision_ts:raise ValueError("LATEST_H1_NOT_CLOSED_AT_DECISION")
    for a,b in zip(tail,tail[1:]):
        if b.ts-a.ts!=H:raise ValueError("PREDECISION_H1_GAP_OR_DUP")
    return tail

def _flow(rows:Sequence[H1],hours:int)->tuple[float,int]:
    v=sum(x.volume for x in rows[-hours:] if x.volume>0)
    n=sum(x.volume>0 for x in rows[-hours:])
    if v<=0:return math.nan,n
    return sum(x.taker_buy_volume for x in rows[-hours:] if x.volume>0)/v,n

def classify(pengu:Sequence[H1],btc:Sequence[H1],decision_ts:int,
             source_atr_ratio:float,allow_pending:bool=True)->Evidence:
    """At a pinned signal's NEXT-hour open, analyze only completed H1 candles.

    Input histories can include future rows, but _source_window excludes them,
    then asserts 96 consecutive completed bars. Source-native ATR must be
    positive/finite; standalone policy is invalid without a pinned candidate.
    """
    if not isinstance(decision_ts,int) or decision_ts%H:raise ValueError("BAD_DECISION_TIMESTAMP")
    if not math.isfinite(source_atr_ratio) or not 0<source_atr_ratio<.5:
        raise ValueError("INVALID_PINNED_ATR24")
    p=_source_window(pengu,decision_ts)
    b=_source_window(btc,decision_ts)
    if p[-1].ts!=b[-1].ts:raise ValueError("PENGU_BTC_NOT_SYNCHRONIZED")
    last=p[-1];atr=source_atr_ratio
    def ret(rows,hours):return rows[-1].close/rows[-1-hours].close-1
    r3,r6,r12,r24=(ret(p,h) for h in (3,6,12,24))
    btc6=ret(b,6)
    share3,n3=_flow(p,3);share6,n6=_flow(p,6)
    previous6=p[-7:-1]
    previous12=p[-13:-1]
    old6=p[-12:-6]
    prior_low6=min(z.low for z in previous6)
    prior_low12=min(z.low for z in previous12)
    prev_low=min(z.low for z in old6)
    lower_low=min(z.low for z in previous6)<min(z.low for z in old6)
    lower_high=max(z.high for z in previous6)<max(z.high for z in old6)
    breakout=(last.close-prior_low6)/(last.close*atr)
    low12_distance=(last.close-prior_low12)/(last.close*atr)
    breadth=max(last.high-last.low,1e-12)
    close_location=(last.close-last.low)/breadth
    lower_wick=(min(last.open,last.close)-last.low)/breadth
    true_body=abs(last.close-last.open)/breadth
    close_displacements=[abs(p[-i].close-p[-i-1].close) for i in range(1,7)]
    efficiency=abs(last.close-p[-7].close)/max(1e-12,sum(close_displacements))
    flow_known=n3>=2 and n6>=4 and math.isfinite(share3) and math.isfinite(share6)
    # Mechanistic votes only, with ATR normalization for crypto vol regime.
    cont={
      "ACCELERATING_6H_SELL_PRESSURE":r6<=-0.80*atr,
      "RECENT_3H_DOWNWARD_FOLLOWTHROUGH":r3<=-0.35*atr,
      "PRICE_NEAR_PRIOR_6H_LOW":breakout<=0.35,
      "LOWER_HIGHS_AND_LOWS":lower_low and lower_high,
      "SIX_HOUR_TAKER_SELL_CONTROL":flow_known and share6<=0.48,
      "LAST_H1_CLOSE_IN_BOTTOM40":close_location<=0.40,
      "BTC_6H_NOT_RISING":btc6<=0.0
    }
    reversal={
      "THREE_HOUR_BULLISH_REBOUND":r3>=0.80*atr,
      "BUYER_DOMINANT_TAKER_3H":flow_known and share3>=0.60,
      "LARGE_CANDLE_LOWER_WICK":lower_wick>=0.35,
      "REBOUND_1P5ATR_FROM_PREVIOUS_LOW":low12_distance>=1.50 and r3>0,
      "BTC_6H_BULLISH_COUNTERWIND":btc6>=0.005,
      "DOWNSIDE_MOMENTUM_LOST":r6>=0.2*atr and r24<=-2.0*atr,
    }
    cont_reasons=tuple(k for k,v in cont.items() if v)
    reversal_reasons=tuple(k for k,v in reversal.items() if v)
    n_c,n_r=len(cont_reasons),len(reversal_reasons)
    if not flow_known or last.volume<=0:
        action="NO_NEW_ENTRY_FEED_UNCERTAIN"
        regime="LIQUIDITY_UNVERIFIED"
        quality="STALE_OR_INSUFFICIENT_RECENT_TRADES"
    elif n_r>=3 or (r3>=atr and share3>.55):
        action="REJECT_ORIGINAL_SHORT_REVERSAL_RISK"
        regime="BOUNCE_OR_SHORT_SQUEEZE"
        quality="PASS"
    elif n_c>=5 and n_r<=1 and last.close<last.open:
        action="ENTER_SHORT_CANDIDATE"
        regime="SELLER_CONTROLLED_CONTINUATION"
        quality="PASS"
    else:
        action="WAIT_UP_TO_2_COMPLETE_H1" if allow_pending else "NO_ENTRY_CONFIRMATION_FAILED"
        regime="TRANSITION_OR_AMBIGUOUS"
        quality="PASS"
    feat={
      "p_return_3h":r3,"p_return_6h":r6,"p_return_12h":r12,"p_return_24h":r24,
      "btc_return_6h":btc6,
      "atr24_ratio":atr,"flow_buy_share3":share3 if math.isfinite(share3) else -1.,
      "flow_buy_share6":share6 if math.isfinite(share6) else -1.,
      "print_h1_last3":n3,"print_h1_last6":n6,
      "prior_low6_distance_atr":breakout,"prior_low12_distance_atr":low12_distance,
      "lower_high6_vs_previous6":lower_high,"lower_low6_vs_previous6":lower_low,
      "last_close_in_h1_range":close_location,"last_lower_wick_fraction":lower_wick,
      "last_body_fraction":true_body,"efficiency6":efficiency,
      "is_original_short_candidate":True}
    return Evidence(decision_ts, p[-1].ts,b[-1].ts,POLICY,"SHORT_V20",
      regime,action,n_c,n_r,cont_reasons,reversal_reasons,quality,feat,
      decision_ts+2*H if allow_pending else decision_ts)

def confirm_pending(pengu:Sequence[H1],btc:Sequence[H1],
                    original:Evidence,source_atr_ratio:float,
                    confirmation_ts:int)->Evidence:
    """One-hour-at-a-time confirmation; never use same-hour closing bar before its close."""
    if original.action!="WAIT_UP_TO_2_COMPLETE_H1":raise ValueError("NOT_WAITING")
    if confirmation_ts not in (original.decision_ts+H,original.decision_ts+2*H):
        raise ValueError("WAIT_CONFIRMATION_OUTSIDE_DEADLINE")
    z=classify(pengu,btc,confirmation_ts,source_atr_ratio,allow_pending=False)
    # Only a FRESH close of a bearish H1 may validate a deferred SHORT.
    if z.action=="ENTER_SHORT_CANDIDATE" and z.features["p_return_3h"]<0:
        return z
    return z
