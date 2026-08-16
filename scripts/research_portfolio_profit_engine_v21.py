"""Portfolio Profit Engine V21 — broad-to-narrow ownership continuation.

V20 disproved the hypothesis that a 12H prior-rank confirmation fixes V15's
weak validation window. V21 changes a different structural layer: V15 still
requires broad 4-of-6 LONG consensus for NEW ownership, but an existing owner
is not forced to CASH merely because breadth temporarily disappears.

Frozen rule before V21 result:
- new entries: exactly V15 broad-long regime + V14 rank;
- existing position during broad-long: exactly V15 top-2 retention/rotation;
- existing position when broad-long turns off: retain only while that same
  symbol still satisfies the existing V14 long eligibility
  (close>SMA50 and normalizedMomentum20>=the already-frozen V11 minimum);
- if its own trend fails, exit to CASH; no narrow-regime new entries;
- globally anchored 84H decisions, one position, <=100% gross, 1.0x leverage;
- no per-symbol parameters, parameter grid, V/E selection, or Fresh OOS.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8
import research_portfolio_profit_engine_v11 as v11
import research_portfolio_profit_engine_v12 as v12
import research_portfolio_profit_engine_v14 as v14
import research_portfolio_profit_engine_v15 as v15

HOUR = base.HOUR


def _own_long_alive(symbol: str, ts: int, features: dict[str, dict[int, dict[str, float]]]) -> bool:
    x = features.get(symbol, {}).get(ts)
    if x is None:
        return False
    return bool(x['close'] > x['sma50'] and x['normalizedMomentum20'] >= v14.MIN_NORMALIZED_MOMENTUM)


def simulate(candles, index, features, start: int, end: int, cost_bps: float, delay_bars: int):
    checkpoints = sorted(ts for ts in features[v8.REFERENCE_SYMBOL] if start <= ts < end)
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    position: dict[str, Any] | None = None
    records: list[dict[str, Any]] = []

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
        entry = float(position['entryPrice'])
        pnl = (px / entry - 1.0) * 100.0
        mtm = float(position['entryEquity']) * max(0.000001, 1.0 + pnl / 100.0)
        peak = max(peak, mtm)
        max_dd = min(max_dd, (mtm / peak - 1.0) * 100.0)

    def execute(execute_ts: int, desired: dict[str, Any] | None, reason: str, decision_ts: int) -> None:
        nonlocal equity, position, peak, max_dd
        if position is not None:
            symbol = str(position['symbol'])
            i = index[symbol].get(execute_ts)
            if i is None:
                raise RuntimeError(f'V21_EXIT_INDEX_MISSING:{symbol}:{execute_ts}')
            px = float(candles[symbol][i]['open'])
            entry = float(position['entryPrice'])
            gross = (px / entry - 1.0) * 100.0
            net = gross - cost_bps / 100.0
            before = float(position['entryEquity'])
            equity = before * max(0.000001, 1.0 + net / 100.0)
            records.append({
                'symbol': symbol, 'side': 'LONG', 'sideSign': 1,
                'entryTs': int(position['entryTs']), 'exitTs': execute_ts,
                'entryPrice': entry, 'exitPrice': px, 'grossReturnPct': gross,
                'netReturnPct': net, 'entryScore': float(position['entryScore']),
                'exitReason': reason, 'decisionTs': decision_ts,
                'holdingHours': int((execute_ts - int(position['entryTs'])) // HOUR),
                'equityBefore': before, 'equityAfter': equity,
            })
            position = None
            peak = max(peak, equity)
            max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
        if desired is not None:
            symbol = str(desired['symbol'])
            i = index[symbol].get(execute_ts)
            if i is None:
                raise RuntimeError(f'V21_ENTRY_INDEX_MISSING:{symbol}:{execute_ts}')
            px = float(candles[symbol][i]['open'])
            position = {
                'symbol': symbol, 'sideSign': 1, 'entryTs': execute_ts,
                'entryPrice': px, 'entryScore': float(desired['score']),
                'entryEquity': equity,
            }

    for ts in checkpoints:
        update_mtm(ts)
        if not v12._is_rebalance(ts):
            continue

        broad_side = v15._long_only_regime(ts, features)
        ranked = v14._universe_rank(ts, 1, features) if broad_side > 0 else []

        if position is not None and broad_side == 0 and _own_long_alive(str(position['symbol']), ts, features):
            # V21 structural change: breadth may hand ownership to the existing
            # narrow leader; it cannot create a new narrow-regime position.
            continue

        current_rank = None
        if position is not None and broad_side > 0:
            for rank_no, row in enumerate(ranked, 1):
                if row['symbol'] == position['symbol']:
                    current_rank = rank_no
                    break
        if position is not None and broad_side > 0 and current_rank is not None and current_rank <= v11.KEEP_RANK:
            continue

        desired = ranked[0] if broad_side > 0 and ranked else None
        if position is None and desired is None:
            continue
        if position is not None and desired is not None and position['symbol'] == desired['symbol']:
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
        if position is None:
            reason = 'SCHEDULED_ENTRY'
        elif desired is None:
            reason = 'OWN_TREND_FAILED_TO_CASH'
        else:
            reason = 'SCHEDULED_ROTATION'
        execute(execute_ts, desired, reason, ts)

    if position is not None:
        symbol = str(position['symbol'])
        final_ts = max(int(r['ts']) for r in candles[symbol] if start <= int(r['ts']) < end)
        i = index[symbol][final_ts]
        px = float(candles[symbol][i]['close'])
        entry = float(position['entryPrice'])
        gross = (px / entry - 1.0) * 100.0
        net = gross - cost_bps / 100.0
        before = float(position['entryEquity'])
        equity = before * max(0.000001, 1.0 + net / 100.0)
        records.append({
            'symbol': symbol, 'side': 'LONG', 'sideSign': 1,
            'entryTs': int(position['entryTs']), 'exitTs': final_ts,
            'entryPrice': entry, 'exitPrice': px, 'grossReturnPct': gross,
            'netReturnPct': net, 'entryScore': float(position['entryScore']),
            'exitReason': 'PERIOD_END', 'decisionTs': final_ts,
            'holdingHours': int((final_ts - int(position['entryTs'])) // HOUR),
            'equityBefore': before, 'equityAfter': equity,
        })
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)

    metric = v8._metric(records, start, end, max_dd)
    metric['symbolContributionPctPoints']['BTC'] = sum(float(r['netReturnPct']) for r in records if r['symbol'] == 'BTC')
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
        'researchLine': 'PORTFOLIO_PROFIT_ENGINE_V21_BROAD_TO_NARROW_OWNERSHIP',
        'researchOnly': True, 'productionChanged': False, 'vpsChanged': False, 'liveChanged': False,
        'realTradingEnabled': False, 'liveEligible': False, 'freshOosRead': False, 'freshOosConsumed': False,
        'freshOosPermission': bool(gate['historicalCandidatePass']),
        'target': {'main3YCagrPct': 100.0, 'progressFloorCagrPct': 80.0, 'grossExposureCapPct': 100.0, 'leverageMultiplier': 1.0},
        'architecture': 'V15 broad-long entries -> V15 top2 rotation -> existing owner may persist through narrow breadth while own V14 long eligibility remains alive',
        'diagnosisBasis': {
            'source': 'V20 failure + legacy benchmark lifecycle decomposition',
            'finding': 'prior-rank confirmation reduced edge; test whether broad-market exit is prematurely terminating independently persistent leaders',
            'newNarrowEntriesAllowed': False,
            'v15EntryRegimeChanged': False,
            'v15RankFormulaChanged': False,
        },
        'antiOverfit': {
            'parameterGrid': False, 'perSymbolParameters': False, 'sameRunRetuning': False,
            'validationUsedForSelection': False, 'evaluationUsedForSelection': False,
            'freshOosUsedForTuning': False, 'leverageUsedToReachTarget': False,
            'onePositionMaximum': True, 'newNumericThresholds': False,
        },
        'schedule': {'decisionHours': v11.REBALANCE_BARS * v11.BAR_HOURS, 'globalAnchorTs': base.START_2023, 'intraCycleExit': False, 'keepRank': v11.KEEP_RANK},
        'costs': {'normalTotalBpsPerRoundTrip': v8.NORMAL_BPS, 'stressTotalBpsPerRoundTrip': v8.STRESS_BPS, 'stressExtraDelayBars': v8.STRESS_DELAY},
        'periods': base.PERIODS, 'annual': annual, 'annualStress': annual_stress,
        'combined3Y': combined, 'combined3YStress': stress, 'historicalGate': gate,
    }
    root = Path(os.environ.get('RESEARCH_STATE_DIR', '.research-state'))
    root.mkdir(parents=True, exist_ok=True)
    (root / 'portfolio-profit-engine-v21.json').write_text(json.dumps(out, indent=2, sort_keys=True), encoding='utf-8')
    with (root / 'portfolio-profit-engine-v21-trades.jsonl').open('w', encoding='utf-8') as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True) + '\n')
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
