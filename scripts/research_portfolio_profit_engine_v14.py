"""Portfolio Profit Engine V14 — six-asset consensus breadth rotation.

V13 showed that a BTC-led quality gate still accepted roughly the same number
of regimes in the losing 2024-25 window as in profitable windows. V14 therefore
removes BTC's privileged regime role. BTC becomes a tradable member of a six-
asset universe (BTC/SOL/LINK/ETH/BNB/AVAX), and the market direction is defined
by cross-sectional consensus itself.

Frozen architecture before first V14 result:
- 12H features are exactly V11's SMA50 + normalized 20-bar momentum;
- LONG only when >=4/6 assets are above SMA50 with positive momentum;
- SHORT only when >=4/6 assets are below SMA50 with negative momentum;
- strongest aligned asset is held LONG / weakest aligned asset SHORT;
- globally anchored 84H V12 ownership lifecycle, top-2 retention;
- one position max, <=100% gross exposure, 1.0x leverage;
- no per-symbol tuning, grid, V/E selection, or Fresh OOS.
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

UNIVERSE = ('BTC', 'SOL', 'LINK', 'ETH', 'BNB', 'AVAX')
CONSENSUS_COUNT = 4
MIN_NORMALIZED_MOMENTUM = v11.MIN_NORMALIZED_MOMENTUM


def _breadth_regime(ts: int, features: dict[str, dict[int, dict[str, float]]]) -> int:
    long_count = 0
    short_count = 0
    for symbol in UNIVERSE:
        x = features[symbol].get(ts)
        if x is None:
            continue
        long_count += int(x['close'] > x['sma50'] and x['normalizedMomentum20'] > 0)
        short_count += int(x['close'] < x['sma50'] and x['normalizedMomentum20'] < 0)
    if long_count >= CONSENSUS_COUNT and long_count > short_count:
        return 1
    if short_count >= CONSENSUS_COUNT and short_count > long_count:
        return -1
    return 0


def _universe_rank(ts: int, side: int, features: dict[str, dict[int, dict[str, float]]]) -> list[dict[str, Any]]:
    if side == 0:
        return []
    ranked: list[dict[str, Any]] = []
    for symbol in UNIVERSE:
        x = features[symbol].get(ts)
        if x is None:
            continue
        if side > 0:
            valid = x['close'] > x['sma50'] and x['normalizedMomentum20'] >= MIN_NORMALIZED_MOMENTUM
        else:
            valid = x['close'] < x['sma50'] and x['normalizedMomentum20'] <= -MIN_NORMALIZED_MOMENTUM
        if not valid:
            continue
        ranked.append({
            'symbol': symbol,
            'sideSign': side,
            'score': side * float(x['normalizedMomentum20']),
            'normalizedMomentum20': float(x['normalizedMomentum20']),
            'momentum20Pct': float(x['momentum20Pct']),
            'close': float(x['close']),
            'sma50': float(x['sma50']),
        })
    ranked.sort(key=lambda row: (-float(row['score']), row['symbol']))
    return ranked


def simulate(candles, index, features, start: int, end: int, cost_bps: float, delay_bars: int):
    # Reuse only V12's frozen ownership mechanics while substituting the clean
    # V14 consensus regime/ranking for the duration of this call.
    old_regime = v11._btc_regime
    old_rank = v11._rank
    v11._btc_regime = _breadth_regime
    v11._rank = _universe_rank
    try:
        metric, records = v12.simulate(candles, index, features, start, end, cost_bps, delay_bars)
    finally:
        v11._btc_regime = old_regime
        v11._rank = old_rank
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
        'researchLine': 'PORTFOLIO_PROFIT_ENGINE_V14_SIX_ASSET_BREADTH_ROTATION',
        'researchOnly': True, 'productionChanged': False, 'vpsChanged': False, 'liveChanged': False,
        'realTradingEnabled': False, 'liveEligible': False, 'freshOosRead': False, 'freshOosConsumed': False,
        'freshOosPermission': bool(gate['historicalCandidatePass']),
        'target': {'main3YCagrPct': 100.0, 'progressFloorCagrPct': 80.0, 'grossExposureCapPct': 100.0, 'leverageMultiplier': 1.0},
        'architecture': '6-asset 12H consensus breadth -> strongest/weakest aligned asset -> globally anchored 84H ownership',
        'universe': list(UNIVERSE),
        'diagnosisBasis': {
            'source': 'V13 regime-quality counts and 2024-25 failure',
            'finding': 'BTC-led regime qualification did not distinguish the losing window; replace privileged leader with cross-sectional consensus',
            'v12OwnershipLifecycleChanged': False,
        },
        'antiOverfit': {
            'parameterGrid': False, 'perSymbolParameters': False, 'sameRunRetuning': False,
            'validationUsedForSelection': False, 'evaluationUsedForSelection': False,
            'freshOosUsedForTuning': False, 'leverageUsedToReachTarget': False, 'onePositionMaximum': True,
        },
        'breadthGate': {'requiredAlignedAssets': CONSENSUS_COUNT, 'totalAssets': len(UNIVERSE), 'minNormalizedMomentum': MIN_NORMALIZED_MOMENTUM},
        'schedule': {'decisionHours': v11.REBALANCE_BARS * v11.BAR_HOURS, 'globalAnchorTs': base.START_2023, 'intraCycleExit': False, 'keepRank': v11.KEEP_RANK},
        'costs': {'normalTotalBpsPerRoundTrip': v8.NORMAL_BPS, 'stressTotalBpsPerRoundTrip': v8.STRESS_BPS, 'stressExtraDelayBars': v8.STRESS_DELAY},
        'periods': base.PERIODS, 'annual': annual, 'annualStress': annual_stress,
        'combined3Y': combined, 'combined3YStress': stress, 'historicalGate': gate,
    }
    root = Path(os.environ.get('RESEARCH_STATE_DIR', '.research-state'))
    root.mkdir(parents=True, exist_ok=True)
    (root / 'portfolio-profit-engine-v14.json').write_text(json.dumps(out, indent=2, sort_keys=True), encoding='utf-8')
    with (root / 'portfolio-profit-engine-v14-trades.jsonl').open('w', encoding='utf-8') as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True) + '\n')
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
