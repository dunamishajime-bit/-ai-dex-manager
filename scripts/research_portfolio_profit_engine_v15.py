"""Portfolio Profit Engine V15 — long-only six-asset breadth rotation.

V14's Development evidence did not support the SHORT sleeve (negative short
contribution while LONG was strongly positive). V15 removes that unsupported
sleeve rather than adding filters to rescue it. The six-asset breadth regime,
ranking, 84H ownership mechanics, costs, and exposure cap remain unchanged.

This is iterative historical research; Fresh OOS remains sealed and unused.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8
import research_portfolio_profit_engine_v11 as v11
import research_portfolio_profit_engine_v14 as v14


def _long_only_regime(ts: int, features: dict[str, dict[int, dict[str, float]]]) -> int:
    side = v14._breadth_regime(ts, features)
    return 1 if side > 0 else 0


def simulate(candles, index, features, start: int, end: int, cost_bps: float, delay_bars: int):
    old = v14._breadth_regime
    v14._breadth_regime = _long_only_regime
    try:
        return v14.simulate(candles, index, features, start, end, cost_bps, delay_bars)
    finally:
        v14._breadth_regime = old


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
        'researchLine': 'PORTFOLIO_PROFIT_ENGINE_V15_LONG_ONLY_BREADTH_ROTATION',
        'researchOnly': True, 'productionChanged': False, 'vpsChanged': False, 'liveChanged': False,
        'realTradingEnabled': False, 'liveEligible': False, 'freshOosRead': False, 'freshOosConsumed': False,
        'freshOosPermission': bool(gate['historicalCandidatePass']),
        'target': {'main3YCagrPct': 100.0, 'progressFloorCagrPct': 80.0, 'grossExposureCapPct': 100.0, 'leverageMultiplier': 1.0},
        'architecture': 'V14 six-asset consensus breadth LONG sleeve only -> V12 84H ownership',
        'diagnosisBasis': {
            'source': 'V14 Development sleeve decomposition',
            'finding': 'Development SHORT contribution negative while LONG contribution positive; unsupported short sleeve removed rather than threshold-rescued',
            'v14LongRulesChanged': False,
            'v14RankingChanged': False,
            'v14OwnershipChanged': False,
        },
        'antiOverfit': {
            'parameterGrid': False, 'perSymbolParameters': False, 'sameRunRetuning': False,
            'freshOosUsedForTuning': False, 'leverageUsedToReachTarget': False, 'onePositionMaximum': True,
            'shortSleeveEnabled': False,
        },
        'universe': list(v14.UNIVERSE),
        'schedule': {'decisionHours': v11.REBALANCE_BARS * v11.BAR_HOURS, 'globalAnchorTs': base.START_2023, 'intraCycleExit': False, 'keepRank': v11.KEEP_RANK},
        'costs': {'normalTotalBpsPerRoundTrip': v8.NORMAL_BPS, 'stressTotalBpsPerRoundTrip': v8.STRESS_BPS, 'stressExtraDelayBars': v8.STRESS_DELAY},
        'periods': base.PERIODS, 'annual': annual, 'annualStress': annual_stress,
        'combined3Y': combined, 'combined3YStress': stress, 'historicalGate': gate,
    }
    root = Path(os.environ.get('RESEARCH_STATE_DIR', '.research-state'))
    root.mkdir(parents=True, exist_ok=True)
    (root / 'portfolio-profit-engine-v15.json').write_text(json.dumps(out, indent=2, sort_keys=True), encoding='utf-8')
    with (root / 'portfolio-profit-engine-v15-trades.jsonl').open('w', encoding='utf-8') as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True) + '\n')
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
