"""Portfolio Profit Engine V13 — breadth/persistence Regime Quality layer.

V12's fixed 84H ownership restored profitable rotation behavior, but 2024-25
lost on both LONG and SHORT. That rules out a simple side inversion and points
to false trend classification. V13 keeps the V11/V12 pair ranking and 84H
ownership lifecycle frozen, and adds a market-level quality gate before capital
may be allocated.

A tradable regime must:
1. keep the same non-zero BTC 12H trend state for three consecutive 12H bars;
2. have |BTC normalized 20-bar momentum| >= 0.35;
3. have at least 3 of 5 alts aligned with the regime by SMA50 + momentum sign.

All constants are global and fixed before the first V13 result. No per-symbol
parameter, grid search, Validation/Evaluation selection, Fresh OOS, or leverage.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8
import research_portfolio_profit_engine_v11 as v11

HOUR = base.HOUR
PERSISTENCE_BARS = 3
MIN_BTC_ABS_NORMALIZED_MOMENTUM = 0.35
MIN_ALIGNED_PAIRS = 3


def _quality_regime(ts: int, features: dict[str, dict[int, dict[str, float]]]) -> tuple[int, dict[str, Any]]:
    side = v11._btc_regime(ts, features)
    btc = features[v8.REFERENCE_SYMBOL].get(ts)
    if side == 0 or btc is None:
        return 0, {'reason': 'BTC_NO_TREND'}
    history = [v11._btc_regime(ts - n * v11.BAR_MS, features) for n in range(PERSISTENCE_BARS)]
    if any(s != side for s in history):
        return 0, {'reason': 'REGIME_NOT_PERSISTENT', 'side': side, 'history': history}
    if abs(float(btc['normalizedMomentum20'])) < MIN_BTC_ABS_NORMALIZED_MOMENTUM:
        return 0, {'reason': 'BTC_MOMENTUM_WEAK', 'side': side, 'btcNormMomentum': float(btc['normalizedMomentum20'])}
    aligned = 0
    states: dict[str, bool] = {}
    for symbol in v8.TRADE_SYMBOLS:
        x = features[symbol].get(ts)
        if x is None:
            states[symbol] = False
            continue
        ok = bool(
            (side > 0 and x['close'] > x['sma50'] and x['normalizedMomentum20'] > 0)
            or (side < 0 and x['close'] < x['sma50'] and x['normalizedMomentum20'] < 0)
        )
        states[symbol] = ok
        aligned += int(ok)
    if aligned < MIN_ALIGNED_PAIRS:
        return 0, {'reason': 'BREADTH_WEAK', 'side': side, 'alignedPairs': aligned, 'states': states}
    return side, {
        'reason': 'QUALITY_PASS',
        'side': side,
        'alignedPairs': aligned,
        'btcNormMomentum': float(btc['normalizedMomentum20']),
    }


def _is_rebalance(ts: int) -> bool:
    delta = ts - base.START_2023
    return delta >= 0 and delta % (v11.REBALANCE_BARS * v11.BAR_MS) == 0


def simulate(candles, index, features, start: int, end: int, cost_bps: float, delay_bars: int):
    checkpoints = sorted(ts for ts in features[v8.REFERENCE_SYMBOL] if start <= ts < end)
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    position: dict[str, Any] | None = None
    records: list[dict[str, Any]] = []
    quality_counts: dict[str, int] = {}

    def update_mtm(ts: int) -> None:
        nonlocal peak, max_dd
        if position is None:
            peak = max(peak, equity)
            max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
            return
        symbol = str(position['symbol'])
        i = index[symbol].get(ts)
        if i is None:
            return
        px = float(candles[symbol][i]['close'])
        side = int(position['sideSign'])
        entry = float(position['entryPrice'])
        pnl = side * (px / entry - 1.0) * 100.0
        mtm = float(position['entryEquity']) * max(0.000001, 1.0 + pnl / 100.0)
        peak = max(peak, mtm)
        max_dd = min(max_dd, (mtm / peak - 1.0) * 100.0)

    def execute(execute_ts: int, desired: dict[str, Any] | None, reason: str, decision_ts: int, quality: dict[str, Any]) -> None:
        nonlocal equity, position, peak, max_dd
        if position is not None:
            symbol = str(position['symbol'])
            i = index[symbol].get(execute_ts)
            if i is None:
                raise RuntimeError(f'V13_EXIT_INDEX_MISSING:{symbol}:{execute_ts}')
            px = float(candles[symbol][i]['open'])
            side = int(position['sideSign'])
            entry = float(position['entryPrice'])
            gross = side * (px / entry - 1.0) * 100.0
            net = gross - cost_bps / 100.0
            before = float(position['entryEquity'])
            equity = before * max(0.000001, 1.0 + net / 100.0)
            records.append({
                'symbol': symbol, 'side': 'LONG' if side > 0 else 'SHORT', 'sideSign': side,
                'entryTs': int(position['entryTs']), 'exitTs': execute_ts,
                'entryPrice': entry, 'exitPrice': px, 'grossReturnPct': gross, 'netReturnPct': net,
                'entryScore': float(position['entryScore']), 'exitReason': reason,
                'decisionTs': decision_ts, 'holdingHours': int((execute_ts - int(position['entryTs'])) // HOUR),
                'qualityAtExitDecision': quality, 'equityBefore': before, 'equityAfter': equity,
            })
            position = None
            peak = max(peak, equity)
            max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
        if desired is not None:
            symbol = str(desired['symbol'])
            i = index[symbol].get(execute_ts)
            if i is None:
                raise RuntimeError(f'V13_ENTRY_INDEX_MISSING:{symbol}:{execute_ts}')
            px = float(candles[symbol][i]['open'])
            position = {
                'symbol': symbol, 'sideSign': int(desired['sideSign']), 'entryTs': execute_ts,
                'entryPrice': px, 'entryScore': float(desired['score']), 'entryEquity': equity,
                'qualityAtEntry': quality,
            }

    for ts in checkpoints:
        update_mtm(ts)
        if not _is_rebalance(ts):
            continue
        side, quality = _quality_regime(ts, features)
        qreason = str(quality.get('reason', 'UNKNOWN'))
        quality_counts[qreason] = quality_counts.get(qreason, 0) + 1
        ranked = v11._rank(ts, side, features)
        current_rank = None
        if position is not None and int(position['sideSign']) == side:
            for rank_no, row in enumerate(ranked, 1):
                if row['symbol'] == position['symbol']:
                    current_rank = rank_no
                    break
        if position is not None and side != 0 and current_rank is not None and current_rank <= v11.KEEP_RANK:
            continue
        desired = ranked[0] if side != 0 and ranked else None
        if position is None and desired is None:
            continue
        if position is not None and desired is not None and position['symbol'] == desired['symbol'] and int(position['sideSign']) == int(desired['sideSign']):
            continue
        ref_symbol = str(position['symbol']) if position is not None else str(desired['symbol'])
        i = index[ref_symbol].get(ts)
        if i is None:
            continue
        ei = i + 1 + delay_bars
        if ei >= len(candles[ref_symbol]):
            continue
        execute_ts = int(candles[ref_symbol][ei]['ts'])
        if execute_ts >= end:
            continue
        reason = 'QUALITY_ENTRY' if position is None else 'QUALITY_TO_CASH' if desired is None else 'QUALITY_ROTATION'
        execute(execute_ts, desired, reason, ts, quality)

    if position is not None:
        symbol = str(position['symbol'])
        final_ts = max(int(r['ts']) for r in candles[symbol] if start <= int(r['ts']) < end)
        i = index[symbol][final_ts]
        px = float(candles[symbol][i]['close'])
        side = int(position['sideSign'])
        entry = float(position['entryPrice'])
        gross = side * (px / entry - 1.0) * 100.0
        net = gross - cost_bps / 100.0
        before = float(position['entryEquity'])
        equity = before * max(0.000001, 1.0 + net / 100.0)
        records.append({
            'symbol': symbol, 'side': 'LONG' if side > 0 else 'SHORT', 'sideSign': side,
            'entryTs': int(position['entryTs']), 'exitTs': final_ts,
            'entryPrice': entry, 'exitPrice': px, 'grossReturnPct': gross, 'netReturnPct': net,
            'entryScore': float(position['entryScore']), 'exitReason': 'PERIOD_END', 'decisionTs': final_ts,
            'holdingHours': int((final_ts - int(position['entryTs'])) // HOUR),
            'qualityAtExitDecision': {'reason': 'PERIOD_END'}, 'equityBefore': before, 'equityAfter': equity,
        })
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
    metric = v8._metric(records, start, end, max_dd)
    metric['qualityDecisionCounts'] = quality_counts
    return metric, records


def main() -> None:
    candles, index, _ = base.v109.b.base.load()
    features = v11._sampled_features(candles)
    annual: dict[str, dict[str, Any]] = {}
    annual_stress: dict[str, dict[str, Any]] = {}
    for label in ('development', 'validation', 'evaluation'):
        start, end = base.PERIODS[label]
        annual[label], _ = simulate(candles, index, features, start, end, v8.NORMAL_BPS, 0)
        annual_stress[label], _ = simulate(candles, index, features, start, end, v8.STRESS_BPS, v8.STRESS_DELAY)
    start, end = base.PERIODS['combined']
    combined, records = simulate(candles, index, features, start, end, v8.NORMAL_BPS, 0)
    stress, _ = simulate(candles, index, features, start, end, v8.STRESS_BPS, v8.STRESS_DELAY)
    gate = v8._historical_gate(combined, stress, annual)
    out = {
        'researchLine': 'PORTFOLIO_PROFIT_ENGINE_V13_REGIME_QUALITY',
        'researchOnly': True, 'productionChanged': False, 'vpsChanged': False, 'liveChanged': False,
        'realTradingEnabled': False, 'liveEligible': False, 'freshOosRead': False, 'freshOosConsumed': False,
        'freshOosPermission': bool(gate['historicalCandidatePass']),
        'target': {'main3YCagrPct': 100.0, 'progressFloorCagrPct': 80.0, 'grossExposureCapPct': 100.0, 'leverageMultiplier': 1.0},
        'architecture': 'V11 12H trend/rank -> market Regime Quality persistence+breadth -> V12 fixed 84H ownership',
        'diagnosisBasis': {
            'source': 'V12 D/V/E side decomposition',
            'finding': '2024-25 loses on both LONG and SHORT, so direction inversion is rejected; require market-wide persistent trend quality',
            'v11PairRankingChanged': False,
            'v12OwnershipCadenceChanged': False,
        },
        'antiOverfit': {
            'parameterGrid': False, 'perSymbolParameters': False, 'sameRunRetuning': False,
            'validationUsedForSelection': False, 'evaluationUsedForSelection': False,
            'freshOosUsedForTuning': False, 'leverageUsedToReachTarget': False, 'onePositionMaximum': True,
        },
        'qualityGate': {
            'persistenceBars12H': PERSISTENCE_BARS,
            'minBtcAbsNormalizedMomentum20': MIN_BTC_ABS_NORMALIZED_MOMENTUM,
            'minAlignedAltPairs': MIN_ALIGNED_PAIRS,
            'totalAltPairs': len(v8.TRADE_SYMBOLS),
        },
        'schedule': {'decisionHours': v11.REBALANCE_BARS * v11.BAR_HOURS, 'globalAnchorTs': base.START_2023, 'intraCycleExit': False, 'keepRank': v11.KEEP_RANK},
        'costs': {'normalTotalBpsPerRoundTrip': v8.NORMAL_BPS, 'stressTotalBpsPerRoundTrip': v8.STRESS_BPS, 'stressExtraDelayBars': v8.STRESS_DELAY},
        'periods': base.PERIODS, 'annual': annual, 'annualStress': annual_stress,
        'combined3Y': combined, 'combined3YStress': stress, 'historicalGate': gate,
    }
    root = Path(os.environ.get('RESEARCH_STATE_DIR', '.research-state'))
    root.mkdir(parents=True, exist_ok=True)
    (root / 'portfolio-profit-engine-v13.json').write_text(json.dumps(out, indent=2, sort_keys=True), encoding='utf-8')
    with (root / 'portfolio-profit-engine-v13-trades.jsonl').open('w', encoding='utf-8') as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True) + '\n')
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
