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

UTC = dt.timezone.utc
START_MS, END_MS = v6.START_MS, v6.END_MS
F1_MS, F2_MS, F3_MS = v6.F1_MS, v6.F2_MS, v6.F3_MS
HOUR, DAY_MS = v6.HOUR, v6.DAY_MS
BAR4 = 4 * HOUR
BAR12 = 12 * HOUR
GROSS = 0.75
SYMBOLS = v6.SYMBOLS
BASELINE = 101.998210


@dataclass(frozen=True)
class MetaConfig:
    config_id: str
    lookback_days: int
    min_score_pct: float
    dd_penalty: float
    robust_bonus_pct: float
    tie_margin_pct: float


@dataclass
class Opportunity:
    strategy: str
    signal_ts: int
    entry_ts: int
    symbol: str
    side: int
    hold_hours: int
    meta: dict


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
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


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
    return [
        MetaConfig(
            f"V10_LB{lb}_MIN{minimum:g}_DD{dd:g}_RB{bonus:g}_TM{tie:g}",
            lb, minimum, dd, bonus, tie,
        )
        for lb, minimum, dd, bonus, tie in itertools.product(
            (30, 45, 60, 90),
            (-2.0, 0.0, 2.0, 4.0),
            (0.0, 0.5, 1.0),
            (0.0, 1.0, 2.0),
            (0.0, 2.0, 4.0),
        )
    ]


def resample12(candles4: Sequence[dict]) -> List[dict]:
    groups: Dict[int, List[dict]] = {}
    for row in candles4:
        ts = int(row["ts"])
        bucket = ts // BAR12 * BAR12
        groups.setdefault(bucket, []).append(row)
    result = []
    for ts, rows in sorted(groups.items()):
        rows = sorted(rows, key=lambda r: int(r["ts"]))
        if len(rows) != 3:
            continue
        result.append({
            "ts": ts,
            "open": float(rows[0]["open"]),
            "high": max(float(r["high"]) for r in rows),
            "low": min(float(r["low"]) for r in rows),
            "close": float(rows[-1]["close"]),
            "volume": sum(float(r.get("volume", 0.0)) for r in rows),
        })
    return result


def mom(rows: Sequence[dict], idx: int, bars: int) -> Optional[float]:
    j = idx - bars
    if j < 0 or float(rows[j]["close"]) <= 0:
        return None
    return (float(rows[idx]["close"]) / float(rows[j]["close"]) - 1.0) * 100.0


def sma(rows: Sequence[dict], idx: int, bars: int) -> Optional[float]:
    if idx - bars + 1 < 0:
        return None
    return sum(float(r["close"]) for r in rows[idx-bars+1:idx+1]) / bars


def build_a_opportunities(market: dict) -> List[Opportunity]:
    # 4h high-return template: 10d decline >=5%, 8h rebound >=1%, below 20d SMA, hold84h.
    result = []
    lookback = 10 * 24 // 4
    bounce = 8 // 4
    sma_bars = 20 * 24 // 4
    for ts in market["times"]:
        if not (START_MS <= ts < END_MS - BAR4):
            continue
        candidates = []
        for symbol in SYMBOLS:
            idx = market["indexes"][symbol].get(ts)
            if idx is None:
                continue
            rows = market["bars"][symbol]
            move = v6.mom(rows, idx, lookback)
            rebound = v6.mom(rows, idx, bounce)
            avg = v6.sma(rows, idx, sma_bars)
            if move is None or rebound is None or avg is None:
                continue
            close = float(rows[idx]["close"])
            if move <= -5.0 and rebound >= 1.0 and close < avg:
                score = -move + 0.20 * rebound
                candidates.append((score, symbol, move, rebound))
        if candidates:
            score, symbol, move, rebound = max(candidates, key=lambda x: (x[0], x[1]))
            result.append(Opportunity("A4H", ts, ts + BAR4, symbol, -1, 84, {"signalScore": score, "movePct": move, "reboundPct": rebound}))
    return result


def build_b_opportunities(market: dict) -> List[Opportunity]:
    # 12h robust template: SHORT_PULLBACK_L7_T8_C1.5_H6.
    bars12 = {symbol: resample12(market["bars"][symbol]) for symbol in SYMBOLS}
    indexes12 = {symbol: {int(row["ts"]): i for i, row in enumerate(rows)} for symbol, rows in bars12.items()}
    result = []
    btc_times = [int(row["ts"]) for row in bars12["BTC"] if START_MS <= int(row["ts"]) < END_MS - BAR12]
    for ts in btc_times:
        candidates = []
        for symbol in SYMBOLS:
            idx = indexes12[symbol].get(ts)
            if idx is None:
                continue
            rows = bars12[symbol]
            move = mom(rows, idx, 14)
            recent = mom(rows, idx, 1)
            avg = sma(rows, idx, 40)
            if move is None or recent is None or avg is None:
                continue
            close = float(rows[idx]["close"])
            if move <= -8.0 and recent >= 1.5 and close < avg:
                score = -move + 0.20 * recent
                candidates.append((score, symbol, move, recent))
        if candidates:
            score, symbol, move, recent = max(candidates, key=lambda x: (x[0], x[1]))
            result.append(Opportunity("B12H", ts, ts + BAR12, symbol, -1, 72, {"signalScore": score, "movePct": move, "reboundPct": recent}))
    return result


def simulate_shadow(opportunities: Sequence[Opportunity], market: dict, severe: bool = False) -> Tuple[List[dict], List[dict]]:
    by_entry: Dict[int, List[Opportunity]] = {}
    for opp in opportunities:
        by_entry.setdefault(opp.entry_ts, []).append(opp)
    times = [ts for ts in market["times"] if START_MS <= ts < END_MS]
    rows = []
    entries = []
    position: Optional[Position] = None
    previous: Dict[str, float] = {}
    cost = 50.0 if severe else 10.0
    adverse = 3.0 if severe else 0.0
    for ts in times:
        if position is None:
            choices = by_entry.get(ts, [])
            if choices:
                opp = max(choices, key=lambda x: (finite(x.meta.get("signalScore")), x.symbol))
                position = Position(opp.strategy, opp.symbol, opp.side, ts, 0, max(1, opp.hold_hours // 4))
                entries.append({"entryTs": ts, "strategy": opp.strategy, "symbol": opp.symbol, **opp.meta})
        weights: Dict[str, float] = {}
        value = 0.0
        if position is not None:
            weights[position.symbol] = position.side * GROSS
            idx = market["indexes"][position.symbol].get(ts)
            if idx is not None:
                bar = market["bars"][position.symbol][idx]
                value += position.side * GROSS * (float(bar["close"]) / float(bar["open"]) - 1.0)
                value -= position.side * GROSS * market["funding"][position.symbol].get(ts, 0.0)
                if severe:
                    value -= GROSS * adverse / 10_000.0
        turnover = sum(abs(weights.get(s, 0.0) - previous.get(s, 0.0)) for s in set(weights) | set(previous))
        value -= turnover * cost / 10_000.0
        gross = sum(abs(v) for v in weights.values())
        rows.append({"ts": ts, "return": value, "gross": gross, "maxGross": gross, "regime": -1 if weights else 0})
        previous = dict(weights)
        if position is not None:
            position.bars_held += 1
            if position.bars_held >= position.max_bars:
                position = None
    return rows, entries


def trailing_stats(rows: Sequence[dict], ts: int, lookback_days: int) -> Tuple[float, float]:
    start = ts - lookback_days * DAY_MS
    values = [float(r["return"]) for r in rows if start <= int(r["ts"]) < ts]
    if not values:
        return 0.0, 0.0
    ret = compound(values) * 100.0
    eq = peak = 1.0
    dd = 0.0
    for value in values:
        eq *= max(0.001, 1.0 + value)
        peak = max(peak, eq)
        dd = min(dd, eq / peak - 1.0)
    return ret, dd * 100.0


def simulate_meta(cfg: MetaConfig, market: dict, opp_a: Sequence[Opportunity], opp_b: Sequence[Opportunity], shadow_a: Sequence[dict], shadow_b: Sequence[dict], severe: bool = False):
    by_entry_a: Dict[int, List[Opportunity]] = {}
    by_entry_b: Dict[int, List[Opportunity]] = {}
    for opp in opp_a: by_entry_a.setdefault(opp.entry_ts, []).append(opp)
    for opp in opp_b: by_entry_b.setdefault(opp.entry_ts, []).append(opp)
    times = [ts for ts in market["times"] if START_MS <= ts < END_MS]
    position: Optional[Position] = None
    rows = []
    entries = []
    previous: Dict[str, float] = {}
    cost = 50.0 if severe else 10.0
    adverse = 3.0 if severe else 0.0

    for ts in times:
        if position is None:
            candidates = []
            ret_a, dd_a = trailing_stats(shadow_a, ts, cfg.lookback_days)
            ret_b, dd_b = trailing_stats(shadow_b, ts, cfg.lookback_days)
            score_a = ret_a - cfg.dd_penalty * abs(dd_a)
            score_b = ret_b - cfg.dd_penalty * abs(dd_b) + cfg.robust_bonus_pct
            for opp in by_entry_a.get(ts, []):
                if score_a >= cfg.min_score_pct:
                    candidates.append((score_a, "A4H", opp))
            for opp in by_entry_b.get(ts, []):
                if score_b >= cfg.min_score_pct:
                    candidates.append((score_b, "B12H", opp))
            if candidates:
                candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
                best_score, best_name, best = candidates[0]
                if len(candidates) > 1 and abs(candidates[0][0] - candidates[1][0]) <= cfg.tie_margin_pct:
                    # Prefer the robust 12h sleeve only inside an explicit near-tie band.
                    b_candidates = [item for item in candidates if item[1] == "B12H"]
                    if b_candidates:
                        best_score, best_name, best = b_candidates[0]
                position = Position(best.strategy, best.symbol, best.side, ts, 0, max(1, best.hold_hours // 4))
                entries.append({
                    "entryTs": ts, "strategy": best.strategy, "symbol": best.symbol,
                    "routerScore": best_score, "shadowAReturnPct": ret_a, "shadowADDpct": dd_a,
                    "shadowBReturnPct": ret_b, "shadowBDDpct": dd_b, **best.meta,
                })

        weights: Dict[str, float] = {}
        value = 0.0
        if position is not None:
            weights[position.symbol] = position.side * GROSS
            idx = market["indexes"][position.symbol].get(ts)
            if idx is not None:
                bar = market["bars"][position.symbol][idx]
                value += position.side * GROSS * (float(bar["close"]) / float(bar["open"]) - 1.0)
                value -= position.side * GROSS * market["funding"][position.symbol].get(ts, 0.0)
                if severe:
                    value -= GROSS * adverse / 10_000.0
        turnover = sum(abs(weights.get(s, 0.0) - previous.get(s, 0.0)) for s in set(weights) | set(previous))
        value -= turnover * cost / 10_000.0
        gross = sum(abs(v) for v in weights.values())
        rows.append({"ts": ts, "return": value, "gross": gross, "maxGross": gross, "regime": -1 if weights else 0})
        previous = dict(weights)
        if position is not None:
            position.bars_held += 1
            if position.bars_held >= position.max_bars:
                position = None
    return rows, entries


def metrics(rows: Sequence[dict], entries: Sequence[dict], start: int, end: int) -> dict:
    active = [r for r in rows if start <= int(r["ts"]) < end]
    values = [float(r["return"]) for r in active]
    eq = peak = 1.0
    dd = 0.0
    months: Dict[str, List[float]] = {}
    for row in active:
        eq *= max(0.001, 1.0 + float(row["return"]))
        peak = max(peak, eq)
        dd = min(dd, eq / peak - 1.0)
        key = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        months.setdefault(key, []).append(float(row["return"]))
    monthly = {k: compound(v) * 100.0 for k, v in months.items()}
    years = max(1e-9, (end - start) / (365.25 * DAY_MS))
    return {
        "tradeEpisodes": sum(1 for e in entries if start <= int(e["entryTs"]) < end),
        "compoundedReturnPct": (eq - 1.0) * 100.0,
        "cagrPct": (eq ** (1.0 / years) - 1.0) * 100.0 if eq > 0 else None,
        "maxDrawdownPct": dd * 100.0,
        "profitFactor": profit_factor(values),
        "positiveMonthRatio": sum(v > 0 for v in monthly.values()) / len(monthly) if monthly else 0.0,
        "monthlyReturnsPct": monthly,
    }


def evaluate(cfg: MetaConfig, market: dict, opp_a, opp_b, shadow_a, shadow_b, shadow_a_s, shadow_b_s):
    normal, entries = simulate_meta(cfg, market, opp_a, opp_b, shadow_a, shadow_b, False)
    severe, severe_entries = simulate_meta(cfg, market, opp_a, opp_b, shadow_a_s, shadow_b_s, True)
    ranges = {"fold1":(START_MS,F1_MS),"fold2":(F1_MS,F2_MS),"fold3":(F2_MS,F3_MS),"lateEvaluation":(F3_MS,END_MS),"full":(START_MS,END_MS)}
    out = {"variantId": cfg.config_id, "config": asdict(cfg)}
    for name,(a,b) in ranges.items():
        out[name] = {"normal":metrics(normal,entries,a,b),"severe":metrics(severe,severe_entries,a,b)}
    ns=[out[x]["normal"] for x in ("fold1","fold2","fold3")]; ss=[out[x]["severe"] for x in ("fold1","fold2","fold3")]
    pre=compound([finite(x["compoundedReturnPct"])/100 for x in ns])*100; pre_s=compound([finite(x["compoundedReturnPct"])/100 for x in ss])*100
    pn=sum(finite(x["compoundedReturnPct"])>0 for x in ns); ps=sum(finite(x["compoundedReturnPct"])>0 for x in ss); trades=sum(int(x["tradeEpisodes"]) for x in ns); worst=min(finite(x["maxDrawdownPct"],-99) for x in ns); avg_pf=sum(min(5.0,finite(x.get("profitFactor"))) for x in ns)/3
    eligible=bool(trades>=10 and pn==3 and ps>=2 and pre>=45 and pre_s>=15 and worst>=-15 and avg_pf>=1.12)
    score=pre+0.7*pre_s+5*(pn+ps)+5*max(0,avg_pf-1)-0.2*abs(worst) if eligible else -1e12
    out["preSelection"]={"eligible":eligible,"score":score,"compoundedReturnPct":pre,"severeCompoundedReturnPct":pre_s,"positiveFolds":pn,"positiveSevereFolds":ps,"tradeEpisodes":trades,"worstFoldDrawdownPct":worst,"averageFoldProfitFactor":avg_pf}
    return out, normal, severe, entries


def compact(row: dict) -> dict:
    return {k: row[k] for k in ("variantId","config","preSelection","fold1","fold2","fold3","lateEvaluation","full")}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--output-dir',default='.research-state/v96-v10'); args=parser.parse_args(); output=Path(args.output_dir); output.mkdir(parents=True,exist_ok=True)
    market=v6.load_market(); opp_a=build_a_opportunities(market); opp_b=build_b_opportunities(market)
    shadow_a, entries_a=simulate_shadow(opp_a,market,False); shadow_b, entries_b=simulate_shadow(opp_b,market,False); shadow_a_s,_=simulate_shadow(opp_a,market,True); shadow_b_s,_=simulate_shadow(opp_b,market,True)
    results=[];replays={};entry_ledgers={}
    for cfg in configs():
        row,n,s,e=evaluate(cfg,market,opp_a,opp_b,shadow_a,shadow_b,shadow_a_s,shadow_b_s);results.append(row);replays[row['variantId']]=(n,s);entry_ledgers[row['variantId']]=e
    eligible=sorted((r for r in results if r['preSelection']['eligible']),key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True);ranked=sorted(results,key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True);selected=eligible[0] if eligible else ranked[0];normal,severe=replays[selected['variantId']];late=selected['lateEvaluation']['normal'];late_s=selected['lateEvaluation']['severe'];full=selected['full']['normal'];full_s=selected['full']['severe'];latepass=int(late['tradeEpisodes'])>=2 and finite(late['compoundedReturnPct'])>0 and finite(late_s['compoundedReturnPct'])>0 and finite(late['maxDrawdownPct'],-99)>=-12 and finite(late.get('profitFactor'))>1.05;beats=finite(full['compoundedReturnPct'])>BASELINE and finite(full_s['compoundedReturnPct'])>25 and finite(full['maxDrawdownPct'],-99)>=-15 and finite(full.get('profitFactor'))>1.22;status='V96_RECENT_EVENT_CORE_V10_PASS' if selected['preSelection']['eligible'] and latepass and beats else 'V96_RECENT_EVENT_CORE_V10_DIAGNOSTIC';topfull=sorted(results,key=lambda r:finite(r['full']['normal']['compoundedReturnPct'],-1e12),reverse=True)
    shadow_summary={
      'A4H':{'opportunities':len(opp_a),'full':metrics(shadow_a,entries_a,START_MS,END_MS),'late':metrics(shadow_a,entries_a,F3_MS,END_MS)},
      'B12H':{'opportunities':len(opp_b),'full':metrics(shadow_b,entries_b,START_MS,END_MS),'late':metrics(shadow_b,entries_b,F3_MS,END_MS)},
    }
    payload=rounded({'version':10,'strategyId':'V96_RECENT_EVENT_CORE_V10_ONLINE_SHADOW_META_ROUTER','status':status,'architecture':{'gross':GROSS,'strategyA':'4h 10d -5%, 8h +1%, short84h','strategyB':'12h 7d -8%, 12h +1.5%, short72h','selection':'trailing shadow performance only; no future data; route only while actual account flat','lookbacks':[30,45,60,90]},'benchmark':{'A4HDiagnosticPct':BASELINE},'shadowSummary':shadow_summary,'candidateCounts':{'tested':len(results),'eligible':len(eligible)},'selected':compact(selected),'selectedEntryLedger':entry_ledgers[selected['variantId']],'selectedPassesLateEvaluation':latepass,'selectedBeats101p998':beats,'topPreSelection':[compact(r) for r in ranked[:20]],'topFullDiagnosticOnly':[compact(r) for r in topfull[:20]],'selectionPolicy':{'rankingUsesOnlyFirstThreeFolds':True,'lateEvaluationUsedForRanking':False,'fullPeriodUsedForRanking':False,'routerUsesOnlyPastShadowReturnsAtEachDecision':True},'selectedReplay':{'strategyId':'V96_RECENT_EVENT_CORE_V10_ONLINE_SHADOW_META_ROUTER','variantId':selected['variantId'],'normal':normal,'severe':severe},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}});(output/'v96-recent-event-core-v10.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':status,'shadow':shadow_summary,'counts':payload['candidateCounts'],'selected':selected['variantId'],'pre':selected['preSelection'],'full':selected['full'],'late':selected['lateEvaluation'],'beats':beats,'latePass':latepass,'bestFullDiagnostic':compact(topfull[0])},indent=2))

if __name__=='__main__':main()
