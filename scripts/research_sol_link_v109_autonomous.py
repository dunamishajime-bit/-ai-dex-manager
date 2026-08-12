from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
from pathlib import Path

import research_lab_pair_specific_v109 as v109

KIND = 'regime_wave'
PAIRS = ('SOL', 'LINK')
HOUR = v109.HOUR
HORIZON = v109.HORIZON

# Frozen V109 is reference-only. Successors keep its trained model, threshold,
# risk and trail. The only changes below are predeclared structural mechanisms.
CATALOG = {
    'SOL': [
        'sol_wrong_wave_persistence',
        'sol_wrong_wave_breadth_sponsor',
        'sol_wrong_wave_dual_persistence',
    ],
    'LINK': [
        'link_vol_cash_horizon',
        'link_vol_transition_horizon',
        'link_cash_rearm_horizon',
    ],
}


def metric(vals):
    return v109.metric(vals)


def med(xs):
    return statistics.median(xs) if xs else None


def _ctx(pair, candles, idx, ts):
    i = idx[pair].get(ts)
    if i is None or i < 900:
        return None
    c = candles[pair]
    v24 = v109.b.vol(c, i, 24); v96 = v109.b.vol(c, i, 96)
    v168 = v109.b.vol(c, i, 168); v336 = v109.b.vol(c, i, 336)
    if min(v96, v168, v336) <= 1e-12:
        return None
    return {
        'i': i, 'close': float(c[i]['close']), 'v24': v24, 'v96': v96,
        'v168': v168, 'v336': v336, 'vr': v24 / v96,
        'breadth': v109.b.breadth(candles, idx, ts, 24),
        'r3': v109.ret(c, i, 3) or 0.0, 'r6': v109.ret(c, i, 6) or 0.0,
        'r12': v109.ret(c, i, 12) or 0.0, 'r24': v109.ret(c, i, 24) or 0.0,
    }


def _entry_ok(cid, side, ctx, prev_ctx=None):
    if cid == 'sol_wrong_wave_persistence':
        return ctx['r6'] * side > 0
    if cid == 'sol_wrong_wave_breadth_sponsor':
        sponsor = 1 if ctx['breadth'] > .5 else -1 if ctx['breadth'] < .5 else 0
        return ctx['r6'] * side > 0 and sponsor == side
    if cid == 'sol_wrong_wave_dual_persistence':
        return ctx['r6'] * side > 0 and ctx['r12'] * side > 0
    if cid == 'link_vol_cash_horizon':
        return ctx['vr'] >= 1.0
    if cid == 'link_vol_transition_horizon':
        return ctx['vr'] >= 1.0 and prev_ctx is not None and ctx['vr'] > prev_ctx['vr']
    if cid == 'link_cash_rearm_horizon':
        return ctx['vr'] >= 1.0
    raise KeyError(cid)


def _exit_flags(pair, state, pr, th, adverse, held, cid):
    flags = []
    if (state > 0 and pr < .10 * th) or (state < 0 and pr > -.10 * th):
        flags.append('PREDICTOR_DECAY')
    if adverse <= -v109.TRAIL[pair]:
        flags.append('FROZEN_TRAIL')
    if cid.startswith('link_') and held >= HORIZON:
        flags.append('FORECAST_HORIZON_END')
    elif held >= 144:
        flags.append('FROZEN_MAXHOLD')
    return flags


def simulate(cid, pair, candles, idx, start, end, cost_bps, delay, model):
    th = model['threshold']; c = candles[pair]
    state = 0; life = 'CASH'; probe_side = 0; probe_ts = None; armed = True
    entry = peak = trough = None; entry_i = entry_ts = signal_ts = None; entry_pred = None
    vals, recs = [], []

    def close(ts, i, flags):
        nonlocal state, life, armed, entry, peak, trough, entry_i, entry_ts, signal_ts, entry_pred
        proposed = i + 1 + delay
        # Strict block isolation: never execute with a price timestamp outside this period.
        period_end = flags == ['PERIOD_END']
        if period_end or proposed >= len(c) or int(c[proposed]['ts']) >= end:
            xi = i; xp = float(c[i]['close'])
        else:
            xi = proposed; xp = float(c[xi]['open'])
        gross = state * ((xp / entry - 1) * 100); raw_cost = cost_bps / 100.0
        pnl = (gross - raw_cost) * v109.RISK[pair]
        lo, hi = min(entry_i, xi), max(entry_i, xi)
        highs = [float(c[j].get('high', c[j]['close'])) for j in range(lo, hi + 1)]
        lows = [float(c[j].get('low', c[j]['close'])) for j in range(lo, hi + 1)]
        if state > 0:
            mfe = (max(highs) / entry - 1) * 100; mae = (min(lows) / entry - 1) * 100
        else:
            mfe = (entry / min(lows) - 1) * 100; mae = (entry / max(highs) - 1) * 100
        i48 = min(entry_i + HORIZON, xi); p48 = float(c[i48]['close'])
        gross48 = state * ((p48 / entry - 1) * 100)
        p0_48 = (gross48 - raw_cost) * v109.RISK[pair]
        regs = _ctx(pair, candles, idx, signal_ts) or {}
        recs.append({
            'candidate': cid, 'pair': pair, 'side': 'LONG' if state > 0 else 'SHORT',
            'signalTs': signal_ts, 'entryExecTs': entry_ts, 'exitSignalTs': ts,
            'exitExecTs': int(c[xi]['ts']), 'entryPredictor': entry_pred, 'threshold': th,
            'entryPrice': entry, 'exitPrice': xp, 'heldHours': (ts - signal_ts) / HOUR,
            'netPnlPct': pnl, 'grossReturnPct': gross,
            'costContributionPct': raw_cost * v109.RISK[pair], 'mfePct': mfe, 'maePct': mae,
            'pnl0To48hPct': p0_48, 'pnl48hToExitPct': pnl - p0_48,
            'exitReason': '+'.join(flags), 'volRatio24_96': regs.get('vr'),
            'breadth24': regs.get('breadth'), 'entryLifecycle': 'ACCEPTED_CORE',
        })
        vals.append(pnl)
        state = 0; life = 'CASH'; entry = peak = trough = None
        entry_i = entry_ts = signal_ts = None; entry_pred = None
        if cid == 'link_cash_rearm_horizon':
            armed = False

    for row in c:
        ts = int(row['ts'])
        if not (start <= ts < end):
            continue
        ctx = _ctx(pair, candles, idx, ts)
        if ctx is None:
            continue
        i = ctx['i']; pr = v109.predict(KIND, pair, candles, idx, ts, model); px = ctx['close']

        if cid == 'link_cash_rearm_horizon' and not armed and abs(pr) < th:
            armed = True

        if state:
            peak = max(peak, px); trough = min(trough, px); held = (ts - signal_ts) // HOUR
            adverse = (px / peak - 1) * 100 if state > 0 else (trough / px - 1) * 100
            flags = _exit_flags(pair, state, pr, th, adverse, held, cid)
            if flags:
                close(ts, i, flags)
                continue

        d = 1 if pr >= th else -1 if pr <= -th else 0
        frozen_gate = ctx['v24'] < 3.2 * ctx['v336']

        if pair == 'SOL' and state == 0:
            if life == 'CASH' and d and frozen_gate:
                probe_side = d; probe_ts = ts; life = 'SHADOW_PROBE'; continue
            if life == 'SHADOW_PROBE':
                if d != probe_side:
                    life = 'CASH'; probe_side = 0; probe_ts = None; continue
                elapsed = (ts - probe_ts) // HOUR
                # Existing V109 fast horizons only; no numeric threshold sweep.
                min_h = 3 if cid == 'sol_wrong_wave_persistence' else 6
                prev = _ctx(pair, candles, idx, ts - 12 * HOUR)
                if elapsed >= min_h and _entry_ok(cid, probe_side, ctx, prev):
                    ei = i + 1 + delay
                    if ei < len(c) and int(c[ei]['ts']) < end:
                        state = probe_side; signal_ts = ts; entry_i = ei; entry_ts = int(c[ei]['ts'])
                        entry = float(c[ei]['open']); peak = entry; trough = entry; entry_pred = pr; life = 'CORE'
                    continue
                if elapsed > 12:
                    life = 'CASH'; probe_side = 0; probe_ts = None
            continue

        if pair == 'LINK' and state == 0 and armed and d and frozen_gate:
            prev = _ctx(pair, candles, idx, ts - 12 * HOUR)
            if _entry_ok(cid, d, ctx, prev):
                ei = i + 1 + delay
                if ei < len(c) and int(c[ei]['ts']) < end:
                    state = d; signal_ts = ts; entry_i = ei; entry_ts = int(c[ei]['ts'])
                    entry = float(c[ei]['open']); peak = entry; trough = entry; entry_pred = pr; life = 'CORE'

    if state and signal_ts is not None:
        last_ts = max(int(r['ts']) for r in c if start <= int(r['ts']) < end)
        close(last_ts, idx[pair][last_ts], ['PERIOD_END'])
    return vals, recs


def summary(recs):
    vals = [r['netPnlPct'] for r in recs]; m = metric(vals)
    losses = [-x for x in vals if x < 0]
    m.update({
        'netSumPct': sum(vals), 'medianMfePct': med([r['mfePct'] for r in recs]),
        'medianMaePct': med([r['maePct'] for r in recs]),
        'medianHeldHours': med([r['heldHours'] for r in recs]),
        'sumPnl0To48hPct': sum(r['pnl0To48hPct'] for r in recs),
        'sumPnl48hToExitPct': sum(r['pnl48hToExitPct'] for r in recs),
        'costContributionPct': sum(r['costContributionPct'] for r in recs),
        'worstTradePct': min(vals) if vals else None,
        'largestLossSharePct': 100 * max(losses) / sum(losses) if losses else 0.0,
        'top5TradeContributionPct': (100 * sum(sorted(vals, reverse=True)[:5]) / sum(vals)) if vals and abs(sum(vals)) > 1e-9 else None,
    })
    return m


def folds(cid, pair, candles, idx, period, model):
    a, b = period; step = (b - a) // 3; out = []
    for k in range(3):
        x = a + k * step; y = b if k == 2 else a + (k + 1) * step
        _, recs = simulate(cid, pair, candles, idx, x, y, v109.NORMAL_BPS, 0, model)
        out.append(summary(recs))
    return {'folds': out,
            'positivePfFolds': sum((x.get('pf') or 0) > 1 for x in out),
            'positiveReturnFolds': sum(x.get('returnPct', 0) > 0 for x in out)}


def diagnose(pair, result):
    v, s = result['validation'], result['validationStress']
    if pair == 'SOL':
        if v.get('largestLossSharePct', 0) > 50:
            return 'TAIL_LOSS_CONCENTRATION_REMAINS'
        if v.get('trades', 0) < 6:
            return 'TOO_SELECTIVE'
        if (v.get('pf') or 0) < 1:
            return 'WRONG_WAVE_REJECTION_INSUFFICIENT'
        return 'WRONG_WAVE_REJECTION_IMPROVED'
    if (v.get('sumPnl48hToExitPct') or 0) < -1e-9:
        return 'HORIZON_LEAKAGE_REMAINS'
    if v.get('trades', 0) < 12:
        return 'CASH_FILTER_TOO_SELECTIVE'
    if (s.get('pf') or 0) <= 1:
        return 'EDGE_MARGIN_STRESS_WEAK'
    return 'VOL_CASH_HORIZON_IMPROVED'


def candidate_result(cid, pair, candles, idx, ps, model):
    _, dr = simulate(cid, pair, candles, idx, *ps['development'], v109.NORMAL_BPS, 0, model)
    _, vr = simulate(cid, pair, candles, idx, *ps['validation'], v109.NORMAL_BPS, 0, model)
    _, sr = simulate(cid, pair, candles, idx, *ps['validation'], v109.STRESS_BPS, 1, model)
    res = {'candidate': cid, 'pair': pair, 'development': summary(dr),
           'validation': summary(vr), 'validationStress': summary(sr),
           'walkForward': {'development': folds(cid, pair, candles, idx, ps['development'], model),
                           'validation': folds(cid, pair, candles, idx, ps['validation'], model)},
           'ledger': {'development': dr, 'validation': vr}}
    res['diagnosis'] = diagnose(pair, res)
    stable = res['walkForward']['development']['positivePfFolds'] >= 2 and res['walkForward']['validation']['positivePfFolds'] >= 2
    adequate = res['development'].get('trades', 0) >= 12 and res['validation'].get('trades', 0) >= 6
    res['status'] = 'FROZEN_SURVIVOR' if (
        adequate and stable and (res['development'].get('pf') or 0) >= 1.2 and
        (res['validation'].get('pf') or 0) >= 1.2 and (res['validationStress'].get('pf') or 0) > 1 and
        res['development'].get('returnPct', 0) > 0 and res['validation'].get('returnPct', 0) > 0 and
        res['validation'].get('maxDDPct', -999) > -20
    ) else 'FAIL'
    return res


def run(pair):
    candles, idx, _ = v109.b.base.load(); ps = v109.b.base.periods(candles)
    model = v109.train(KIND, pair, candles, idx, *ps['development'])
    frozen = {}
    for name in ('development', 'validation'):
        vals, _ = v109.pair_trades(KIND, pair, candles, idx, *ps[name], v109.NORMAL_BPS, 0, model)
        frozen[name] = metric(vals)

    chain = []
    for cid in CATALOG[pair]:
        r = candidate_result(cid, pair, candles, idx, ps, model); chain.append(r)
        if r['status'] == 'FROZEN_SURVIVOR':
            break
    best = max(chain, key=lambda x: (min(x['development'].get('pf') or 0, x['validation'].get('pf') or 0),
                                     x['validation'].get('returnPct', -999)))
    next_spec = None if best['status'] == 'FROZEN_SURVIVOR' else {
        'sourceDiagnosis': best['diagnosis'],
        'policy': 'NEXT_RUN_NEW_STRUCTURAL_MECHANISM_ONLY_NO_NUMERIC_RETUNE',
        'structuralDirection': ('wrong-wave rejection: change causal acceptance/rejection mechanism only'
                                if pair == 'SOL' else
                                'volatility-aware cash plus 48h forecast ownership/re-arm mechanism only'),
    }
    out = {
        'researchLine': 'FROZEN_V109_SOL_LINK_AUTONOMOUS_STRUCTURAL', 'pair': pair,
        'frozenV109Changed': False, 'kind': KIND, 'frozenThreshold': model['threshold'],
        'frozenRisk': v109.RISK[pair], 'frozenTrailPct': v109.TRAIL[pair],
        'forecastHorizonHours': HORIZON,
        'periods': {'development': ps['development'], 'validation': ps['validation'],
                    'confirmation': 'UNTOUCHED', 'holdout': 'UNTOUCHED'},
        'frozenBaseline': frozen, 'candidateChain': chain,
        'selectedForNextStage': best['candidate'], 'selectedStatus': best['status'],
        'nextCandidateGeneration': next_spec,
        'researchMultiplicity': {'evaluatedThisRun': len(chain), 'catalogSize': len(CATALOG[pair])},
        'antiOverfit': {'denseSweep': False, 'thresholdRetune': False, 'sideHardcode': False,
                        'confirmationRead': False, 'holdoutRead': False,
                        'designEvidence': ['development', 'validation'], 'strictPeriodIsolation': True},
        'productionChanged': False, 'realTradingEnabled': False,
    }
    root = Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR', '.research-state')); root.mkdir(parents=True, exist_ok=True)
    stem = f'{pair.lower()}-v109-autonomous-structural'
    (root / f'{stem}.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
    lines = [f'# {pair} Frozen V109 Autonomous Structural Research', '', '- Frozen V109 changed: NO',
             f'- selected: {best["candidate"]}', f'- status: {best["status"]}', f'- diagnosis: {best["diagnosis"]}', '']
    for r in chain:
        d, v, s = r['development'], r['validation'], r['validationStress']
        lines += [f'## {r["candidate"]}',
                  f'- Dev: return {d.get("returnPct")} / PF {d.get("pf")} / DD {d.get("maxDDPct")} / trades {d.get("trades")}',
                  f'- Val: return {v.get("returnPct")} / PF {v.get("pf")} / DD {v.get("maxDDPct")} / trades {v.get("trades")}',
                  f'- Stress PF: {s.get("pf")}', f'- diagnosis: {r["diagnosis"]}', '']
    (root / f'{stem}.md').write_text('\n'.join(lines), encoding='utf-8')
    with (root / f'{stem}-ledger.csv').open('w', newline='', encoding='utf-8') as fh:
        cols = ['candidate','block','pair','side','signalTs','entryExecTs','exitSignalTs','exitExecTs','entryPredictor','threshold','heldHours','netPnlPct','mfePct','maePct','pnl0To48hPct','pnl48hToExitPct','exitReason','volRatio24_96','breadth24','costContributionPct']
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader()
        for r in chain:
            for block in ('development', 'validation'):
                for tr in r['ledger'][block]:
                    row = {k: tr.get(k) for k in cols}; row['block'] = block; w.writerow(row)
    print(json.dumps({k: v for k, v in out.items() if k != 'candidateChain'}, indent=2))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--pair', choices=PAIRS, required=True); run(ap.parse_args().pair)
