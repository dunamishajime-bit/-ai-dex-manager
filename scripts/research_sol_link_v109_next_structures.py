from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import research_lab_pair_specific_v109 as v109
import research_sol_link_v109_autonomous as base

HOUR = base.HOUR
SOL_CID = 'sol_wrong_wave_contradiction_veto'
LINK_CID = 'link_vol_requalification_rearm_horizon'


def sol_simulate(cid, pair, candles, idx, start, end, cost_bps, delay, model):
    if cid != SOL_CID or pair != 'SOL':
        return base.simulate(cid, pair, candles, idx, start, end, cost_bps, delay, model)
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
            'entryLifecycle': 'LATCHED_SHADOW_CONTRADICTION_VETO_TO_CORE',
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

        if state == 0 and life == 'LATCHED_SHADOW':
            elapsed = (ts - probe_ts) // HOUR
            # Material structural change from the prior latch:
            # reject only when independent predictor-direction AND medium price-path evidence
            # contradict the latched side. Absence of fresh confirmation is not itself rejection.
            predictor_contradiction = pr * probe_side < 0
            medium_contradiction = ctx['r12'] * probe_side < 0
            if predictor_contradiction and medium_contradiction:
                life = 'CASH'; probe_side = 0; probe_ts = None; continue
            # Acceptance is causal and asymmetric: after the same shadow age, either fast or
            # medium path support is sufficient unless the joint contradiction veto fired.
            if elapsed >= 3 and (ctx['r6'] * probe_side > 0 or ctx['r12'] * probe_side > 0):
                ei = i + 1 + delay
                if ei < len(c) and int(c[ei]['ts']) < end:
                    state = probe_side; signal_ts = ts; entry_i = ei; entry_ts = int(c[ei]['ts'])
                    entry = float(c[ei]['open']); peak = entry; trough = entry; entry_pred = pr; life = 'CORE'
                continue
            if elapsed > 12:
                life = 'CASH'; probe_side = 0; probe_ts = None

    if state and signal_ts is not None:
        last_ts = max(int(r['ts']) for r in c if start <= int(r['ts']) < end)
        close(last_ts, idx[pair][last_ts], ['PERIOD_END'])
    return vals, recs


def link_simulate(cid, pair, candles, idx, start, end, cost_bps, delay, model):
    if cid != LINK_CID or pair != 'LINK':
        return base.simulate(cid, pair, candles, idx, start, end, cost_bps, delay, model)
    original_entry_ok = base._entry_ok
    def fresh_requalification(_cid, side, ctx, prev_ctx=None):
        # New structural mechanism: ownership can arm only on a fresh volatility
        # requalification from Cash, not simply because the current vol ratio is high.
        return ctx['vr'] >= 1.0 and prev_ctx is not None and prev_ctx['vr'] < 1.0
    base._entry_ok = fresh_requalification
    try:
        vals, recs = base.simulate('link_cash_rearm_horizon', pair, candles, idx, start, end, cost_bps, delay, model)
    finally:
        base._entry_ok = original_entry_ok
    for r in recs:
        r['candidate'] = cid
        r['entryLifecycle'] = 'VOL_REQUALIFICATION_REARM_48H_OWNER'
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
            'structuralDirection': ('wrong-wave contradiction-veto/acceptance mechanism only' if pair == 'SOL'
                                    else 'volatility-aware Cash plus 48h ownership requalification/re-arm only'),
        },
        'periods': {'development': ps['development'], 'validation': ps['validation'],
                    'confirmation': 'UNTOUCHED', 'holdout': 'UNTOUCHED'},
        'frozenV109Changed': False, 'frozenThreshold': model['threshold'], 'frozenRisk': v109.RISK[pair],
        'frozenTrailPct': v109.TRAIL[pair],
        'researchMultiplicity': {'evaluatedThisRun': 1, 'priorCatalog': 4 if pair == 'SOL' else 3,
                                 'cumulative': 5 if pair == 'SOL' else 4},
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
    # Print complete D/V diagnostics so automation can inspect metrics without artifact download.
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--pair', choices=('SOL','LINK'), required=True)
    run(ap.parse_args().pair)
