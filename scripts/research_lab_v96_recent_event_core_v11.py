from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_v96_recent_event_core_v6 as v6
import research_lab_v96_recent_event_core_v10 as v10

UTC = dt.timezone.utc
START_MS, END_MS = v6.START_MS, v6.END_MS
F1_MS, F2_MS, F3_MS = v6.F1_MS, v6.F2_MS, v6.F3_MS
BAR_HOURS, BAR_MS, DAY_MS, GROSS = v6.BAR_HOURS, v6.BAR_MS, v6.DAY_MS, v6.GROSS
SYMBOLS = v6.SYMBOLS
BENCHMARK = 101.998210
A_CFG = v6.Config('A4H_EXACT','SHORT_PULLBACK',10,5.0,8,1.0,0.0,84)


@dataclass(frozen=True)
class MetaConfig:
    config_id: str
    recent_trades: int
    metric: str
    min_score_pct: float
    loss_streak_penalty_pct: float
    robust_bonus_b_pct: float
    robust_bonus_c_pct: float
    fallback: str


@dataclass
class Position:
    strategy: str
    symbol: str
    side: int
    entry_ts: int
    bars_held: int
    max_bars: int


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return fallback
    return x if math.isfinite(x) else fallback


def compound(values: Iterable[float]) -> float:
    eq = 1.0
    for value in values:
        eq *= max(0.001, 1.0 + float(value))
    return eq - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    wins = sum(v for v in values if v > 0)
    losses = -sum(v for v in values if v < 0)
    return wins / losses if losses > 1e-15 else (999.0 if wins > 0 else None)


def rounded(value: Any):
    if isinstance(value, float): return round(value, 6)
    if isinstance(value, dict): return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list): return [rounded(v) for v in value]
    return value


def configs() -> List[MetaConfig]:
    result = []
    for n, metric, minimum, penalty, bonus_b, bonus_c, fallback in itertools.product(
        (3, 5, 8, 12),
        ('MEAN', 'EWMA', 'PF_MEAN'),
        (-0.5, 0.0, 0.5, 1.0),
        (0.0, 0.5, 1.0, 2.0),
        (0.0, 0.25, 0.5),
        (0.0, 0.25, 0.5),
        ('A4H', 'B12H', 'BEST_SIGNAL', 'CASH'),
    ):
        # Deterministic bounded sampling; keep all short-window variants and a quarter of longer ones.
        signature = n * 7 + len(metric) * 11 + int((minimum + 1) * 10) * 13 + int(penalty * 10) * 17 + int(bonus_b * 100) + int(bonus_c * 100) * 3 + len(fallback) * 19
        if n >= 8 and signature % 3 != 0:
            continue
        result.append(MetaConfig(
            f'V11_N{n}_{metric}_MIN{minimum:g}_LP{penalty:g}_B{bonus_b:g}_C{bonus_c:g}_{fallback}',
            n, metric, minimum, penalty, bonus_b, bonus_c, fallback,
        ))
    return result


def build_a_opportunities(market: dict) -> List[v10.Opportunity]:
    result = []
    for ts in market['times']:
        if not (START_MS <= ts < END_MS - BAR_MS):
            continue
        item = v6.short_signal(A_CFG, ts, market, False)
        if item is None:
            continue
        symbol, side, meta = item
        result.append(v10.Opportunity('A4H', ts, ts + BAR_MS, symbol, side, 84, meta))
    return result


def build_c_opportunities(market: dict) -> List[v10.Opportunity]:
    # Same base event as A, but volume>=1.0 is applied before symbol ranking.
    result = []
    lookback = int(10 * 24 / BAR_HOURS)
    bounce_bars = int(8 / BAR_HOURS)
    sma_bars = int(20 * 24 / BAR_HOURS)
    for ts in market['times']:
        if not (START_MS <= ts < END_MS - BAR_MS):
            continue
        candidates = []
        bidx = market['indexes']['BTC'].get(ts)
        if bidx is None:
            continue
        btc_rows = market['bars']['BTC']
        btc_move = v6.mom(btc_rows, bidx, lookback)
        if btc_move is None:
            continue
        for symbol in SYMBOLS:
            idx = market['indexes'][symbol].get(ts)
            if idx is None:
                continue
            rows = market['bars'][symbol]
            move = v6.mom(rows, idx, lookback)
            bounce = v6.mom(rows, idx, bounce_bars)
            avg = v6.sma(rows, idx, sma_bars)
            vol = v6.volratio(rows, idx)
            if None in (move, bounce, avg, vol):
                continue
            close = float(rows[idx]['close'])
            if move <= -5.0 and bounce >= 1.0 and close < avg and vol >= 1.0:
                relative = move - btc_move
                score = -move + 0.20 * bounce
                candidates.append((score, symbol, {'movePct': move, 'bouncePct': bounce, 'relativePct': relative, 'volumeRatio': vol, 'signalScore': score}))
        if candidates:
            score, symbol, meta = max(candidates, key=lambda x: (x[0], x[1]))
            result.append(v10.Opportunity('C4H_VOL', ts, ts + BAR_MS, symbol, -1, 84, meta))
    return result


def open_price(market: dict, symbol: str, ts: int) -> Optional[float]:
    idx = market['indexes'][symbol].get(ts)
    if idx is None:
        return None
    return float(market['bars'][symbol][idx]['open'])


def build_trade_ledger(opportunities: Sequence[v10.Opportunity], market: dict, normal_cost_bps: float = 10.0) -> List[dict]:
    by_entry: Dict[int, List[v10.Opportunity]] = {}
    for opp in opportunities:
        by_entry.setdefault(opp.entry_ts, []).append(opp)
    next_free = START_MS
    ledger = []
    for entry_ts in sorted(by_entry):
        if entry_ts < next_free:
            continue
        opp = max(by_entry[entry_ts], key=lambda x: (finite(x.meta.get('signalScore', x.meta.get('score', 0.0))), x.symbol))
        exit_ts = entry_ts + opp.hold_hours * v6.HOUR
        if exit_ts >= END_MS:
            continue
        entry_price = open_price(market, opp.symbol, entry_ts)
        exit_price = open_price(market, opp.symbol, exit_ts)
        if entry_price is None or exit_price is None or entry_price <= 0:
            continue
        raw = opp.side * GROSS * (exit_price / entry_price - 1.0)
        funding = 0.0
        ts = entry_ts
        while ts < exit_ts:
            funding += -opp.side * GROSS * market['funding'][opp.symbol].get(ts, 0.0)
            ts += BAR_MS
        roundtrip_cost = (2.0 * GROSS * normal_cost_bps / 10_000.0)
        net = raw + funding - roundtrip_cost
        ledger.append({
            'strategy': opp.strategy, 'entryTs': entry_ts, 'exitTs': exit_ts,
            'symbol': opp.symbol, 'side': opp.side, 'return': net,
            'returnPct': net * 100.0, **opp.meta,
        })
        next_free = exit_ts
    return ledger


def recent_completed(ledger: Sequence[dict], ts: int, n: int) -> List[dict]:
    completed = [row for row in ledger if int(row['exitTs']) <= ts]
    return completed[-n:]


def consecutive_losses(rows: Sequence[dict]) -> int:
    count = 0
    for row in reversed(rows):
        if finite(row['return']) < 0:
            count += 1
        else:
            break
    return count


def trade_score(cfg: MetaConfig, strategy: str, ledger: Sequence[dict], ts: int) -> Optional[dict]:
    rows = recent_completed(ledger, ts, cfg.recent_trades)
    if len(rows) < min(2, cfg.recent_trades):
        return None
    values = [finite(row['return']) for row in rows]
    mean_pct = sum(values) / len(values) * 100.0
    wins = sum(value > 0 for value in values)
    pf = profit_factor(values) or 0.0
    if cfg.metric == 'MEAN':
        score = mean_pct
    elif cfg.metric == 'EWMA':
        weights = list(range(1, len(values) + 1))
        score = sum(value * weight for value, weight in zip(values, weights)) / sum(weights) * 100.0
    else:
        score = mean_pct + max(-2.0, min(4.0, pf - 1.0)) * 0.5 + (wins / len(values) - 0.5) * 1.0
    streak = consecutive_losses(rows)
    score -= streak * cfg.loss_streak_penalty_pct
    if strategy == 'B12H':
        score += cfg.robust_bonus_b_pct
    elif strategy == 'C4H_VOL':
        score += cfg.robust_bonus_c_pct
    return {
        'score': score, 'meanPct': mean_pct, 'profitFactor': pf,
        'winRate': wins / len(values), 'lossStreak': streak, 'sample': len(values),
    }


def simulate_meta(cfg: MetaConfig, market: dict, opportunities: Dict[str, Sequence[v10.Opportunity]], ledgers: Dict[str, Sequence[dict]], severe: bool = False):
    by_entry: Dict[str, Dict[int, List[v10.Opportunity]]] = {}
    for strategy, opps in opportunities.items():
        mapping: Dict[int, List[v10.Opportunity]] = {}
        for opp in opps:
            mapping.setdefault(opp.entry_ts, []).append(opp)
        by_entry[strategy] = mapping

    times = [ts for ts in market['times'] if START_MS <= ts < END_MS]
    position: Optional[Position] = None
    rows = []
    entries = []
    previous: Dict[str, float] = {}
    cost = 50.0 if severe else 10.0
    adverse = 3.0 if severe else 0.0

    for ts in times:
        if position is None:
            candidates = []
            score_snapshot = {}
            for strategy in ('A4H', 'B12H', 'C4H_VOL'):
                score_snapshot[strategy] = trade_score(cfg, strategy, ledgers[strategy], ts)
                choices = by_entry[strategy].get(ts, [])
                if not choices:
                    continue
                stat = score_snapshot[strategy]
                if stat is None:
                    continue
                if stat['score'] >= cfg.min_score_pct:
                    opp = max(choices, key=lambda x: (finite(x.meta.get('signalScore', x.meta.get('score', 0.0))), x.symbol))
                    candidates.append((stat['score'], strategy, opp, stat))

            if not candidates and cfg.fallback != 'CASH':
                fallback_strategies = ('A4H', 'B12H', 'C4H_VOL') if cfg.fallback == 'BEST_SIGNAL' else (cfg.fallback,)
                for strategy in fallback_strategies:
                    choices = by_entry[strategy].get(ts, [])
                    if not choices:
                        continue
                    opp = max(choices, key=lambda x: (finite(x.meta.get('signalScore', x.meta.get('score', 0.0))), x.symbol))
                    stat = score_snapshot.get(strategy)
                    fallback_score = stat['score'] if stat is not None else -999.0
                    candidates.append((fallback_score, strategy, opp, stat or {'score': fallback_score, 'sample': 0}))

            if candidates:
                best_score, strategy, opp, stat = max(candidates, key=lambda x: (x[0], x[1]))
                position = Position(strategy, opp.symbol, opp.side, ts, 0, max(1, opp.hold_hours // BAR_HOURS))
                entries.append({
                    'entryTs': ts, 'strategy': strategy, 'symbol': opp.symbol,
                    'routerScore': best_score, 'tradeStats': stat, **opp.meta,
                })

        weights: Dict[str, float] = {}
        value = 0.0
        if position is not None:
            weights[position.symbol] = position.side * GROSS
            idx = market['indexes'][position.symbol].get(ts)
            if idx is not None:
                bar = market['bars'][position.symbol][idx]
                value += position.side * GROSS * (float(bar['close']) / float(bar['open']) - 1.0)
                value -= position.side * GROSS * market['funding'][position.symbol].get(ts, 0.0)
                if severe:
                    value -= GROSS * adverse / 10_000.0
        turnover = sum(abs(weights.get(s, 0.0) - previous.get(s, 0.0)) for s in set(weights) | set(previous))
        value -= turnover * cost / 10_000.0
        gross = sum(abs(v) for v in weights.values())
        rows.append({'ts': ts, 'return': value, 'gross': gross, 'maxGross': gross, 'regime': -1 if weights else 0})
        previous = dict(weights)

        if position is not None:
            position.bars_held += 1
            if position.bars_held >= position.max_bars:
                position = None
    return rows, entries


def metrics(rows: Sequence[dict], entries: Sequence[dict], start: int, end: int) -> dict:
    return v10.metrics(rows, entries, start, end)


def evaluate(cfg: MetaConfig, market: dict, opportunities: Dict[str, Sequence[v10.Opportunity]], ledgers: Dict[str, Sequence[dict]]):
    # Normal and Severe use identical trade-score routing; Severe only changes execution costs.
    normal, entries = simulate_meta(cfg, market, opportunities, ledgers, False)
    severe, severe_entries = simulate_meta(cfg, market, opportunities, ledgers, True)
    ranges = {'fold1':(START_MS,F1_MS),'fold2':(F1_MS,F2_MS),'fold3':(F2_MS,F3_MS),'lateEvaluation':(F3_MS,END_MS),'full':(START_MS,END_MS)}
    out = {'variantId': cfg.config_id, 'config': asdict(cfg)}
    for name, (a,b) in ranges.items():
        out[name] = {'normal':metrics(normal,entries,a,b),'severe':metrics(severe,severe_entries,a,b)}
    ns=[out[x]['normal'] for x in ('fold1','fold2','fold3')]; ss=[out[x]['severe'] for x in ('fold1','fold2','fold3')]
    pre=compound([finite(x['compoundedReturnPct'])/100 for x in ns])*100; pre_s=compound([finite(x['compoundedReturnPct'])/100 for x in ss])*100
    pn=sum(finite(x['compoundedReturnPct'])>0 for x in ns); ps=sum(finite(x['compoundedReturnPct'])>0 for x in ss); trades=sum(int(x['tradeEpisodes']) for x in ns); worst=min(finite(x['maxDrawdownPct'],-99) for x in ns); avg_pf=sum(min(5.0,finite(x.get('profitFactor'))) for x in ns)/3
    eligible=bool(trades>=10 and pn==3 and ps>=2 and pre>=45 and pre_s>=15 and worst>=-15 and avg_pf>=1.12)
    score=pre+0.7*pre_s+5*(pn+ps)+5*max(0,avg_pf-1)-0.2*abs(worst) if eligible else -1e12
    out['preSelection']={'eligible':eligible,'score':score,'compoundedReturnPct':pre,'severeCompoundedReturnPct':pre_s,'positiveFolds':pn,'positiveSevereFolds':ps,'tradeEpisodes':trades,'worstFoldDrawdownPct':worst,'averageFoldProfitFactor':avg_pf}
    return out, normal, severe, entries


def compact(row: dict) -> dict:
    return {k: row[k] for k in ('variantId','config','preSelection','fold1','fold2','fold3','lateEvaluation','full')}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--output-dir',default='.research-state/v96-v11'); args=parser.parse_args(); output=Path(args.output_dir); output.mkdir(parents=True,exist_ok=True)
    market=v6.load_market()
    opp_a=build_a_opportunities(market); opp_b=v10.build_b_opportunities(market); opp_c=build_c_opportunities(market)
    opportunities={'A4H':opp_a,'B12H':opp_b,'C4H_VOL':opp_c}
    ledgers={strategy:build_trade_ledger(opps,market) for strategy,opps in opportunities.items()}
    results=[];replays={};entry_ledgers={}
    for cfg in configs():
        row,n,s,e=evaluate(cfg,market,opportunities,ledgers);results.append(row);replays[row['variantId']]=(n,s);entry_ledgers[row['variantId']]=e
    eligible=sorted((r for r in results if r['preSelection']['eligible']),key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True); ranked=sorted(results,key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True); selected=eligible[0] if eligible else ranked[0]; normal,severe=replays[selected['variantId']]
    full=selected['full']['normal'];full_s=selected['full']['severe'];late=selected['lateEvaluation']['normal'];late_s=selected['lateEvaluation']['severe']
    late_pass=bool(int(late['tradeEpisodes'])>=2 and finite(late['compoundedReturnPct'])>0 and finite(late_s['compoundedReturnPct'])>0 and finite(late['maxDrawdownPct'],-99)>=-12 and finite(late.get('profitFactor'))>1.05)
    beats=bool(finite(full['compoundedReturnPct'])>BENCHMARK and finite(full_s['compoundedReturnPct'])>25 and finite(full['maxDrawdownPct'],-99)>=-15 and finite(full.get('profitFactor'))>1.22)
    status='V96_RECENT_EVENT_CORE_V11_PASS' if selected['preSelection']['eligible'] and late_pass and beats else 'V96_RECENT_EVENT_CORE_V11_DIAGNOSTIC'; topfull=sorted(results,key=lambda r:finite(r['full']['normal']['compoundedReturnPct'],-1e12),reverse=True)
    template_summary={strategy:{'opportunities':len(opportunities[strategy]),'shadowTrades':len(ledgers[strategy]),'fullTradeCompoundPct':compound([row['return'] for row in ledgers[strategy]])*100,'lateTradeCompoundPct':compound([row['return'] for row in ledgers[strategy] if row['entryTs']>=F3_MS])*100} for strategy in opportunities}
    payload=rounded({'version':11,'strategyId':'V96_RECENT_EVENT_CORE_V11_COMPLETED_TRADE_META_ROUTER','status':status,'architecture':{'gross':GROSS,'templates':['A4H high-return','B12H robust','C4H volume-confirmed'],'router':'last N completed shadow trades only','metrics':['MEAN','EWMA','PF_MEAN'],'cashAllowed':True,'sameRoutingNormalSevere':True},'benchmark':{'A4HDiagnosticPct':BENCHMARK},'templateSummary':template_summary,'candidateCounts':{'tested':len(results),'eligible':len(eligible)},'selected':compact(selected),'selectedEntryLedger':entry_ledgers[selected['variantId']],'selectedPassesLateEvaluation':late_pass,'selectedBeats101p998':beats,'topPreSelection':[compact(r) for r in ranked[:25]],'topFullDiagnosticOnly':[compact(r) for r in topfull[:25]],'selectionPolicy':{'rankingUsesOnlyFirstThreeFolds':True,'lateEvaluationUsedForRanking':False,'fullPeriodUsedForRanking':False,'routerUsesOnlyCompletedTradesExitedBeforeDecision':True},'selectedReplay':{'strategyId':'V96_RECENT_EVENT_CORE_V11_COMPLETED_TRADE_META_ROUTER','variantId':selected['variantId'],'normal':normal,'severe':severe},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}); (output/'v96-recent-event-core-v11.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n'); print(json.dumps({'status':status,'templates':template_summary,'counts':payload['candidateCounts'],'selected':selected['variantId'],'pre':selected['preSelection'],'full':selected['full'],'late':selected['lateEvaluation'],'beats':beats,'latePass':late_pass,'bestFullDiagnostic':compact(topfull[0])},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
