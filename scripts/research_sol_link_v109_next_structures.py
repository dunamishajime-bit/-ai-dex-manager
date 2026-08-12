from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import research_lab_pair_specific_v109 as v109
import research_sol_link_v109_autonomous as base

HOUR = base.HOUR
ORIGINAL_BASE_SIMULATE = base.simulate
SOL_CID = 'sol_wrong_wave_slow_anchor_release'
LINK_CID = 'link_vol_two_stage_requalification_owner'


def _open_trade(c, i, delay, end):
    ei = i + 1 + delay
    if ei >= len(c) or int(c[ei]['ts']) >= end:
        return None
    return ei, int(c[ei]['ts']), float(c[ei]['open'])


def sol_simulate(cid, pair, candles, idx, start, end, cost_bps, delay, model):
    if cid != SOL_CID or pair != 'SOL':
        return ORIGINAL_BASE_SIMULATE(cid, pair, candles, idx, start, end, cost_bps, delay, model)
    th = model['threshold']; c = candles[pair]
    state = 0; life = 'CASH'; probe_side = 0; probe_ts = None
    entry = peak = trough = None; entry_i = entry_ts = signal_ts = None; entry_pred = None
    vals, recs = [], []

    def close(ts, i, flags):
        nonlocal state, life, entry, peak, trough, entry_i, entry_ts, signal_ts, entry_pred, probe_side, probe_ts
        proposed = i + 1 + delay
        if flags == ['PERIOD_END'] or proposed >= len(c) or int(c[proposed]['ts']) >= end:
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
        i48 = min(entry_i + base.HORIZON, xi); p48 = float(c[i48]['close'])
        gross48 = state * ((p48 / entry - 1) * 100); p0_48 = (gross48 - raw_cost) * v109.RISK[pair]
        regs = base._ctx(pair, candles, idx, signal_ts) or {}
        recs.append({
            'candidate': cid, 'pair': pair, 'side': 'LONG' if state > 0 else 'SHORT',
            'signalTs': signal_ts, 'entryExecTs': entry_ts, 'exitSignalTs': ts, 'exitExecTs': int(c[xi]['ts']),
            'entryPredictor': entry_pred, 'threshold': th, 'entryPrice': entry, 'exitPrice': xp,
            'heldHours': (ts - signal_ts) / HOUR, 'netPnlPct': pnl, 'grossReturnPct': gross,
            'costContributionPct': raw_cost * v109.RISK[pair], 'mfePct': mfe, 'maePct': mae,
            'pnl0To48hPct': p0_48, 'pnl48hToExitPct': pnl - p0_48, 'exitReason': '+'.join(flags),
            'volRatio24_96': regs.get('vr'), 'breadth24': regs.get('breadth'),
            'entryLifecycle': 'LATCHED_SHADOW_SLOW_ANCHOR_RELEASE_TO_CORE',
        })
        vals.append(pnl)
        state = 0; life = 'CASH'; probe_side = 0; probe_ts = None
        entry = peak = trough = None; entry_i = entry_ts = signal_ts = None; entry_pred = None

    for row in c:
        ts = int(row['ts'])
        if not (start <= ts < end):
            continue
        ctx = base._ctx(pair, candles, idx, ts)
        if ctx is None:
            continue
        i = ctx['i']; pr = v109.predict(base.KIND, pair, candles, idx, ts, model); px = ctx['close']
        if state:
            peak = max(peak, px); trough = min(trough, px); held = (ts - signal_ts) // HOUR
            adverse = (px / peak - 1) * 100 if state > 0 else (trough / px - 1) * 100
            flags = base._exit_flags(pair, state, pr, th, adverse, held, cid)
            if flags:
                close(ts, i, flags); continue

        d = 1 if pr >= th else -1 if pr <= -th else 0
        frozen_gate = ctx['v24'] < 3.2 * ctx['v336']
        if state == 0 and life == 'CASH' and d and frozen_gate:
            probe_side = d; probe_ts = ts; life = 'LATCHED_SHADOW'; continue

        if state == 0 and life in ('LATCHED_SHADOW', 'FAST_QUARANTINE'):
            elapsed = (ts - probe_ts) // HOUR
            predictor_against = pr * probe_side < 0
            fast_against = ctx['r3'] * probe_side < 0 and ctx['r6'] * probe_side < 0
            medium_against = ctx['r12'] * probe_side < 0
            slow_against = ctx['r24'] * probe_side < 0

            # New structural ownership rule: fast fracture only quarantines. Medium conflict
            # does not itself reject. The latched side is discarded only when the slow path
            # also loses ownership, or when predictor+medium+slow all contradict it.
            if slow_against and (medium_against or predictor_against):
                life = 'CASH'; probe_side = 0; probe_ts = None; continue
            if fast_against:
                life = 'FAST_QUARANTINE'
            elif life == 'FAST_QUARANTINE' and ctx['r6'] * probe_side > 0:
                life = 'LATCHED_SHADOW'

            fast_support = ctx['r3'] * probe_side > 0 and ctx['r6'] * probe_side > 0
            medium_support = ctx['r12'] * probe_side > 0
            slow_intact = ctx['r24'] * probe_side >= 0
            # Release from shadow requires fast recovery plus a non-broken slow anchor;
            # medium evidence may be neutral but cannot be opposite at acceptance.
            coherent = fast_support and slow_intact and ctx['r12'] * probe_side >= 0
            if life == 'LATCHED_SHADOW' and elapsed >= 3 and coherent:
                opened = _open_trade(c, i, delay, end)
                if opened:
                    entry_i, entry_ts, entry = opened
                    state = probe_side; signal_ts = ts; peak = entry; trough = entry; entry_pred = pr; life = 'CORE'
                continue
            if elapsed > 12:
                life = 'CASH'; probe_side = 0; probe_ts = None

    if state and signal_ts is not None:
        last_ts = max(int(r['ts']) for r in c if start <= int(r['ts']) < end)
        close(last_ts, idx[pair][last_ts], ['PERIOD_END'])
    return vals, recs


def link_simulate(cid, pair, candles, idx, start, end, cost_bps, delay, model):
    if cid != LINK_CID or pair != 'LINK':
        return ORIGINAL_BASE_SIMULATE(cid, pair, candles, idx, start, end, cost_bps, delay, model)
    th = model['threshold']; c = candles[pair]
    state = 0; life = 'CASH'; probe_side = 0; probe_ts = None; rearm_ready = True
    entry = peak = trough = None; entry_i = entry_ts = signal_ts = None; entry_pred = None
    vals, recs = [], []

    def close(ts, i, flags):
        nonlocal state, life, probe_side, probe_ts, rearm_ready, entry, peak, trough, entry_i, entry_ts, signal_ts, entry_pred
        proposed = i + 1 + delay
        if flags == ['PERIOD_END'] or proposed >= len(c) or int(c[proposed]['ts']) >= end:
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
        i48 = min(entry_i + base.HORIZON, xi); p48 = float(c[i48]['close'])
        gross48 = state * ((p48 / entry - 1) * 100); p0_48 = (gross48 - raw_cost) * v109.RISK[pair]
        regs = base._ctx(pair, candles, idx, signal_ts) or {}
        recs.append({
            'candidate': cid, 'pair': pair, 'side': 'LONG' if state > 0 else 'SHORT',
            'signalTs': signal_ts, 'entryExecTs': entry_ts, 'exitSignalTs': ts, 'exitExecTs': int(c[xi]['ts']),
            'entryPredictor': entry_pred, 'threshold': th, 'entryPrice': entry, 'exitPrice': xp,
            'heldHours': (ts - signal_ts) / HOUR, 'netPnlPct': pnl, 'grossReturnPct': gross,
            'costContributionPct': raw_cost * v109.RISK[pair], 'mfePct': mfe, 'maePct': mae,
            'pnl0To48hPct': p0_48, 'pnl48hToExitPct': pnl - p0_48, 'exitReason': '+'.join(flags),
            'volRatio24_96': regs.get('vr'), 'breadth24': regs.get('breadth'),
            'entryLifecycle': 'VOL_REQUALIFICATION_PROBE_ACCEPTANCE_48H_OWNER',
        })
        vals.append(pnl)
        state = 0; life = 'CASH'; probe_side = 0; probe_ts = None; rearm_ready = False
        entry = peak = trough = None; entry_i = entry_ts = signal_ts = None; entry_pred = None

    prev_ctx = None
    for row in c:
        ts = int(row['ts'])
        if not (start <= ts < end):
            continue
        ctx = base._ctx(pair, candles, idx, ts)
        if ctx is None:
            continue
        i = ctx['i']; pr = v109.predict(base.KIND, pair, candles, idx, ts, model); px = ctx['close']

        # Re-arm only after returning to Cash and volatility has genuinely de-qualified.
        if state == 0 and life == 'CASH' and not rearm_ready and ctx['vr'] < 1.0:
            rearm_ready = True

        if state:
            peak = max(peak, px); trough = min(trough, px); held = (ts - signal_ts) // HOUR
            adverse = (px / peak - 1) * 100 if state > 0 else (trough / px - 1) * 100
            flags = base._exit_flags(pair, state, pr, th, adverse, held, cid)
            if flags:
                close(ts, i, flags); prev_ctx = ctx; continue

        d = 1 if pr >= th else -1 if pr <= -th else 0
        frozen_gate = ctx['v24'] < 3.2 * ctx['v336']
        fresh_vol = prev_ctx is not None and prev_ctx['vr'] < 1.0 and ctx['vr'] >= 1.0

        # Stage 1: fresh volatility requalification only creates a probe; no ownership yet.
        if state == 0 and life == 'CASH' and rearm_ready and fresh_vol and d and frozen_gate:
            probe_side = d; probe_ts = ts; life = 'REQUALIFICATION_PROBE'; prev_ctx = ctx; continue

        if state == 0 and life == 'REQUALIFICATION_PROBE':
            elapsed = (ts - probe_ts) // HOUR
            predictor_reject = pr * probe_side < 0
            fast_support = ctx['r3'] * probe_side > 0 and ctx['r6'] * probe_side > 0
            medium_not_against = ctx['r12'] * probe_side >= 0
            # Stage 2: ownership begins only after causal path acceptance following the
            # fresh vol transition. The 48h clock starts here, not at requalification.
            if predictor_reject or ctx['vr'] < 1.0:
                life = 'CASH'; probe_side = 0; probe_ts = None; rearm_ready = ctx['vr'] < 1.0
            elif elapsed >= 1 and fast_support and medium_not_against:
                opened = _open_trade(c, i, delay, end)
                if opened:
                    entry_i, entry_ts, entry = opened
                    state = probe_side; signal_ts = ts; peak = entry; trough = entry; entry_pred = pr
                    life = 'FORECAST_OWNER'; rearm_ready = False
            elif elapsed > 12:
                life = 'CASH'; probe_side = 0; probe_ts = None; rearm_ready = False

        prev_ctx = ctx

    if state and signal_ts is not None:
        last_ts = max(int(r['ts']) for r in c if start <= int(r['ts']) < end)
        close(last_ts, idx[pair][last_ts], ['PERIOD_END'])
    return vals, recs


def run(pair):
    candles, idx, _ = v109.b.base.load(); ps = v109.b.base.periods(candles)
    model = v109.train(base.KIND, pair, candles, idx, *ps['development'])
    cid = SOL_CID if pair == 'SOL' else LINK_CID
    original_simulate = base.simulate
    base.simulate = sol_simulate if pair == 'SOL' else link_simulate
    try:
        res = base.candidate_result(cid, pair, candles, idx, ps, model)
    finally:
        base.simulate = original_simulate
    out = {
        'researchLine': 'FROZEN_V109_SOL_LINK_NEXT_STRUCTURAL', 'pair': pair,
        'candidateChain': [res], 'selectedForNextStage': cid, 'selectedStatus': res['status'],
        'nextCandidateGeneration': None if res['status'] == 'FROZEN_SURVIVOR' else {
            'sourceDiagnosis': res['diagnosis'],
            'policy': 'NEXT_RUN_NEW_STRUCTURAL_MECHANISM_ONLY_NO_NUMERIC_RETUNE',
            'structuralDirection': ('wrong-wave slow-anchor shadow/release mechanism only' if pair == 'SOL'
                                    else 'volatility-aware Cash plus two-stage requalification/probe/48h ownership only'),
        },
        'periods': {'development': ps['development'], 'validation': ps['validation'],
                    'confirmation': 'UNTOUCHED', 'holdout': 'UNTOUCHED'},
        'frozenV109Changed': False, 'frozenThreshold': model['threshold'], 'frozenRisk': v109.RISK[pair],
        'frozenTrailPct': v109.TRAIL[pair],
        'researchMultiplicity': {'evaluatedThisRun': 1, 'priorCatalog': 6 if pair == 'SOL' else 4,
                                 'cumulative': 7 if pair == 'SOL' else 5},
        'antiOverfit': {'denseSweep': False, 'thresholdRetune': False, 'riskRetune': False, 'trailRetune': False,
                        'sideHardcode': False, 'confirmationRead': False, 'holdoutRead': False,
                        'designEvidence': ['development', 'validation'], 'strictPeriodIsolation': True},
        'productionChanged': False, 'realTradingEnabled': False,
    }
    root = Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR', '.research-state')); root.mkdir(parents=True, exist_ok=True)
    stem = f'{pair.lower()}-v109-autonomous-structural'
    (root / f'{stem}.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
    d, v, s = res['development'], res['validation'], res['validationStress']
    (root / f'{stem}.md').write_text(
        f'# {pair} Frozen V109 Next Structural Successor\n\n- candidate: {cid}\n- status: {res["status"]}\n- diagnosis: {res["diagnosis"]}\n'
        f'- Dev: return {d.get("returnPct")} / PF {d.get("pf")} / DD {d.get("maxDDPct")} / trades {d.get("trades")}\n'
        f'- Val: return {v.get("returnPct")} / PF {v.get("pf")} / DD {v.get("maxDDPct")} / trades {v.get("trades")}\n'
        f'- Stress PF: {s.get("pf")}\n', encoding='utf-8')
    cols = ['candidate','block','pair','side','signalTs','entryExecTs','exitSignalTs','exitExecTs','entryPredictor','threshold','heldHours','netPnlPct','mfePct','maePct','pnl0To48hPct','pnl48hToExitPct','exitReason','volRatio24_96','breadth24','costContributionPct']
    with (root / f'{stem}-ledger.csv').open('w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader()
        for block in ('development', 'validation'):
            for tr in res['ledger'][block]:
                row = {k: tr.get(k) for k in cols}; row['block'] = block; w.writerow(row)
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--pair', choices=('SOL','LINK'), required=True)
    run(ap.parse_args().pair)
