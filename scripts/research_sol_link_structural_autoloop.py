from __future__ import annotations

import argparse
import json
import math
import os
import statistics
from pathlib import Path

import research_lab_pair_specific_v109 as v109

KIND = 'regime_wave'
PAIRS = ('SOL', 'LINK')
HOUR = v109.HOUR
MAX_GENERATIONS = 3


def mean(xs):
    return statistics.fmean(xs) if xs else 0.0


def median(xs):
    return statistics.median(xs) if xs else None


def causal_vol_median(c, i, lookback_hours=24*30):
    vals = []
    start = max(168, i - lookback_hours)
    for j in range(start, i, 24):
        x = v109.b.vol(c, j, 24)
        if x and x > 1e-12:
            vals.append(x)
    return median(vals)


def breadth_regime(candles, idx, ts):
    br = v109.b.breadth(candles, idx, ts, 24)
    if br is None:
        return 'UNKNOWN', None
    if br >= 0.60:
        return 'BULL', br
    if br <= 0.40:
        return 'BEAR', br
    return 'MIXED', br


def metric(vals):
    return v109.metric(vals)


def score_pair(dev, val, stress):
    # Predeclared broad objective; no confirmation/holdout access and no dense tuning.
    return (
        1.0 * (dev.get('returnPct') or 0)
        + 1.5 * (val.get('returnPct') or 0)
        + 8.0 * ((dev.get('pf') or 0) - 1)
        + 12.0 * ((val.get('pf') or 0) - 1)
        + 6.0 * ((stress.get('pf') or 0) - 1)
        - 0.25 * abs(val.get('maxDDPct') or 0)
        + 0.04 * min(val.get('trades') or 0, 50)
    )


def initial_specs(pair):
    if pair == 'SOL':
        return [
            {
                'id': 'SOL_WRONGWAVE_PROBE_CONFIRM',
                'pair': pair,
                'architecture': 'wrong_wave_rejection',
                'probe': True,
                'entryConsensus': False,
                'earlyAbort': True,
                'forecastOwnership': False,
            },
            {
                'id': 'SOL_WRONGWAVE_CONSENSUS_REJECT',
                'pair': pair,
                'architecture': 'wrong_wave_rejection',
                'probe': False,
                'entryConsensus': True,
                'earlyAbort': True,
                'forecastOwnership': False,
            },
        ]
    return [
        {
            'id': 'LINK_VOL_CASH_HORIZON',
            'pair': pair,
            'architecture': 'volatility_cash_forecast_ownership',
            'volCash': True,
            'volReactivation': False,
            'forecastOwnership': True,
        },
        {
            'id': 'LINK_VOL_REACTIVATION_HORIZON',
            'pair': pair,
            'architecture': 'volatility_cash_forecast_ownership',
            'volCash': True,
            'volReactivation': True,
            'forecastOwnership': True,
        },
    ]


def generate_next(pair, generation, best, diagnosis):
    # Structural mutation only. No threshold/trail/risk parameter sweep.
    if pair == 'SOL':
        if diagnosis['tailLossDominant']:
            return [{
                'id': f'SOL_WRONGWAVE_PROBE_CONSENSUS_G{generation+1}',
                'pair': pair,
                'architecture': 'wrong_wave_rejection',
                'probe': True,
                'entryConsensus': True,
                'earlyAbort': True,
                'forecastOwnership': False,
                'parent': best['id'],
            }]
        return [{
            'id': f'SOL_WRONGWAVE_PROBE_PERSIST_G{generation+1}',
            'pair': pair,
            'architecture': 'wrong_wave_rejection',
            'probe': True,
            'entryConsensus': False,
            'earlyAbort': True,
            'forecastOwnership': False,
            'parent': best['id'],
        }]
    if diagnosis['lowVolLeak']:
        return [{
            'id': f'LINK_VOL_CASH_REACT_HORIZON_G{generation+1}',
            'pair': pair,
            'architecture': 'volatility_cash_forecast_ownership',
            'volCash': True,
            'volReactivation': True,
            'forecastOwnership': True,
            'parent': best['id'],
        }]
    return [{
        'id': f'LINK_HORIZON_OWNER_G{generation+1}',
        'pair': pair,
        'architecture': 'volatility_cash_forecast_ownership',
        'volCash': False,
        'volReactivation': False,
        'forecastOwnership': True,
        'parent': best['id'],
    }]


def simulate(spec, candles, idx, start, end, cost_bps, delay_hours, model):
    s = spec['pair']
    c = candles[s]
    th = model['threshold']
    state = 0
    signal_ts = None
    entry_signal_i = None
    legs = []
    peak = trough = None
    vals = []
    ledger = []
    low_vol_prev = False

    for row in c:
        ts = int(row['ts'])
        if not (start <= ts < end):
            continue
        i = idx[s].get(ts)
        if i is None or i < 900:
            continue
        px = float(c[i]['close'])
        pr = v109.predict(KIND, s, candles, idx, ts, model)
        v24 = v109.b.vol(c, i, 24)
        v336 = v109.b.vol(c, i, 336)
        vm = causal_vol_median(c, i)
        low_vol = bool(vm and v24 and v24 < vm)
        breg, br = breadth_regime(candles, idx, ts)
        r12 = v109.ret(c, i, 12) or 0.0

        if state:
            peak = max(peak, px)
            trough = min(trough, px)
            held = (ts - signal_ts) / HOUR
            initial_dir = 1 if state > 0 else -1
            gross_from_first = initial_dir * ((px / legs[0]['price'] - 1) * 100)
            favorable = gross_from_first > 0
            predictor_wrong = (state > 0 and pr <= 0) or (state < 0 and pr >= 0)
            predictor_decay = (state > 0 and pr < .10 * th) or (state < 0 and pr > -.10 * th)
            early_abort = False
            if spec.get('earlyAbort') and held <= 24:
                early_abort = predictor_wrong and not favorable

            # Probe -> core is a real persistent transition with a second leg.
            if s == 'SOL' and spec.get('probe') and len(legs) == 1 and legs[0]['role'] == 'PROBE' and held >= 6:
                consensus_ok = (state > 0 and r12 > 0 and breg != 'BEAR') or (state < 0 and r12 < 0 and breg != 'BULL')
                pred_persist = (state > 0 and pr >= th) or (state < 0 and pr <= -th)
                if pred_persist and consensus_ok:
                    ei = min(i + 1 + delay_hours, len(c) - 1)
                    legs.append({'price': float(c[ei]['open']), 'risk': v109.RISK[s] * 0.5, 'role': 'CORE_ADD', 'ts': int(c[ei]['ts'])})

            adverse = (px / peak - 1) * 100 if state > 0 else (trough / px - 1) * 100
            trail_hit = adverse <= -v109.TRAIL[s]
            horizon_exit = bool(spec.get('forecastOwnership') and held >= v109.HORIZON)
            maxhold_exit = held >= 144
            exitnow = early_abort or predictor_decay or trail_hit or horizon_exit or maxhold_exit

            if exitnow:
                xi = min(i + 1 + delay_hours, len(c) - 1)
                xp = float(c[xi]['open'])
                pnl = 0.0
                gross = 0.0
                cost_pct = cost_bps / 100
                for leg in legs:
                    leg_gross = state * ((xp / leg['price'] - 1) * 100)
                    gross += leg_gross * leg['risk']
                    pnl += (leg_gross - cost_pct) * leg['risk']
                vals.append(pnl)
                reason = 'EARLY_WRONGWAVE_ABORT' if early_abort else 'PREDICTOR_DECAY' if predictor_decay else 'TRAIL' if trail_hit else 'FORECAST_HORIZON' if horizon_exit else 'MAXHOLD'
                ledger.append({
                    'pair': s, 'candidate': spec['id'], 'side': 'LONG' if state > 0 else 'SHORT',
                    'entrySignalTs': signal_ts, 'exitSignalTs': ts, 'heldHours': held,
                    'legs': legs, 'exitPrice': xp, 'netPnlPct': pnl, 'grossWeightedPct': gross,
                    'exitReason': reason, 'entryPredictor': ledger[-1]['entryPredictor'] if False else None,
                    'exitPredictor': pr, 'volRegimeAtExit': 'LOW' if low_vol else 'NON_LOW',
                    'breadthAtExit': br,
                })
                state = 0
                signal_ts = None
                entry_signal_i = None
                legs = []
                peak = trough = None

        if state == 0:
            d = 1 if pr >= th else -1 if pr <= -th else 0
            frozen_gate = bool(v336 and v336 > 1e-9 and v24 < 3.2 * v336)
            if s == 'LINK' and spec.get('volCash') and low_vol:
                d = 0
            if s == 'LINK' and spec.get('volReactivation'):
                # Must be entering after a causal low-vol -> non-low-vol transition.
                if not (low_vol_prev and not low_vol):
                    d = 0
            if s == 'SOL' and spec.get('entryConsensus') and d:
                consensus_ok = (d > 0 and r12 > 0 and breg != 'BEAR') or (d < 0 and r12 < 0 and breg != 'BULL')
                if not consensus_ok:
                    d = 0
            if d and frozen_gate:
                ei = i + 1 + delay_hours
                if ei < len(c):
                    state = d
                    risk = v109.RISK[s] * (0.5 if s == 'SOL' and spec.get('probe') else 1.0)
                    ep = float(c[ei]['open'])
                    legs = [{'price': ep, 'risk': risk, 'role': 'PROBE' if risk < v109.RISK[s] else 'CORE', 'ts': int(c[ei]['ts'])}]
                    signal_ts = ts
                    entry_signal_i = i
                    peak = trough = ep
        low_vol_prev = low_vol

    # Period-end close for open research position.
    if state and legs:
        rows = [r for r in c if start <= int(r['ts']) < end]
        if rows:
            last_ts = int(rows[-1]['ts'])
            i = idx[s][last_ts]
            xp = float(c[i]['close'])
            pnl = 0.0
            cost_pct = cost_bps / 100
            for leg in legs:
                leg_gross = state * ((xp / leg['price'] - 1) * 100)
                pnl += (leg_gross - cost_pct) * leg['risk']
            vals.append(pnl)
            ledger.append({'pair': s, 'candidate': spec['id'], 'side': 'LONG' if state > 0 else 'SHORT', 'entrySignalTs': signal_ts, 'exitSignalTs': last_ts, 'heldHours': (last_ts-signal_ts)/HOUR, 'legs': legs, 'exitPrice': xp, 'netPnlPct': pnl, 'exitReason': 'PERIOD_END'})
    return vals, ledger


def diagnose(pair, dev_ledger, val_ledger):
    allr = dev_ledger + val_ledger
    losses = sorted([r['netPnlPct'] for r in allr if r['netPnlPct'] < 0])
    tail = abs(sum(losses[: max(1, len(losses)//5)])) if losses else 0.0
    total_loss = abs(sum(losses)) if losses else 0.0
    low = [r for r in allr if r.get('volRegimeAtExit') == 'LOW']
    low_sum = sum(r['netPnlPct'] for r in low)
    return {
        'tailLossDominant': bool(total_loss and tail / total_loss >= 0.45),
        'lowVolLeak': bool(low and low_sum < 0),
        'tailLossShare': tail / total_loss if total_loss else 0.0,
        'lowVolNetPct': low_sum,
        'tradeCount': len(allr),
    }


def run_pair(pair):
    candles, idx, _ = v109.b.base.load()
    ps = v109.b.base.periods(candles)
    model = v109.train(KIND, pair, candles, idx, *ps['development'])
    generations = []
    specs = initial_specs(pair)
    multiplicity = 0

    for generation in range(MAX_GENERATIONS):
        results = []
        for spec in specs:
            multiplicity += 1
            dv, dl = simulate(spec, candles, idx, *ps['development'], v109.NORMAL_BPS, 0, model)
            vv, vl = simulate(spec, candles, idx, *ps['validation'], v109.NORMAL_BPS, 0, model)
            sv, _ = simulate(spec, candles, idx, *ps['validation'], v109.STRESS_BPS, 1, model)
            dm, vm, sm = metric(dv), metric(vv), metric(sv)
            results.append({
                'spec': spec,
                'development': dm,
                'validation': vm,
                'validationStress': sm,
                'score': score_pair(dm, vm, sm),
                'diagnosis': diagnose(pair, dl, vl),
                'developmentLedger': dl,
                'validationLedger': vl,
            })
        results.sort(key=lambda x: x['score'], reverse=True)
        best = results[0]
        generations.append({'generation': generation, 'candidates': results, 'selected': best['spec']['id']})
        if generation + 1 >= MAX_GENERATIONS:
            break
        specs = generate_next(pair, generation, best['spec'], best['diagnosis'])

    final = generations[-1]['candidates'][0]
    result = {
        'researchLine': 'SOL_WRONG_WAVE_REJECTION' if pair == 'SOL' else 'LINK_VOL_CASH_FORECAST_OWNERSHIP',
        'pair': pair,
        'frozenBase': 'V109_REGIME_WAVE',
        'frozenV109Modified': False,
        'designEvidenceAllowed': ['development', 'validation'],
        'confirmationRead': False,
        'holdoutRead': False,
        'thresholdRetunedByThisLoop': False,
        'trailRetunedByThisLoop': False,
        'riskRetunedByThisLoop': False,
        'researchMultiplicity': multiplicity,
        'generations': generations,
        'finalCandidate': final['spec']['id'],
        'finalDevelopment': final['development'],
        'finalValidation': final['validation'],
        'finalValidationStress': final['validationStress'],
        'productionChanged': False,
        'realTradingEnabled': False,
    }
    out = Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR', '.research-state'))
    out.mkdir(parents=True, exist_ok=True)
    stem = f'{pair.lower()}-structural-autoloop'
    (out / f'{stem}.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    md = [f'# {result["researchLine"]}', '', '- Frozen V109 modified: NO', '- Design evidence: Development/Validation only', f'- Research multiplicity: {multiplicity}', f'- Final candidate: {result["finalCandidate"]}', '', '## Generations']
    for g in generations:
        md.append(f'### G{g["generation"]} selected {g["selected"]}')
        for c in g['candidates']:
            md.append(f'- {c["spec"]["id"]}: Dev {c["development"].get("returnPct")}% PF {c["development"].get("pf")} / Val {c["validation"].get("returnPct")}% PF {c["validation"].get("pf")} / Stress PF {c["validationStress"].get("pf")}')
    (out / f'{stem}.md').write_text('\n'.join(md), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'generations'}, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pair', choices=PAIRS, required=True)
    args = ap.parse_args()
    run_pair(args.pair)


if __name__ == '__main__':
    main()
