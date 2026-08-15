"""Portfolio Profit Engine V16 — derivatives-supported long rotation.

V15 established a strong but insufficient long-only price rotation base. Frozen
V7 established that pair-specific derivatives event mechanisms do not persist
through V/E. V16 therefore uses Binance USD-M metrics only as a *market-level
capital permission layer* around the unchanged V14/V15 long rotation engine.

Anti-overfit protocol:
- exactly three causal market-state families are predeclared below;
- Development only selects at most one family by PF-without-best, subject to a
  minimum sample / positive return / PF gate;
- Validation and Evaluation never select or tune the family or constants;
- no threshold grid, no per-symbol constants, no Fresh OOS;
- one position max, <=100% gross exposure, leverage 1.0x.

The three families test distinct hypotheses, not threshold variants:
1. EXPANSION_FLOW: broad OI expansion and taker-buy support;
2. FLOW_WITHOUT_DELEVERAGING: positive taker flow while market OI is not in a
   material contraction state;
3. INFORMED_DIVERGENCE: top-trader positioning is stronger than global crowd,
   supported by taker flow and non-contracting OI.
"""
from __future__ import annotations

import json
import os
import statistics
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8
import research_portfolio_profit_engine_v11 as v11
import research_portfolio_profit_engine_v12 as v12
import research_portfolio_profit_engine_v14 as v14
import research_metrics_mechanism_router_v7 as v7
import research_metrics_mechanism_router_v7_runner as v7runner

FAMILIES = (
    'EXPANSION_FLOW',
    'FLOW_WITHOUT_DELEVERAGING',
    'INFORMED_DIVERGENCE',
)
DEV_MIN_TRADES = 8
DEV_MIN_PF = 1.25
DEV_MIN_PF_WO = 1.10


def load_market_metric_features() -> dict[str, dict[int, dict[str, float]]]:
    raw, _ = v7runner.corrected_load_metrics()
    return {pair: v7.build_metric_features(pair, raw[pair]) for pair in v7.PAIRS}


def _snapshot(ts: int, metric_features: dict[str, dict[int, dict[str, float]]]) -> dict[str, Any] | None:
    rows = [metric_features[p].get(ts) for p in v7.PAIRS]
    if any(x is None for x in rows):
        return None
    xs = [x for x in rows if x is not None]
    oi = [float(x['oi6Z']) for x in xs]
    taker = [float(x['takerZ']) for x in xs]
    div = [float(x['divergenceZ']) for x in xs]
    crowd = [float(x['crowdZ']) for x in xs]
    return {
        'medianOi6Z': statistics.median(oi),
        'medianTakerZ': statistics.median(taker),
        'medianDivergenceZ': statistics.median(div),
        'medianCrowdZ': statistics.median(crowd),
        'positiveOiCount': sum(v > 0 for v in oi),
        'positiveTakerCount': sum(v > 0 for v in taker),
        'positiveDivergenceCount': sum(v > 0 for v in div),
        'pairCount': len(xs),
    }


def market_permission(family: str, ts: int, metric_features: dict[str, dict[int, dict[str, float]]]) -> bool:
    x = _snapshot(ts, metric_features)
    if x is None:
        return False
    if family == 'EXPANSION_FLOW':
        return bool(
            x['medianOi6Z'] >= 0.0
            and x['medianTakerZ'] >= 0.0
            and x['positiveOiCount'] >= 2
            and x['positiveTakerCount'] >= 2
        )
    if family == 'FLOW_WITHOUT_DELEVERAGING':
        return bool(
            x['medianTakerZ'] >= 0.25
            and x['medianOi6Z'] >= -0.50
            and x['positiveTakerCount'] >= 2
        )
    if family == 'INFORMED_DIVERGENCE':
        return bool(
            x['medianDivergenceZ'] >= 0.25
            and x['medianTakerZ'] >= 0.0
            and x['medianOi6Z'] >= -0.25
            and x['positiveDivergenceCount'] >= 2
        )
    raise RuntimeError(f'UNKNOWN_V16_FAMILY:{family}')


def simulate(
    family: str,
    candles,
    index,
    price_features,
    metric_features,
    start: int,
    end: int,
    cost_bps: float,
    delay_bars: int,
):
    old_regime = v11._btc_regime
    old_rank = v11._rank

    def derivatives_supported_long(ts: int, features) -> int:
        # V14 price breadth LONG rules remain byte-for-byte external/frozen.
        price_side = v14._breadth_regime(ts, features)
        if price_side <= 0:
            return 0
        return 1 if market_permission(family, ts, metric_features) else 0

    v11._btc_regime = derivatives_supported_long
    v11._rank = v14._universe_rank
    try:
        metric, records = v12.simulate(candles, index, price_features, start, end, cost_bps, delay_bars)
    finally:
        v11._btc_regime = old_regime
        v11._rank = old_rank
    metric['symbolContributionPctPoints']['BTC'] = sum(float(r['netReturnPct']) for r in records if r['symbol'] == 'BTC')
    return metric, records


def development_select(candles, index, price_features, metric_features) -> tuple[str | None, dict[str, Any]]:
    start, end = base.PERIODS['development']
    diagnostics: dict[str, Any] = {}
    eligible: list[tuple[float, float, int, str]] = []
    for family in FAMILIES:
        metric, _ = simulate(family, candles, index, price_features, metric_features, start, end, v8.NORMAL_BPS, 0)
        qualifies = bool(
            metric['trades'] >= DEV_MIN_TRADES
            and metric['returnPct'] > 0
            and (metric['pf'] or 0) >= DEV_MIN_PF
            and (metric['pfWithoutBest'] or 0) >= DEV_MIN_PF_WO
        )
        diagnostics[family] = {'metric': metric, 'eligible': qualifies}
        if qualifies:
            eligible.append((float(metric['pfWithoutBest'] or 0), float(metric['pf'] or 0), int(metric['trades']), family))
    selected = sorted(eligible, key=lambda row: (-row[0], -row[1], -row[2], row[3]))[0][3] if eligible else None
    return selected, diagnostics


def main() -> None:
    candles, index, _ = base.v109.b.base.load()
    price_features = v11._sampled_features(candles)
    metric_features = load_market_metric_features()
    selected, development_diagnostics = development_select(candles, index, price_features, metric_features)

    annual: dict[str, dict[str, Any]] = {}
    annual_stress: dict[str, dict[str, Any]] = {}
    combined = None
    stress = None
    records: list[dict[str, Any]] = []
    if selected is not None:
        for label in ('development', 'validation', 'evaluation'):
            start, end = base.PERIODS[label]
            annual[label], _ = simulate(selected, candles, index, price_features, metric_features, start, end, v8.NORMAL_BPS, 0)
            annual_stress[label], _ = simulate(selected, candles, index, price_features, metric_features, start, end, v8.STRESS_BPS, v8.STRESS_DELAY)
        start, end = base.PERIODS['combined']
        combined, records = simulate(selected, candles, index, price_features, metric_features, start, end, v8.NORMAL_BPS, 0)
        stress, _ = simulate(selected, candles, index, price_features, metric_features, start, end, v8.STRESS_BPS, v8.STRESS_DELAY)
        gate = v8._historical_gate(combined, stress, annual)
    else:
        gate = {'performanceBand': 'NO_DEVELOPMENT_FAMILY', 'checks': {}, 'historicalCandidatePass': False}

    out = {
        'researchLine': 'PORTFOLIO_PROFIT_ENGINE_V16_DERIVATIVES_SUPPORTED_LONG_ROTATION',
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
        'architecture': 'V14/V15 six-asset price breadth LONG -> aggregate USD-M derivatives capital permission -> V12 fixed 84H ownership',
        'selectionPeriod': 'development_only_2023_07_to_2024_07',
        'marketStateFamilies': list(FAMILIES),
        'selectedMarketStateFamily': selected,
        'developmentDiagnostics': development_diagnostics,
        'diagnosisBasis': {
            'v15Finding': 'long-only rotation has strong PF but insufficient CAGR and weak 2024-25 return',
            'v7Finding': 'pair-specific derivatives mechanisms are unstable across V/E; derivatives repurposed as aggregate market permission rather than entry events',
            'v15PriceLongRulesChanged': False,
            'v15OwnershipCadenceChanged': False,
            'pairSpecificMetricsParameters': False,
        },
        'antiOverfit': {
            'parameterGrid': False,
            'familyCount': len(FAMILIES),
            'familySelectionUsesDevelopmentOnly': True,
            'validationUsedForSelection': False,
            'evaluationUsedForSelection': False,
            'sameRunRetuning': False,
            'freshOosUsedForTuning': False,
            'leverageUsedToReachTarget': False,
            'onePositionMaximum': True,
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
    (root / 'portfolio-profit-engine-v16.json').write_text(json.dumps(out, indent=2, sort_keys=True), encoding='utf-8')
    with (root / 'portfolio-profit-engine-v16-trades.jsonl').open('w', encoding='utf-8') as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True) + '\n')
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
