"""Portfolio Profit Engine V20 — V15 long ownership with prior-rank confirmation.

Diagnosis basis:
- V15's 2024-25 failure was concentrated in AVAX/SOL selection while LINK was
  strongly profitable.
- V15 already uses a fixed 84H ownership lifecycle; this experiment changes
  only who is allowed to receive ownership at a checkpoint.

Frozen V20 rule before seeing V/E:
- keep V15 long-only six-asset breadth regime unchanged;
- keep V15/V12 84H ownership and top-2 retention unchanged;
- at a scheduled decision, an asset is eligible only if it is currently V15
  eligible AND it was also in the V15 top-2 rank 12H earlier;
- no score threshold, symbol parameter, leverage, grid, or Fresh OOS.

This is historical research only. Production/VPS/LIVE are untouched.
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
import research_portfolio_profit_engine_v15 as v15

LOOKBACK_HOURS = 12
LOOKBACK_MS = LOOKBACK_HOURS * base.HOUR
PRIOR_KEEP_RANK = 2
V14_RANK = v14._universe_rank


def _persistent_rank(ts: int, side: int, features: dict[str, dict[int, dict[str, float]]]) -> list[dict[str, Any]]:
    current = V14_RANK(ts, side, features)
    if not current or side <= 0:
        return current
    prior = V14_RANK(ts - LOOKBACK_MS, side, features)
    prior_top = {str(row['symbol']) for row in prior[:PRIOR_KEEP_RANK]}
    return [row for row in current if str(row['symbol']) in prior_top]


def simulate(candles, index, features, start: int, end: int, cost_bps: float, delay_bars: int):
    old_rank = v14._universe_rank
    v14._universe_rank = _persistent_rank
    try:
        return v15.simulate(candles, index, features, start, end, cost_bps, delay_bars)
    finally:
        v14._universe_rank = old_rank


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
        'researchLine': 'PORTFOLIO_PROFIT_ENGINE_V20_PRIOR_RANK_CONFIRMED_OWNERSHIP',
        'researchOnly': True, 'productionChanged': False, 'vpsChanged': False, 'liveChanged': False,
        'realTradingEnabled': False, 'liveEligible': False, 'freshOosRead': False, 'freshOosConsumed': False,
        'freshOosPermission': bool(gate['historicalCandidatePass']),
        'target': {'main3YCagrPct': 100.0, 'progressFloorCagrPct': 80.0, 'grossExposureCapPct': 100.0, 'leverageMultiplier': 1.0},
        'architecture': 'Frozen V15 breadth LONG -> current rank intersect prior-12H top2 -> frozen 84H ownership',
        'diagnosisBasis': {
            'source': 'V15 annual symbol/exit decomposition',
            'finding': '2024-25 retained a strong LINK edge but transient AVAX/SOL ownership erased it; test persistence before capital handoff',
            'v15BreadthRegimeChanged': False,
            'v15ScoreFormulaChanged': False,
            'v15OwnershipLifecycleChanged': False,
        },
        'rankConfirmation': {'lookbackHours': LOOKBACK_HOURS, 'priorRankMaximum': PRIOR_KEEP_RANK},
        'antiOverfit': {
            'parameterGrid': False, 'perSymbolParameters': False, 'sameRunRetuning': False,
            'validationUsedForSelection': False, 'evaluationUsedForSelection': False,
            'freshOosUsedForTuning': False, 'leverageUsedToReachTarget': False,
            'onePositionMaximum': True, 'singleStructuralHypothesis': True,
        },
        'schedule': {'decisionHours': v11.REBALANCE_BARS * v11.BAR_HOURS, 'globalAnchorTs': base.START_2023, 'intraCycleExit': False, 'keepRank': v11.KEEP_RANK},
        'costs': {'normalTotalBpsPerRoundTrip': v8.NORMAL_BPS, 'stressTotalBpsPerRoundTrip': v8.STRESS_BPS, 'stressExtraDelayBars': v8.STRESS_DELAY},
        'periods': base.PERIODS, 'annual': annual, 'annualStress': annual_stress,
        'combined3Y': combined, 'combined3YStress': stress, 'historicalGate': gate,
    }
    root = Path(os.environ.get('RESEARCH_STATE_DIR', '.research-state'))
    root.mkdir(parents=True, exist_ok=True)
    (root / 'portfolio-profit-engine-v20.json').write_text(json.dumps(out, indent=2, sort_keys=True), encoding='utf-8')
    with (root / 'portfolio-profit-engine-v20-trades.jsonl').open('w', encoding='utf-8') as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True) + '\n')
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
