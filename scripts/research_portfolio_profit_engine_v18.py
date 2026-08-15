"""Portfolio Profit Engine V18 — 100% gross Top-2 breadth rotation.

V15 has strong PF but large pair-specific dispersion in the weak Validation
window. V18 tests structural diversification, not leverage: whenever the frozen
V15 six-asset LONG breadth regime is active, total portfolio gross exposure is
split equally across the top two eligible momentum leaders (or 100% into the
single eligible leader). At every globally anchored 84H decision the basket is
rebalanced from scratch. CASH otherwise.

No V15 breadth/ranking threshold changes, no per-symbol parameters, no grid,
no Fresh OOS. Portfolio gross exposure is exactly <=100%, leverage 1.0x.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import research_pairwise_clean_sheet_3y as base
import research_portfolio_profit_engine_v8 as v8
import research_portfolio_profit_engine_v11 as v11
import research_portfolio_profit_engine_v14 as v14
import research_portfolio_profit_engine_v15 as v15

HOUR = base.HOUR
DECISION_HOURS = v11.REBALANCE_BARS * v11.BAR_HOURS
DECISION_MS = DECISION_HOURS * HOUR
MAX_NAMES = 2


def _decision_times(features, start: int, end: int) -> list[int]:
    return [ts for ts in sorted(features['BTC']) if start <= ts < end and (ts - base.START_2023) % DECISION_MS == 0]


def _execution_ts(candles, index, symbol: str, signal_ts: int, delay_bars: int, end: int) -> int | None:
    i = index[symbol].get(signal_ts)
    if i is None:
        return None
    ei = i + 1 + delay_bars
    if ei >= len(candles[symbol]):
        return None
    ts = int(candles[symbol][ei]['ts'])
    return ts if ts < end else None


def _basket(ts: int, features) -> list[dict[str, Any]]:
    if v15._long_only_regime(ts, features) <= 0:
        return []
    ranked = v14._universe_rank(ts, 1, features)
    return ranked[:MAX_NAMES]


def simulate(candles, index, features, start: int, end: int, cost_bps: float, delay_bars: int):
    decisions = _decision_times(features, start, end)
    cycles: list[dict[str, Any]] = []
    symbol_contrib = {s: 0.0 for s in v14.UNIVERSE}
    equity = 1.0
    peak = 1.0
    max_dd = 0.0

    for n, signal_ts in enumerate(decisions):
        basket = _basket(signal_ts, features)
        if not basket:
            continue
        symbols = [str(x['symbol']) for x in basket]
        weights = {s: 1.0 / len(symbols) for s in symbols}
        entry_ts_by = {s: _execution_ts(candles, index, s, signal_ts, delay_bars, end) for s in symbols}
        if any(ts is None for ts in entry_ts_by.values()):
            continue
        # Exit is the next globally anchored decision execution. This tests a
        # fixed ownership cycle and never peeks at the next decision's ranking.
        if n + 1 < len(decisions):
            next_signal = decisions[n + 1]
            exit_ts_by = {s: _execution_ts(candles, index, s, next_signal, delay_bars, end) for s in symbols}
        else:
            next_signal = None
            exit_ts_by = {s: None for s in symbols}
        gross_weighted = 0.0
        legs = []
        for s in symbols:
            entry_ts = int(entry_ts_by[s])
            ei = index[s][entry_ts]
            entry = float(candles[s][ei]['open'])
            exit_ts = exit_ts_by[s]
            if exit_ts is None:
                exit_ts = max(int(r['ts']) for r in candles[s] if entry_ts <= int(r['ts']) < end)
                xi = index[s][exit_ts]
                exit_price = float(candles[s][xi]['close'])
            else:
                exit_ts = int(exit_ts)
                xi = index[s][exit_ts]
                exit_price = float(candles[s][xi]['open'])
            gross = (exit_price / entry - 1.0) * 100.0
            weighted = weights[s] * gross
            gross_weighted += weighted
            symbol_contrib[s] += weighted
            legs.append({'symbol':s,'weight':weights[s],'entryTs':entry_ts,'exitTs':exit_ts,'entryPrice':entry,'exitPrice':exit_price,'grossReturnPct':gross,'weightedGrossPctPoints':weighted})
        # cost_bps is declared as full portfolio round-trip cost. Since weights
        # sum to 1, no cost multiplication occurs for a two-name basket.
        net = gross_weighted - cost_bps / 100.0
        before = equity
        equity *= max(0.000001, 1.0 + net / 100.0)
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
        cycle_exit = max(int(x['exitTs']) for x in legs)
        cycles.append({
            'symbol':'PORTFOLIO_TOP2','side':'LONG','sideSign':1,'entryTs':min(int(x['entryTs']) for x in legs),'exitTs':cycle_exit,
            'entryPrice':1.0,'exitPrice':1.0+gross_weighted/100.0,'grossReturnPct':gross_weighted,'netReturnPct':net,
            'entryScore':sum(float(x['score']) for x in basket)/len(basket),'exitReason':'FIXED_84H_REBALANCE' if next_signal is not None else 'PERIOD_END',
            'holdingHours':int((cycle_exit-min(int(x['entryTs']) for x in legs))//HOUR),'equityBefore':before,'equityAfter':equity,
            'grossExposurePct':100.0,'leverageMultiplier':1.0,'legs':legs,
        })

    metric=v8._metric(cycles,start,end,max_dd)
    metric['symbolContributionPctPoints']=symbol_contrib
    metric['maxConcurrentNames']=MAX_NAMES
    metric['grossExposureCapPct']=100.0
    metric['rebalanceHours']=DECISION_HOURS
    return metric,cycles


def main():
    candles,index,_=base.v109.b.base.load(); features=v11._sampled_features(candles)
    annual={}; annual_stress={}
    for label in ('development','validation','evaluation'):
        a,b=base.PERIODS[label]; annual[label],_=simulate(candles,index,features,a,b,v8.NORMAL_BPS,0); annual_stress[label],_=simulate(candles,index,features,a,b,v8.STRESS_BPS,v8.STRESS_DELAY)
    a,b=base.PERIODS['combined']; combined,records=simulate(candles,index,features,a,b,v8.NORMAL_BPS,0); stress,_=simulate(candles,index,features,a,b,v8.STRESS_BPS,v8.STRESS_DELAY)
    gate=v8._historical_gate(combined,stress,annual)
    out={'researchLine':'PORTFOLIO_PROFIT_ENGINE_V18_TOP2_100_GROSS','researchOnly':True,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'liveEligible':False,'freshOosRead':False,'freshOosConsumed':False,'freshOosPermission':bool(gate['historicalCandidatePass']),'target':{'main3YCagrPct':100.0,'progressFloorCagrPct':80.0,'grossExposureCapPct':100.0,'leverageMultiplier':1.0},'architecture':'Frozen V15 six-asset LONG breadth -> top2 equal-weight leaders -> fixed 84H full basket rebalance','diagnosisBasis':{'source':'V15 pair-dispersion and Validation drawdown','finding':'test diversification of rank risk without increasing gross exposure','v15BreadthRulesChanged':False,'v15RankingRulesChanged':False},'antiOverfit':{'parameterGrid':False,'perSymbolParameters':False,'sameRunRetuning':False,'validationUsedForSelection':False,'evaluationUsedForSelection':False,'freshOosUsedForTuning':False,'leverageUsedToReachTarget':False,'maxConcurrentNames':MAX_NAMES},'schedule':{'decisionHours':DECISION_HOURS,'globalAnchorTs':base.START_2023,'basketRebalancedEveryDecision':True},'costs':{'normalTotalBpsPerPortfolioRoundTrip':v8.NORMAL_BPS,'stressTotalBpsPerPortfolioRoundTrip':v8.STRESS_BPS,'stressExtraDelayBars':v8.STRESS_DELAY},'periods':base.PERIODS,'annual':annual,'annualStress':annual_stress,'combined3Y':combined,'combined3YStress':stress,'historicalGate':gate}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'portfolio-profit-engine-v18.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8')
    with (root/'portfolio-profit-engine-v18-trades.jsonl').open('w',encoding='utf-8') as fh:
        for r in records: fh.write(json.dumps(r,sort_keys=True)+'\n')
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=='__main__': main()
