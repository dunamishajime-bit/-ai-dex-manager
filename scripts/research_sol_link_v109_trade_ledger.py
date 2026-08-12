from __future__ import annotations

import argparse
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from pathlib import Path

import research_lab_pair_specific_v109 as v109

KIND = 'regime_wave'
PAIRS = ('SOL', 'LINK')
HOUR = v109.HOUR


def metric(vals):
    return v109.metric(vals)


def _safe_mean(xs):
    return statistics.fmean(xs) if xs else None


def _safe_median(xs):
    return statistics.median(xs) if xs else None


def _quantile(xs, q):
    if not xs:
        return None
    ys = sorted(xs)
    if len(ys) == 1:
        return ys[0]
    p = (len(ys) - 1) * q
    lo = int(math.floor(p)); hi = int(math.ceil(p))
    if lo == hi:
        return ys[lo]
    return ys[lo] * (hi - p) + ys[hi] * (p - lo)


def _regimes(s, candles, idx, ts):
    i = idx[s].get(ts)
    if i is None:
        return {'volRatio24_96': None, 'volRatio24_336': None, 'volatilityRegime': 'UNKNOWN',
                'breadth24': None, 'breadthRegime': 'UNKNOWN'}
    v24 = v109.b.vol(candles[s], i, 24)
    v96 = v109.b.vol(candles[s], i, 96)
    v336 = v109.b.vol(candles[s], i, 336)
    r96 = v24 / v96 if v96 and v96 > 1e-12 else None
    r336 = v24 / v336 if v336 and v336 > 1e-12 else None
    # Diagnostic buckets only; never used by the frozen strategy or for trade decisions.
    if r96 is None:
        vr = 'UNKNOWN'
    elif r96 < 0.75:
        vr = 'LOW'
    elif r96 <= 1.25:
        vr = 'NORMAL'
    else:
        vr = 'HIGH'
    br = v109.b.breadth(candles, idx, ts, 24)
    if br is None:
        breg = 'UNKNOWN'
    elif br >= 0.65:
        breg = 'BULL'
    elif br <= 0.35:
        breg = 'BEAR'
    else:
        breg = 'MIXED'
    return {'volRatio24_96': r96, 'volRatio24_336': r336, 'volatilityRegime': vr,
            'breadth24': br, 'breadthRegime': breg}


def _ledger_trades(s, candles, idx, start, end, cost, delay, model):
    """Exact V109 execution decisions plus diagnostics. No trade logic changes."""
    th = model['threshold']
    c = candles[s]
    state = 0
    entry = peak = trough = None
    signal_ts = exec_ts = None
    entry_i = None
    entry_pred = None
    entry_regs = None
    vals = []
    recs = []

    for row in c:
        ts = int(row['ts'])
        if not (start <= ts < end):
            continue
        i = idx[s].get(ts)
        if i is None or i < 900:
            continue
        pr = v109.predict(KIND, s, candles, idx, ts, model)
        px = float(c[i]['close'])
        v24 = v109.b.vol(c, i, 24)
        v336 = v109.b.vol(c, i, 336)

        if state:
            peak = max(peak, px)
            trough = min(trough, px)
            held = (ts - signal_ts) // HOUR
            adverse = (px / peak - 1) * 100 if state > 0 else (trough / px - 1) * 100
            predictor_decay = (state > 0 and pr < .10 * th) or (state < 0 and pr > -.10 * th)
            trail_hit = adverse <= -v109.TRAIL[s]
            maxhold_hit = held >= 144
            exitnow = predictor_decay or trail_hit or maxhold_hit
            if exitnow:
                xi = min(i + 1 + delay, len(c) - 1)
                xp = float(c[xi]['open'])
                exit_exec_ts = int(c[xi]['ts'])
                gross = state * ((xp / entry - 1) * 100)
                raw_cost = cost / 100
                scaled_cost = raw_cost * v109.RISK[s]
                pnl = (gross - raw_cost) * v109.RISK[s]
                vals.append(pnl)

                lo = min(entry_i, xi); hi = max(entry_i, xi)
                closes = [float(c[j]['close']) for j in range(lo, hi + 1)]
                highs = [float(c[j].get('high', c[j]['close'])) for j in range(lo, hi + 1)]
                lows = [float(c[j].get('low', c[j]['close'])) for j in range(lo, hi + 1)]
                if state > 0:
                    mfe = (max(highs) / entry - 1) * 100
                    mae = (min(lows) / entry - 1) * 100
                else:
                    mfe = (entry / min(lows) - 1) * 100
                    mae = (entry / max(highs) - 1) * 100

                i48 = min(entry_i + 48, xi)
                p48 = float(c[i48]['close'])
                gross48 = state * ((p48 / entry - 1) * 100)
                # Attribution: full cost is charged to initial 0-48h segment, matching one round-trip cost model.
                pnl_0_48 = (gross48 - raw_cost) * v109.RISK[s]
                pnl_48_exit = pnl - pnl_0_48
                exit_flags = []
                if predictor_decay: exit_flags.append('PREDICTOR_DECAY')
                if trail_hit: exit_flags.append('TRAIL')
                if maxhold_hit: exit_flags.append('MAXHOLD')
                reason = '+'.join(exit_flags)
                recs.append({
                    'pair': s, 'side': 'LONG' if state > 0 else 'SHORT',
                    'signalTs': signal_ts, 'entryExecTs': exec_ts, 'exitSignalTs': ts, 'exitExecTs': exit_exec_ts,
                    'entryPredictor': entry_pred, 'threshold': th, 'exitPredictor': pr,
                    'heldSignalHours': held, 'heldExecHours': (exit_exec_ts - exec_ts) / HOUR,
                    'entryPrice': entry, 'exitPrice': xp,
                    'grossReturnPct': gross, 'riskMultiplier': v109.RISK[s],
                    'rawCostPct': raw_cost, 'costContributionPct': scaled_cost, 'netPnlPct': pnl,
                    'mfePct': mfe, 'maePct': mae,
                    'pnl0To48hPct': pnl_0_48, 'pnl48hToExitPct': pnl_48_exit,
                    'mark48UsedHours': max(0, (int(c[i48]['ts']) - exec_ts) / HOUR),
                    'exitReason': reason, **entry_regs,
                })
                state = 0

        if state == 0 and v336 > 1e-9 and v24 < 3.2 * v336:
            d = 1 if pr >= th else -1 if pr <= -th else 0
            if d:
                ei = i + 1 + delay
                if ei < len(c):
                    state = d
                    entry = float(c[ei]['open'])
                    peak = entry; trough = entry
                    signal_ts = ts
                    entry_i = ei
                    exec_ts = int(c[ei]['ts'])
                    entry_pred = pr
                    entry_regs = _regimes(s, candles, idx, ts)

    if state and signal_ts is not None:
        end_rows = [r for r in c if start <= int(r['ts']) < end]
        last_ts = max(int(r['ts']) for r in end_rows)
        i = idx[s].get(last_ts)
        xp = float(c[i]['close'])
        gross = state * ((xp / entry - 1) * 100)
        raw_cost = cost / 100
        scaled_cost = raw_cost * v109.RISK[s]
        pnl = (gross - raw_cost) * v109.RISK[s]
        vals.append(pnl)
        lo = min(entry_i, i); hi = max(entry_i, i)
        highs = [float(c[j].get('high', c[j]['close'])) for j in range(lo, hi + 1)]
        lows = [float(c[j].get('low', c[j]['close'])) for j in range(lo, hi + 1)]
        if state > 0:
            mfe = (max(highs) / entry - 1) * 100; mae = (min(lows) / entry - 1) * 100
        else:
            mfe = (entry / min(lows) - 1) * 100; mae = (entry / max(highs) - 1) * 100
        i48 = min(entry_i + 48, i)
        p48 = float(c[i48]['close'])
        gross48 = state * ((p48 / entry - 1) * 100)
        pnl_0_48 = (gross48 - raw_cost) * v109.RISK[s]
        recs.append({
            'pair': s, 'side': 'LONG' if state > 0 else 'SHORT',
            'signalTs': signal_ts, 'entryExecTs': exec_ts, 'exitSignalTs': last_ts, 'exitExecTs': last_ts,
            'entryPredictor': entry_pred, 'threshold': th, 'exitPredictor': v109.predict(KIND,s,candles,idx,last_ts,model),
            'heldSignalHours': (last_ts-signal_ts)/HOUR, 'heldExecHours': (last_ts-exec_ts)/HOUR,
            'entryPrice': entry, 'exitPrice': xp, 'grossReturnPct': gross, 'riskMultiplier': v109.RISK[s],
            'rawCostPct': raw_cost, 'costContributionPct': scaled_cost, 'netPnlPct': pnl,
            'mfePct': mfe, 'maePct': mae, 'pnl0To48hPct': pnl_0_48, 'pnl48hToExitPct': pnl-pnl_0_48,
            'mark48UsedHours': max(0,(int(c[i48]['ts'])-exec_ts)/HOUR), 'exitReason':'PERIOD_END', **entry_regs,
        })
    return vals, recs


def _slice_summary(recs):
    vals = [r['netPnlPct'] for r in recs]
    out = metric(vals)
    out.update({
        'netSumPct': sum(vals),
        'grossSumPct': sum(r['grossReturnPct'] * r['riskMultiplier'] for r in recs),
        'costContributionPct': sum(r['costContributionPct'] for r in recs),
        'medianMfePct': _safe_median([r['mfePct'] for r in recs]),
        'medianMaePct': _safe_median([r['maePct'] for r in recs]),
        'medianHeldHours': _safe_median([r['heldExecHours'] for r in recs]),
        'sumPnl0To48hPct': sum(r['pnl0To48hPct'] for r in recs),
        'sumPnl48hToExitPct': sum(r['pnl48hToExitPct'] for r in recs),
        'winnerRatePct': 100 * sum(r['netPnlPct'] > 0 for r in recs) / len(recs) if recs else None,
        'lossP05Pct': _quantile(vals, .05),
        'lossP10Pct': _quantile(vals, .10),
    })
    return out


def _group(recs, key):
    d = defaultdict(list)
    for r in recs:
        d[str(r.get(key, 'UNKNOWN'))].append(r)
    return {k: _slice_summary(v) for k, v in sorted(d.items())}


def run_pair(s):
    candles, idx, _ = v109.b.base.load()
    ps = v109.b.base.periods(candles)
    model = v109.train(KIND, s, candles, idx, *ps['development'])
    blocks = {}
    ledgers = {}
    parity = {}
    for name in ('development','validation','confirmation','holdout'):
        start,end = ps[name]
        vals,recs = _ledger_trades(s,candles,idx,start,end,v109.NORMAL_BPS,0,model)
        orig_vals,orig_recs = v109.pair_trades(KIND,s,candles,idx,start,end,v109.NORMAL_BPS,0,model)
        same_count = len(vals) == len(orig_vals) == len(recs) == len(orig_recs)
        same_pnl = same_count and all(abs(a-b) <= 1e-10 for a,b in zip(vals,orig_vals))
        parity[name] = {'sameTradeCount':same_count,'samePnlVector':same_pnl,'ledgerTrades':len(recs),'originalTrades':len(orig_recs)}
        if not (same_count and same_pnl):
            raise RuntimeError(f'FROZEN_PARITY_FAIL:{s}:{name}:{parity[name]}')
        blocks[name] = {
            'overall':_slice_summary(recs),
            'bySide':_group(recs,'side'),
            'byExitReason':_group(recs,'exitReason'),
            'byVolatilityRegime':_group(recs,'volatilityRegime'),
            'byBreadthRegime':_group(recs,'breadthRegime'),
        }
        ledgers[name] = recs

    result = {
        'strategyId':f'{s}_V109_FROZEN_TRADE_LEDGER_DIAGNOSTIC',
        'pair':s,'kind':KIND,'threshold':model['threshold'],'risk':v109.RISK[s],'trailPct':v109.TRAIL[s],
        'normalBps':v109.NORMAL_BPS,'forecastHorizonHours':v109.HORIZON,'maxHoldSignalHours':144,
        'periods':ps,'designEvidenceAllowed':['development','validation'],
        'confirmationHoldoutPolicy':'DIAGNOSTIC_ONLY_ALREADY_FROZEN_NEVER_RETUNE',
        'parity':parity,'blocks':blocks,'ledger':ledgers,
        'productionChanged':False,'realTradingEnabled':False,'frozenLogicChanged':False,
    }
    out = Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
    stem=f'{s.lower()}-v109-frozen-trade-ledger'
    (out/f'{stem}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    # Compact Markdown summary; JSON retains every trade.
    lines=[f'# {result["strategyId"]}','',f'- threshold: {model["threshold"]}',f'- risk: {v109.RISK[s]}',f'- trail: {v109.TRAIL[s]}%',f'- parity: PASS','']
    for name in ('development','validation','confirmation','holdout'):
        o=blocks[name]['overall'];lines += [f'## {name}',f'- return: {o.get("returnPct")}',f'- PF: {o.get("pf")}',f'- DD: {o.get("maxDDPct")}',f'- trades: {o.get("trades")}',f'- 0-48h pnl sum: {o.get("sumPnl0To48hPct")}',f'- 48h-exit incremental pnl sum: {o.get("sumPnl48hToExitPct")}',f'- cost contribution: {o.get("costContributionPct")}', '']
    (out/f'{stem}.md').write_text('\n'.join(lines),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='ledger'},indent=2))


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--pair',choices=PAIRS,required=True);args=ap.parse_args();run_pair(args.pair)

if __name__=='__main__':main()
