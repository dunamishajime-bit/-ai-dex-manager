"""Portfolio Profit Engine V17 — frozen V15 Trend + idle-only Range sleeve.

V15 is the current strongest price base (long-only six-asset breadth rotation).
V17 does not alter any V15 trend rule, rank, cost, cadence, or exposure. Instead
it tests one independent Range sleeve only while V15 is in CASH.

Exactly three structurally different Range families are declared before the
first V17 result. Development alone may select one family if its idle-only
trades pass a minimum evidence gate. V/E never select/tune. No parameter grid,
per-symbol constants, Fresh OOS, leverage, or overlapping exposure is allowed.
Trend always has priority over Range when a V15 trend entry becomes active.
"""
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8
import research_portfolio_profit_engine_v11 as v11
import research_portfolio_profit_engine_v14 as v14
import research_portfolio_profit_engine_v15 as v15

HOUR = base.HOUR
CHECK_HOURS = 12
CHECK_MS = CHECK_HOURS * HOUR
RANGE_MAX_HOURS = 48
RANGE_RECOVERY_MIN_HOURS = 12
RANGE_STOP_PCT = -6.0
FAMILIES = ('RESIDUAL_SNAPBACK', 'COMPRESSION_RECLAIM', 'PANIC_REBOUND')
DEV_MIN_TRADES = 8
DEV_MIN_RETURN_PCT = 3.0
DEV_MIN_PF = 1.25
DEV_MIN_PF_WO = 1.10


def _trend_occupied(records: list[dict[str, Any]], ts: int) -> bool:
    return any(int(r['entryTs']) <= ts < int(r['exitTs']) for r in records)


def _next_trend_entry(records: list[dict[str, Any]], after_ts: int) -> int | None:
    future = [int(r['entryTs']) for r in records if int(r['entryTs']) > after_ts]
    return min(future) if future else None


def _snapshot(ts: int, p12: dict[str, dict[int, dict[str, float]]], hourly: dict[str, dict[int, dict[str, float]]]) -> dict[str, Any] | None:
    rows = []
    for symbol in v14.UNIVERSE:
        a = p12[symbol].get(ts)
        h = hourly[symbol].get(ts)
        if a is None or h is None:
            return None
        rows.append((symbol, a, h))
    norm = [float(a['normalizedMomentum20']) for _, a, _ in rows]
    z24 = [float(h['z24']) for _, _, h in rows]
    z72 = [float(h['z72']) for _, _, h in rows]
    long_count = sum(a['close'] > a['sma50'] and a['normalizedMomentum20'] > 0 for _, a, _ in rows)
    short_count = sum(a['close'] < a['sma50'] and a['normalizedMomentum20'] < 0 for _, a, _ in rows)
    return {
        'rows': rows,
        'medianNormMom': statistics.median(norm),
        'medianZ24': statistics.median(z24),
        'medianZ72': statistics.median(z72),
        'longCount': int(long_count),
        'shortCount': int(short_count),
    }


def _candidate(family: str, ts: int, p12, hourly) -> dict[str, Any] | None:
    snap = _snapshot(ts, p12, hourly)
    if snap is None:
        return None
    # Range sleeve is forbidden in V15 broad-long state. It also avoids a
    # broad short trend; it is intended for neutral/dislocated markets only.
    if snap['longCount'] >= v14.CONSENSUS_COUNT or snap['shortCount'] >= v14.CONSENSUS_COUNT:
        return None
    candidates: list[dict[str, Any]] = []
    for symbol, a, h in snap['rows']:
        nm = float(a['normalizedMomentum20'])
        rel = nm - float(snap['medianNormMom'])
        z6 = float(h['z6']); z24 = float(h['z24']); z72 = float(h['z72'])
        volr = float(h['volRatio24to168'])
        score: float | None = None
        if family == 'RESIDUAL_SNAPBACK':
            # Idiosyncratic loser begins to turn while the market itself is not
            # in a broad trend. The edge hypothesis is cross-sectional catch-up.
            if nm <= -0.65 and rel <= -0.50 and z6 >= 0.05 and z24 <= -0.35:
                score = (-rel) + 0.35 * (-z24) + 0.20 * z6
        elif family == 'COMPRESSION_RECLAIM':
            # Medium-horizon decline has compressed, then the short horizon
            # reclaims upward. This is distinct from cross-sectional residual.
            if z72 <= -0.45 and z24 <= -0.20 and z6 >= 0.12 and volr <= 0.95:
                score = (-z72) + 0.50 * z6 + 0.20 * (0.95 - volr)
        elif family == 'PANIC_REBOUND':
            # Broad 24h panic, but candidate already shows a local rebound.
            if snap['medianZ24'] <= -0.55 and z24 <= -0.80 and z6 >= 0.10:
                score = (-z24) + 0.45 * z6 + 0.20 * (-float(snap['medianZ24']))
        else:
            raise RuntimeError(f'UNKNOWN_RANGE_FAMILY:{family}')
        if score is not None:
            candidates.append({'symbol': symbol, 'sideSign': 1, 'score': float(score), 'entryNormMom': nm, 'entryZ24': z24, 'entryZ72': z72})
    candidates.sort(key=lambda r: (-float(r['score']), r['symbol']))
    return candidates[0] if candidates else None


def _price(candles, index, symbol: str, ts: int, field: str) -> float | None:
    i = index[symbol].get(ts)
    if i is None:
        return None
    return float(candles[symbol][i][field])


def simulate_range(family: str, candles, index, p12, hourly, trend_records, start: int, end: int, cost_bps: float, delay_bars: int):
    timeline = [ts for ts in sorted(p12['BTC']) if start <= ts < end and (ts - base.START_2023) % CHECK_MS == 0]
    records: list[dict[str, Any]] = []
    position: dict[str, Any] | None = None
    for ts in timeline:
        if position is not None:
            symbol = str(position['symbol'])
            held = int((ts - int(position['entryTs'])) // HOUR)
            close = _price(candles, index, symbol, ts, 'close')
            if close is None:
                continue
            gross_now = (close / float(position['entryPrice']) - 1.0) * 100.0
            h = hourly[symbol].get(ts)
            trend_takeover = _trend_occupied(trend_records, ts)
            recovered = held >= RANGE_RECOVERY_MIN_HOURS and h is not None and float(h['z6']) <= 0.0 and gross_now > 0
            stop = gross_now <= RANGE_STOP_PCT
            timeout = held >= RANGE_MAX_HOURS
            if trend_takeover or recovered or stop or timeout:
                i = index[symbol].get(ts)
                if i is None:
                    continue
                ei = min(i + delay_bars, len(candles[symbol]) - 1)
                exit_ts = int(candles[symbol][ei]['ts'])
                if exit_ts >= end:
                    exit_ts = ts; ei = i
                exit_price = float(candles[symbol][ei]['open']) if exit_ts != ts else close
                gross = (exit_price / float(position['entryPrice']) - 1.0) * 100.0
                net = gross - cost_bps / 100.0
                records.append({
                    'symbol': symbol, 'side': 'LONG', 'sideSign': 1,
                    'entryTs': int(position['entryTs']), 'exitTs': exit_ts,
                    'entryPrice': float(position['entryPrice']), 'exitPrice': exit_price,
                    'grossReturnPct': gross, 'netReturnPct': net,
                    'entryScore': float(position['entryScore']),
                    'exitReason': 'TREND_TAKEOVER' if trend_takeover else 'RANGE_RECOVERY' if recovered else 'RANGE_STOP' if stop else 'RANGE_TIMEOUT',
                    'holdingHours': int((exit_ts - int(position['entryTs'])) // HOUR),
                    'sleeve': 'RANGE', 'rangeFamily': family,
                })
                position = None
            if position is not None:
                continue
        if _trend_occupied(trend_records, ts):
            continue
        cand = _candidate(family, ts, p12, hourly)
        if cand is None:
            continue
        symbol = str(cand['symbol']); i = index[symbol].get(ts)
        if i is None:
            continue
        ei = i + 1 + delay_bars
        if ei >= len(candles[symbol]):
            continue
        entry_ts = int(candles[symbol][ei]['ts'])
        if entry_ts >= end or _trend_occupied(trend_records, entry_ts):
            continue
        next_trend = _next_trend_entry(trend_records, entry_ts)
        # Avoid a range entry that is immediately displaced before it can be
        # meaningfully observed. This uses only the already-frozen V15 decision.
        if next_trend is not None and next_trend - entry_ts < RANGE_RECOVERY_MIN_HOURS * HOUR:
            continue
        position = {'symbol': symbol, 'entryTs': entry_ts, 'entryPrice': float(candles[symbol][ei]['open']), 'entryScore': float(cand['score'])}
    if position is not None:
        symbol = str(position['symbol'])
        final_ts = max(int(r['ts']) for r in candles[symbol] if start <= int(r['ts']) < end)
        px = _price(candles, index, symbol, final_ts, 'close')
        if px is not None:
            gross = (px / float(position['entryPrice']) - 1.0) * 100.0
            records.append({'symbol':symbol,'side':'LONG','sideSign':1,'entryTs':int(position['entryTs']),'exitTs':final_ts,'entryPrice':float(position['entryPrice']),'exitPrice':px,'grossReturnPct':gross,'netReturnPct':gross-cost_bps/100.0,'entryScore':float(position['entryScore']),'exitReason':'PERIOD_END','holdingHours':int((final_ts-int(position['entryTs']))//HOUR),'sleeve':'RANGE','rangeFamily':family})
    return records


def _combine_records(trend_records: list[dict[str, Any]], range_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out=[]
    for r in trend_records:
        x=dict(r); x['sleeve']='TREND'; out.append(x)
    out.extend(dict(r) for r in range_records)
    out.sort(key=lambda r:(int(r['exitTs']), int(r['entryTs']), str(r['sleeve'])))
    # Structural invariant: no overlapping exposure.
    active=[]
    for r in sorted(out,key=lambda x:int(x['entryTs'])):
        if active and int(r['entryTs']) < int(active[-1]['exitTs']):
            raise RuntimeError(f"V17_OVERLAP:{active[-1]['sleeve']}:{r['sleeve']}:{r['entryTs']}")
        active.append(r)
    return out


def _closed_trade_dd(records: list[dict[str, Any]]) -> float:
    eq=1.0; peak=1.0; dd=0.0
    for r in sorted(records,key=lambda x:int(x['exitTs'])):
        eq *= max(0.000001,1.0+float(r['netReturnPct'])/100.0)
        peak=max(peak,eq); dd=min(dd,(eq/peak-1.0)*100.0)
    return dd


def _metric(records, start, end, conservative_trend_dd: float):
    dd=min(_closed_trade_dd(records), float(conservative_trend_dd))
    return v8._metric(records,start,end,dd)


def _run_family(family, candles,index,p12,hourly,start,end,cost_bps,delay_bars):
    trend_metric, trend_records = v15.simulate(candles,index,p12,start,end,cost_bps,delay_bars)
    range_records=simulate_range(family,candles,index,p12,hourly,trend_records,start,end,cost_bps,delay_bars)
    combined=_combine_records(trend_records,range_records)
    metric=_metric(combined,start,end,float(trend_metric['maxDDPct']))
    metric['trendTrades']=len(trend_records); metric['rangeTrades']=len(range_records)
    metric['trendReturnPctStandalone']=float(trend_metric['returnPct'])
    metric['rangeArithmeticContributionPctPoints']=sum(float(r['netReturnPct']) for r in range_records)
    return metric,combined,range_records


def _range_gate(range_records: list[dict[str,Any]]) -> dict[str,Any]:
    vals=[float(r['netReturnPct']) for r in range_records]
    wo=list(vals)
    if wo: wo.pop(max(range(len(wo)),key=wo.__getitem__))
    ret=1.0
    for v in vals: ret*=max(0.000001,1+v/100.0)
    pf=v8._pf(vals); pfwo=v8._pf(wo)
    checks={'trades':len(vals)>=DEV_MIN_TRADES,'return':(ret-1)*100>=DEV_MIN_RETURN_PCT,'pf':float(pf or 0)>=DEV_MIN_PF,'pfWithoutBest':float(pfwo or 0)>=DEV_MIN_PF_WO}
    return {'trades':len(vals),'returnPct':(ret-1)*100,'pf':pf,'pfWithoutBest':pfwo,'checks':checks,'pass':all(checks.values())}


def main():
    candles,index,_=base.v109.b.base.load(); p12=v11._sampled_features(candles); hourly=v8.build_features(candles)
    ds,de=base.PERIODS['development']; diagnostics={}; eligible=[]
    for family in FAMILIES:
        metric,_,rr=_run_family(family,candles,index,p12,hourly,ds,de,v8.NORMAL_BPS,0)
        gate=_range_gate(rr); diagnostics[family]={'rangeGate':gate,'hybridDevelopment':metric}
        if gate['pass']: eligible.append((float(gate['pfWithoutBest'] or 0),float(gate['pf'] or 0),int(gate['trades']),family))
    selected=sorted(eligible,key=lambda x:(-x[0],-x[1],-x[2],x[3]))[0][3] if eligible else None
    annual={}; annual_stress={}; combined=None; stress=None; records=[]
    if selected:
        for label in ('development','validation','evaluation'):
            a,b=base.PERIODS[label]; annual[label],_,_=_run_family(selected,candles,index,p12,hourly,a,b,v8.NORMAL_BPS,0); annual_stress[label],_,_=_run_family(selected,candles,index,p12,hourly,a,b,v8.STRESS_BPS,v8.STRESS_DELAY)
        a,b=base.PERIODS['combined']; combined,records,_=_run_family(selected,candles,index,p12,hourly,a,b,v8.NORMAL_BPS,0); stress,_,_=_run_family(selected,candles,index,p12,hourly,a,b,v8.STRESS_BPS,v8.STRESS_DELAY)
        gate=v8._historical_gate(combined,stress,annual)
    else:
        gate={'performanceBand':'NO_DEVELOPMENT_RANGE_FAMILY','checks':{},'historicalCandidatePass':False}
    out={'researchLine':'PORTFOLIO_PROFIT_ENGINE_V17_V15_PLUS_IDLE_RANGE','researchOnly':True,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'liveEligible':False,'freshOosRead':False,'freshOosConsumed':False,'freshOosPermission':bool(gate['historicalCandidatePass']),'target':{'main3YCagrPct':100.0,'progressFloorCagrPct':80.0,'grossExposureCapPct':100.0,'leverageMultiplier':1.0},'architecture':'Frozen V15 Trend priority -> idle-only one-position Range sleeve -> Trend takeover','selectionPeriod':'development_only_2023_07_to_2024_07','rangeFamilies':list(FAMILIES),'selectedRangeFamily':selected,'developmentDiagnostics':diagnostics,'diagnosisBasis':{'v15TrendRulesChanged':False,'v15TrendRankChanged':False,'v15TrendCadenceChanged':False,'oldHybridTunedThresholdsImported':False},'antiOverfit':{'parameterGrid':False,'perSymbolParameters':False,'familySelectionUsesDevelopmentOnly':True,'validationUsedForSelection':False,'evaluationUsedForSelection':False,'sameRunRetuning':False,'freshOosUsedForTuning':False,'leverageUsedToReachTarget':False,'onePositionMaximum':True,'overlappingExposure':False},'rangeLifecycle':{'checkHours':CHECK_HOURS,'maxHoldHours':RANGE_MAX_HOURS,'recoveryMinHours':RANGE_RECOVERY_MIN_HOURS,'hardStopPct':RANGE_STOP_PCT},'costs':{'normalTotalBpsPerRoundTrip':v8.NORMAL_BPS,'stressTotalBpsPerRoundTrip':v8.STRESS_BPS,'stressExtraDelayBars':v8.STRESS_DELAY},'periods':base.PERIODS,'annual':annual,'annualStress':annual_stress,'combined3Y':combined,'combined3YStress':stress,'historicalGate':gate}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'portfolio-profit-engine-v17.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8')
    with (root/'portfolio-profit-engine-v17-trades.jsonl').open('w',encoding='utf-8') as fh:
        for r in records: fh.write(json.dumps(r,sort_keys=True)+'\n')
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=='__main__': main()
