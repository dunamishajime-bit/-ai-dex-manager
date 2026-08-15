"""Portfolio Profit Engine V11 — 12H trend regime + cross-pair rotation.

V10 showed that scheduled cross-pair rotations were profitable in all three
historical windows while transient regime activation / regime-to-cash losses
created the major drawdown. V11 replaces V10's z-score regime trigger with a
slow, stateful 12-hour trend definition and uses the same 84-hour capital
rotation cadence.

Architecture is frozen before the first V11 result:
- BTC is reference only and defines LONG / SHORT / CASH using 12H SMA20/SMA60
  plus 20-bar momentum direction.
- Alts use 12H SMA50 plus normalized 20-bar momentum; strongest valid alt is
  held in BTC-long regime, weakest valid alt in BTC-short regime.
- Regime/pair invalidation is checked every 12H; cross-pair ranking rotates at
  most every 7 x 12H = 84H, with top-2 retention to reduce churn.
- one position maximum, <=100% gross exposure, 1.0x leverage.
- no per-symbol constants, parameter grid, Validation/Evaluation selection, or
  Fresh-OOS access.
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

HOUR = base.HOUR
BAR_HOURS = 12
BAR_MS = BAR_HOURS * HOUR
REBALANCE_BARS = 7
BTC_FAST_SMA = 20
BTC_SLOW_SMA = 60
PAIR_SMA = 50
MOMENTUM_BARS = 20
VOL_LOOKBACK_BARS = 20
KEEP_RANK = 2
MIN_NORMALIZED_MOMENTUM = 0.10


def _sampled_features(candles: dict[str, list[dict[str, Any]]]) -> dict[str, dict[int, dict[str, float]]]:
    """Build features only on the fixed 12H clock anchored at START_2023."""
    out: dict[str, dict[int, dict[str, float]]] = {}
    symbols = (v8.REFERENCE_SYMBOL,) + v8.TRADE_SYMBOLS
    for symbol in symbols:
        rows = candles[symbol]
        sampled = [r for r in rows if int(r['ts']) >= base.START_2023 and (int(r['ts']) - base.START_2023) % BAR_MS == 0]
        close = [float(r['close']) for r in sampled]
        features: dict[int, dict[str, float]] = {}
        need = max(BTC_SLOW_SMA, PAIR_SMA, MOMENTUM_BARS + VOL_LOOKBACK_BARS) + 2
        for i in range(need, len(sampled)):
            def sma(n: int) -> float:
                return statistics.fmean(close[i - n + 1:i + 1])
            r12 = []
            for j in range(i - VOL_LOOKBACK_BARS + 1, i + 1):
                prev = close[j - 1]
                r12.append((close[j] / prev - 1.0) * 100.0 if prev > 0 else 0.0)
            sd = statistics.pstdev(r12) if len(r12) >= 10 else 0.0
            prior = close[i - MOMENTUM_BARS]
            mom = (close[i] / prior - 1.0) * 100.0 if prior > 0 else 0.0
            norm_mom = mom / (sd * math.sqrt(float(MOMENTUM_BARS))) if sd > 1e-9 else 0.0
            features[int(sampled[i]['ts'])] = {
                'close': close[i],
                'sma20': sma(BTC_FAST_SMA),
                'sma50': sma(PAIR_SMA),
                'sma60': sma(BTC_SLOW_SMA),
                'momentum20Pct': mom,
                'normalizedMomentum20': norm_mom,
                'vol12hPct': sd,
            }
        out[symbol] = features
    return out


def _btc_regime(ts: int, features: dict[str, dict[int, dict[str, float]]]) -> int:
    x = features[v8.REFERENCE_SYMBOL].get(ts)
    if x is None:
        return 0
    if x['close'] > x['sma60'] and x['sma20'] > x['sma60'] and x['normalizedMomentum20'] > 0:
        return 1
    if x['close'] < x['sma60'] and x['sma20'] < x['sma60'] and x['normalizedMomentum20'] < 0:
        return -1
    return 0


def _rank(ts: int, side: int, features: dict[str, dict[int, dict[str, float]]]) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    if side == 0:
        return ranked
    for symbol in v8.TRADE_SYMBOLS:
        x = features[symbol].get(ts)
        if x is None:
            continue
        if side > 0:
            valid = x['close'] > x['sma50'] and x['normalizedMomentum20'] >= MIN_NORMALIZED_MOMENTUM
        else:
            valid = x['close'] < x['sma50'] and x['normalizedMomentum20'] <= -MIN_NORMALIZED_MOMENTUM
        if not valid:
            continue
        score = side * float(x['normalizedMomentum20'])
        ranked.append({
            'symbol': symbol,
            'sideSign': side,
            'score': score,
            'normalizedMomentum20': float(x['normalizedMomentum20']),
            'momentum20Pct': float(x['momentum20Pct']),
            'close': float(x['close']),
            'sma50': float(x['sma50']),
        })
    ranked.sort(key=lambda r: (-float(r['score']), r['symbol']))
    return ranked


def simulate(candles, index, features, start: int, end: int, cost_bps: float, delay_bars: int):
    checkpoints = sorted(ts for ts in features[v8.REFERENCE_SYMBOL] if start <= ts < end)
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    position: dict[str, Any] | None = None
    pending: dict[str, Any] | None = None
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
        side = int(position['sideSign'])
        entry = float(position['entryPrice'])
        pnl = side * (px / entry - 1.0) * 100.0
        mtm = float(position['entryEquity']) * max(0.000001, 1.0 + pnl / 100.0)
        peak = max(peak, mtm)
        max_dd = min(max_dd, (mtm / peak - 1.0) * 100.0)

    def execute(execute_ts: int, desired: dict[str, Any] | None, reason: str, decision_ts: int) -> None:
        nonlocal equity, position, peak, max_dd
        if position is not None:
            symbol = str(position['symbol'])
            i = index[symbol].get(execute_ts)
            if i is None:
                raise RuntimeError(f'V11_EXIT_INDEX_MISSING:{symbol}:{execute_ts}')
            px = float(candles[symbol][i]['open'])
            side = int(position['sideSign'])
            entry = float(position['entryPrice'])
            gross = side * (px / entry - 1.0) * 100.0
            net = gross - cost_bps / 100.0
            before = float(position['entryEquity'])
            equity = before * max(0.000001, 1.0 + net / 100.0)
            records.append({
                'symbol': symbol,
                'side': 'LONG' if side > 0 else 'SHORT',
                'sideSign': side,
                'entryTs': int(position['entryTs']),
                'exitTs': execute_ts,
                'entryPrice': entry,
                'exitPrice': px,
                'grossReturnPct': gross,
                'netReturnPct': net,
                'entryScore': float(position['entryScore']),
                'exitReason': reason,
                'decisionTs': decision_ts,
                'holdingHours': int((execute_ts - int(position['entryTs'])) // HOUR),
                'equityBefore': before,
                'equityAfter': equity,
            })
            position = None
            peak = max(peak, equity)
            max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
        if desired is not None:
            symbol = str(desired['symbol'])
            i = index[symbol].get(execute_ts)
            if i is None:
                raise RuntimeError(f'V11_ENTRY_INDEX_MISSING:{symbol}:{execute_ts}')
            px = float(candles[symbol][i]['open'])
            position = {
                'symbol': symbol,
                'sideSign': int(desired['sideSign']),
                'entryTs': execute_ts,
                'entryPrice': px,
                'entryScore': float(desired['score']),
                'entryEquity': equity,
            }

    for bar_no, ts in enumerate(checkpoints):
        if pending is not None and ts >= int(pending['executeTs']):
            execute(int(pending['executeTs']), pending['desired'], str(pending['reason']), int(pending['decisionTs']))
            pending = None
        update_mtm(ts)
        if pending is not None:
            continue

        side = _btc_regime(ts, features)
        ranked = _rank(ts, side, features)
        current_valid = False
        current_rank = None
        if position is not None and int(position['sideSign']) == side:
            for rank_no, row in enumerate(ranked, 1):
                if row['symbol'] == position['symbol']:
                    current_valid = True
                    current_rank = rank_no
                    break

        reason: str | None = None
        desired: dict[str, Any] | None = None
        if position is not None and not current_valid:
            reason = '12H_REGIME_OR_PAIR_INVALIDATION'
            desired = ranked[0] if ranked else None
        elif position is None and side != 0 and ranked:
            # Capital may enter only on the fixed 84H rotation clock.
            if bar_no % REBALANCE_BARS == 0:
                reason = 'SCHEDULED_ENTRY'
                desired = ranked[0]
        elif position is not None and bar_no % REBALANCE_BARS == 0:
            if current_rank is not None and current_rank <= KEEP_RANK:
                continue
            desired = ranked[0] if ranked else None
            if desired is None:
                reason = 'SCHEDULED_TO_CASH'
            elif desired['symbol'] != position['symbol'] or int(desired['sideSign']) != int(position['sideSign']):
                reason = 'SCHEDULED_ROTATION'
            else:
                continue

        if reason is None:
            continue
        ref_symbol = str(position['symbol']) if position is not None else (str(desired['symbol']) if desired is not None else '')
        if not ref_symbol:
            continue
        i = index[ref_symbol].get(ts)
        if i is None:
            continue
        ei = i + 1 + delay_bars
        if ei >= len(candles[ref_symbol]):
            continue
        execute_ts = int(candles[ref_symbol][ei]['ts'])
        if execute_ts >= end:
            continue
        pending = {'executeTs': execute_ts, 'desired': desired, 'reason': reason, 'decisionTs': ts}

    pending = None
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
            'equityBefore': before, 'equityAfter': equity,
        })
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)

    return v8._metric(records, start, end, max_dd), records


def main() -> None:
    candles, index, _ = base.v109.b.base.load()
    features = _sampled_features(candles)
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
        'researchLine': 'PORTFOLIO_PROFIT_ENGINE_V11_12H_TREND_ROTATION',
        'researchOnly': True,
        'productionChanged': False,
        'vpsChanged': False,
        'liveChanged': False,
        'realTradingEnabled': False,
        'liveEligible': False,
        'freshOosRead': False,
        'freshOosConsumed': False,
        'freshOosPermission': bool(gate['historicalCandidatePass']),
        'target': {'main3YCagrPct': 100.0, 'progressFloorCagrPct': 80.0, 'grossExposureCapPct': 100.0, 'leverageMultiplier': 1.0},
        'architecture': 'BTC 12H trend regime -> alt SMA50 ownership -> normalized momentum ranking -> 84H rotation / 12H invalidation',
        'diagnosisBasis': {
            'source': 'V10 structural result',
            'finding': 'scheduled rotations profitable across D/V/E; transient regime activation and regime-to-cash losses dominate bad window',
            'v10ThresholdRescue': False,
        },
        'antiOverfit': {
            'parameterGrid': False,
            'perSymbolParameters': False,
            'sameRunRetuning': False,
            'validationUsedForSelection': False,
            'evaluationUsedForSelection': False,
            'freshOosUsedForTuning': False,
            'leverageUsedToReachTarget': False,
            'onePositionMaximum': True,
        },
        'constants': {
            'barHours': BAR_HOURS,
            'btcFastSmaBars': BTC_FAST_SMA,
            'btcSlowSmaBars': BTC_SLOW_SMA,
            'pairSmaBars': PAIR_SMA,
            'momentumBars': MOMENTUM_BARS,
            'rebalanceBars': REBALANCE_BARS,
            'keepRank': KEEP_RANK,
            'minNormalizedMomentum': MIN_NORMALIZED_MOMENTUM,
        },
        'costs': {'normalTotalBpsPerRoundTrip': v8.NORMAL_BPS, 'stressTotalBpsPerRoundTrip': v8.STRESS_BPS, 'stressExtraDelayBars': v8.STRESS_DELAY},
        'periods': base.PERIODS,
        'annual': annual,
        'annualStress': annual_stress,
        'combined3Y': combined,
        'combined3YStress': stress,
        'historicalGate': gate,
    }
    root = Path(os.environ.get('RESEARCH_STATE_DIR', '.research-state'))
    root.mkdir(parents=True, exist_ok=True)
    (root / 'portfolio-profit-engine-v11.json').write_text(json.dumps(out, indent=2, sort_keys=True), encoding='utf-8')
    with (root / 'portfolio-profit-engine-v11-trades.jsonl').open('w', encoding='utf-8') as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True) + '\n')
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
