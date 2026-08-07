from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_v96_recent_event_core_v6 as v6

UTC = dt.timezone.utc
START_MS, END_MS = v6.START_MS, v6.END_MS
F1_MS, F2_MS, F3_MS = v6.F1_MS, v6.F2_MS, v6.F3_MS
BAR_HOURS, BAR_MS, DAY_MS, GROSS = v6.BAR_HOURS, v6.BAR_MS, v6.DAY_MS, v6.GROSS
ALT_SYMBOLS = ("ETH", "BNB", "SOL", "LINK", "AVAX")
BENCHMARK = 101.998210


@dataclass(frozen=True)
class RouterConfig:
    config_id: str
    btc_mom_min: float
    breadth_min: int
    strong_action: str
    exit_mode: str


@dataclass
class Position:
    symbol: str
    side: int
    entry_ts: int
    entry_price: float
    bars_held: int
    max_bars: int


AGGRESSIVE = v6.Config("BASE_D5_B1_H84", "SHORT_PULLBACK", 10, 5.0, 8, 1.0, 0.0, 84)
CONSERVATIVE_D6 = v6.Config("CONS_D6_B1_H72", "SHORT_PULLBACK", 10, 6.0, 8, 1.0, 0.0, 72)
CONSERVATIVE_D7 = v6.Config("CONS_D7_B1_H72", "SHORT_PULLBACK", 10, 7.0, 8, 1.0, 0.0, 72)
CONSERVATIVE_D6B125 = v6.Config("CONS_D6_B1p25_H72", "SHORT_PULLBACK", 10, 6.0, 8, 1.25, 0.0, 72)


def rounded(value: Any):
    if isinstance(value, float): return round(value, 6)
    if isinstance(value, dict): return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list): return [rounded(v) for v in value]
    return value


def finite(value: Any, fallback: float = 0.0) -> float:
    try: x = float(value)
    except (TypeError, ValueError): return fallback
    return x if math.isfinite(x) else fallback


def compound(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values: equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


def configs() -> List[RouterConfig]:
    result = []
    for btc_mom, breadth, action, exit_mode in itertools.product(
        (0.0, 2.0, 4.0, 6.0),
        (2, 3, 4),
        ("CASH", "D6", "D7", "D6B125", "SHORT48", "SHORT60"),
        ("FIXED", "STRONG24", "STRONG36", "ADVERSE12H2", "ADVERSE12H3"),
    ):
        result.append(RouterConfig(
            f"V7_BTC{btc_mom:g}_BR{breadth}_{action}_{exit_mode}",
            btc_mom, breadth, action, exit_mode,
        ))
    return result


def regime(ts: int, market: dict, cfg: RouterConfig) -> Optional[dict]:
    bidx = market["indexes"]["BTC"].get(ts)
    if bidx is None: return None
    btc = market["bars"]["BTC"]
    btc7 = v6.mom(btc, bidx, int(7 * 24 / BAR_HOURS))
    btc20 = v6.sma(btc, bidx, int(20 * 24 / BAR_HOURS))
    if btc7 is None or btc20 is None: return None
    breadth = 0
    alt_moms = []
    for symbol in ALT_SYMBOLS:
        idx = market["indexes"][symbol].get(ts)
        if idx is None: continue
        rows = market["bars"][symbol]
        avg = v6.sma(rows, idx, int(20 * 24 / BAR_HOURS))
        mom7 = v6.mom(rows, idx, int(7 * 24 / BAR_HOURS))
        if avg is None or mom7 is None: continue
        alt_moms.append(mom7)
        if float(rows[idx]["close"]) > avg and mom7 > 0.0:
            breadth += 1
    strong = bool(
        float(btc[bidx]["close"]) > btc20
        and btc7 >= cfg.btc_mom_min
        and breadth >= cfg.breadth_min
    )
    return {"strong": strong, "btcMom7": btc7, "breadth": breadth, "altMomMean": sum(alt_moms)/len(alt_moms) if alt_moms else 0.0}


def signal_for(cfg: RouterConfig, ts: int, market: dict):
    state = regime(ts, market, cfg)
    if state is None: return None
    if not state["strong"]:
        item = v6.short_signal(AGGRESSIVE, ts, market, False)
        if item is None: return None
        symbol, side, meta = item
        return symbol, side, 84, {**meta, **state, "routerAction": "AGGRESSIVE"}

    if cfg.strong_action == "CASH":
        return None
    if cfg.strong_action == "D6":
        template, hold = CONSERVATIVE_D6, 72
    elif cfg.strong_action == "D7":
        template, hold = CONSERVATIVE_D7, 72
    elif cfg.strong_action == "D6B125":
        template, hold = CONSERVATIVE_D6B125, 72
    elif cfg.strong_action == "SHORT48":
        template, hold = AGGRESSIVE, 48
    elif cfg.strong_action == "SHORT60":
        template, hold = AGGRESSIVE, 60
    else:
        raise RuntimeError(cfg.strong_action)
    item = v6.short_signal(template, ts, market, False)
    if item is None: return None
    symbol, side, meta = item
    return symbol, side, hold, {**meta, **state, "routerAction": cfg.strong_action}


def should_exit(cfg: RouterConfig, pos: Position, ts: int, market: dict) -> bool:
    if pos.bars_held * BAR_HOURS >= pos.max_bars:
        return True
    state = regime(ts, market, cfg)
    if state is None or not state["strong"]:
        return False
    held = pos.bars_held * BAR_HOURS
    if cfg.exit_mode == "FIXED":
        return False
    if cfg.exit_mode == "STRONG24":
        return held >= 24
    if cfg.exit_mode == "STRONG36":
        return held >= 36
    if held < 24:
        return False
    idx = market["indexes"][pos.symbol].get(ts)
    if idx is None: return False
    adverse12 = v6.mom(market["bars"][pos.symbol], idx, int(12 / BAR_HOURS))
    if adverse12 is None: return False
    threshold = 2.0 if cfg.exit_mode == "ADVERSE12H2" else 3.0
    return adverse12 >= threshold


def simulate(cfg: RouterConfig, market: dict, severe: bool = False):
    times = [ts for ts in market["times"] if START_MS <= ts < END_MS]
    position: Optional[Position] = None
    pending = None
    exit_next = False
    rows = []
    entries = []
    previous: Dict[str, float] = {}
    cost = 50.0 if severe else 10.0
    adverse = 3.0 if severe else 0.0

    for ts in times:
        if position is not None and exit_next:
            position = None
            exit_next = False
        if position is None and pending is not None:
            symbol, side, hold, meta = pending
            idx = market["indexes"][symbol].get(ts)
            if idx is not None:
                position = Position(symbol, side, ts, float(market["bars"][symbol][idx]["open"]), 0, max(1, hold // BAR_HOURS))
                entries.append({"entryTs": ts, "symbol": symbol, "side": side, "holdHours": hold, **meta})
            pending = None

        weights: Dict[str, float] = {}
        value = 0.0
        if position is not None:
            weights[position.symbol] = position.side * GROSS
            idx = market["indexes"][position.symbol].get(ts)
            if idx is not None:
                bar = market["bars"][position.symbol][idx]
                value += position.side * GROSS * (float(bar["close"]) / float(bar["open"]) - 1.0)
                value -= position.side * GROSS * market["funding"][position.symbol].get(ts, 0.0)
                if severe: value -= GROSS * adverse / 10_000.0
        turnover = sum(abs(weights.get(s,0.0)-previous.get(s,0.0)) for s in set(weights)|set(previous))
        value -= turnover * cost / 10_000.0
        gross = sum(abs(v) for v in weights.values())
        rows.append({"ts": ts, "return": value, "gross": gross, "maxGross": gross, "regime": -1 if weights else 0})
        previous = dict(weights)

        if position is not None:
            position.bars_held += 1
            exit_next = should_exit(cfg, position, ts, market)
        if position is None and pending is None:
            pending = signal_for(cfg, ts, market)
    return rows, entries


def metrics(rows, entries, start, end):
    return v6.metrics(rows, entries, start, end)


def evaluate(cfg: RouterConfig, market: dict):
    normal, entries = simulate(cfg, market, False)
    severe, severe_entries = simulate(cfg, market, True)
    ranges = {"fold1":(START_MS,F1_MS),"fold2":(F1_MS,F2_MS),"fold3":(F2_MS,F3_MS),"lateEvaluation":(F3_MS,END_MS),"full":(START_MS,END_MS)}
    out = {"variantId": cfg.config_id, "config": asdict(cfg)}
    for name,(a,b) in ranges.items():
        out[name] = {"normal":metrics(normal,entries,a,b),"severe":metrics(severe,severe_entries,a,b)}
    ns=[out[x]["normal"] for x in ("fold1","fold2","fold3")]
    ss=[out[x]["severe"] for x in ("fold1","fold2","fold3")]
    pre=compound([finite(x["compoundedReturnPct"])/100 for x in ns])*100
    pre_s=compound([finite(x["compoundedReturnPct"])/100 for x in ss])*100
    pn=sum(finite(x["compoundedReturnPct"])>0 for x in ns)
    ps=sum(finite(x["compoundedReturnPct"])>0 for x in ss)
    trades=sum(int(x["tradeEpisodes"]) for x in ns)
    worst=min(finite(x["maxDrawdownPct"],-99) for x in ns)
    avg_pf=sum(min(5.0,finite(x.get("profitFactor"))) for x in ns)/3
    eligible=bool(trades>=15 and pn==3 and ps>=2 and pre>=45 and pre_s>=15 and worst>=-15 and avg_pf>=1.12)
    score=pre+0.65*pre_s+5*(pn+ps)+5*max(0,avg_pf-1)-0.2*abs(worst) if eligible else -1e12
    out["preSelection"]={"eligible":eligible,"score":score,"compoundedReturnPct":pre,"severeCompoundedReturnPct":pre_s,"positiveFolds":pn,"positiveSevereFolds":ps,"tradeEpisodes":trades,"worstFoldDrawdownPct":worst,"averageFoldProfitFactor":avg_pf}
    return out, normal, severe


def compact(row):
    return {k:row[k] for k in ("variantId","config","preSelection","fold1","fold2","fold3","lateEvaluation","full")}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output-dir',default='.research-state/v96-recent-event-core-v7');args=parser.parse_args();output=Path(args.output_dir);output.mkdir(parents=True,exist_ok=True)
    market=v6.load_market();results=[];replays={}
    for cfg in configs():
        row,n,s=evaluate(cfg,market);results.append(row);replays[row['variantId']]=(n,s)
    eligible=sorted((r for r in results if r['preSelection']['eligible']),key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True)
    ranked=sorted(results,key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True)
    selected=eligible[0] if eligible else ranked[0];normal,severe=replays[selected['variantId']]
    full=selected['full']['normal'];full_s=selected['full']['severe'];late=selected['lateEvaluation']['normal'];late_s=selected['lateEvaluation']['severe']
    late_pass=bool(int(late['tradeEpisodes'])>=3 and finite(late['compoundedReturnPct'])>0 and finite(late_s['compoundedReturnPct'])>0 and finite(late['maxDrawdownPct'],-99)>=-12 and finite(late.get('profitFactor'))>1.05)
    beats=bool(finite(full['compoundedReturnPct'])>BENCHMARK and finite(full_s['compoundedReturnPct'])>25 and finite(full['maxDrawdownPct'],-99)>=-15 and finite(full.get('profitFactor'))>1.22)
    status='V96_RECENT_EVENT_CORE_V7_PASS' if selected['preSelection']['eligible'] and late_pass and beats else 'V96_RECENT_EVENT_CORE_V7_DIAGNOSTIC'
    topfull=sorted(results,key=lambda r:finite(r['full']['normal']['compoundedReturnPct'],-1e12),reverse=True)
    payload=rounded({'version':7,'strategyId':'V96_RECENT_EVENT_CORE_V7_BREADTH_AWARE_SHORT_ROUTER','status':status,'architecture':{'barHours':4,'gross':GROSS,'baseShort':'10d decline >=5%, 8h rebound >=1%, hold84h','regime':'BTC above20d SMA + BTC7d momentum + alt breadth above20d SMA/mom>0','strongActions':['cash','higher decline threshold','higher rebound threshold','shorter hold'],'conditionalExits':['strong after24/36h','adverse12h 2/3% while strong'],'nextBarExecution':True},'benchmark':{'V6FastFullDiagnosticPct':BENCHMARK},'candidateCounts':{'tested':len(results),'eligible':len(eligible)},'selected':compact(selected),'selectedPassesLateEvaluation':late_pass,'selectedBeats101p998':beats,'topPreSelection':[compact(r) for r in ranked[:20]],'topFullDiagnosticOnly':[compact(r) for r in topfull[:20]],'selectionPolicy':{'rankingUsesOnlyFirstThreeFolds':True,'lateEvaluationUsedForRanking':False,'fullPeriodUsedForRanking':False,'target':'beat 101.998210 at gross0.75 with DD<=15, severe>25, late Normal/Severe positive'},'selectedReplay':{'strategyId':'V96_RECENT_EVENT_CORE_V7_BREADTH_AWARE_SHORT_ROUTER','variantId':selected['variantId'],'normal':normal,'severe':severe},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}})
    (output/'v96-recent-event-core-v7.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':status,'counts':payload['candidateCounts'],'selected':selected['variantId'],'pre':selected['preSelection'],'full':selected['full'],'late':selected['lateEvaluation'],'beats':beats,'latePass':late_pass,'bestFullDiagnostic':compact(topfull[0])},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
