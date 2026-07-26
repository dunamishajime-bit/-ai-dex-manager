from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22

STRATEGY_ID = "DISDEX_ASTER_ONLY_V46_CLOSING_OVERLAY"
SCENARIOS = v14.SCENARIOS
HOLDOUT_START = v20.HOLDOUT_START_DAY
TP_PCT = 0.75
SL_PCT = 1.00
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold_bps: float
    recent_threshold_bps: float
    entry_minute: int
    minimum_volume_ratio: float
    direction_mode: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"{family}__T{threshold:g}__R{recent:g}__E{entry}__V{volume:g}__{direction}",
        family,
        threshold,
        recent,
        entry,
        volume,
        direction,
    )
    for family in ("DAY_TREND_CONT", "DAY_EXHAUST_REV", "MORNING_RANGE_BREAK", "CROSS_RESIDUAL_CONT")
    for threshold in (75.0, 125.0, 200.0)
    for recent in (25.0, 50.0)
    for entry in (870, 900)
    for volume in (0.0, 1.25)
    for direction in ("BOTH", "LONG_ONLY", "SHORT_ONLY")
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def direction_allowed(mode: str, side: int) -> bool:
    return mode == "BOTH" or (mode == "LONG_ONLY" and side > 0) or (mode == "SHORT_ONLY" and side < 0)


def load_intraday(market: Dict[str, Dict[str, List[list]]], days: Sequence[str]) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    required = {630, 660, 690, 720, 750, 780, 810, 840, 870, 900, 930}
    day_set = set(days)
    result: Dict[str, Dict[str, dict]] = {symbol: {} for symbol in v14.SYMBOLS}
    diagnostics = {"symbols": {}}
    for symbol in v14.SYMBOLS:
        by_day: Dict[str, Dict[int, list]] = defaultdict(dict)
        raw = market[symbol]["trade"]
        for row in raw:
            if not isinstance(row, list) or len(row) < 6:
                continue
            day, minute, weekday = v14.v11.v9.local_parts(int(row[0]))
            if day in day_set and weekday < 5 and minute in required:
                by_day[day][minute] = row
        for day, slots in by_day.items():
            if required.issubset(slots):
                result[symbol][day] = {"bars": slots}
        diagnostics["symbols"][symbol] = {"tradeBars": len(raw), "completeSessions": len(result[symbol])}
    common = [day for day in days if all(day in result[symbol] for symbol in v14.SYMBOLS)]
    diagnostics["commonSessions"] = len(common)
    return result, diagnostics


def feature_for(row: dict, entry_minute: int) -> dict:
    bars = row["bars"]
    entry_price = finite(bars[entry_minute][1])
    day_open = finite(bars[630][1])
    recent_start = 810 if entry_minute == 870 else 840
    recent_price = finite(bars[recent_start][1])
    day_return = (entry_price / day_open - 1.0) * 10_000.0
    recent_return = (entry_price / recent_price - 1.0) * 10_000.0
    morning_minutes = (630, 660, 690, 720, 750, 780, 810)
    morning_high = max(finite(bars[m][2]) for m in morning_minutes)
    morning_low = min(finite(bars[m][3]) for m in morning_minutes)
    if entry_price > morning_high:
        breakout = (entry_price / morning_high - 1.0) * 10_000.0
    elif entry_price < morning_low:
        breakout = (entry_price / morning_low - 1.0) * 10_000.0
    else:
        breakout = 0.0
    recent_minutes = (810, 840) if entry_minute == 870 else (840, 870)
    earlier_minutes = tuple(m for m in morning_minutes if m < recent_start)
    recent_volume = statistics.mean(finite(bars[m][5]) for m in recent_minutes)
    earlier_volume = statistics.mean(finite(bars[m][5]) for m in earlier_minutes) if earlier_minutes else 0.0
    volume_ratio = recent_volume / earlier_volume if earlier_volume > 1e-12 else 0.0
    return {
        "entryPrice": entry_price,
        "entryTs": int(bars[entry_minute][0]),
        "dayReturnBps": day_return,
        "recentReturnBps": recent_return,
        "breakoutBps": breakout,
        "volumeRatio": volume_ratio,
    }


def signal(candidate: Candidate, day_rows: Dict[str, dict]) -> Optional[Tuple[str, int, float, dict]]:
    states = {symbol: feature_for(day_rows[symbol], candidate.entry_minute) for symbol in v14.SYMBOLS}
    median_day = statistics.median(state["dayReturnBps"] for state in states.values())
    eligible = []
    for symbol, state in states.items():
        day_ret = finite(state["dayReturnBps"])
        recent = finite(state["recentReturnBps"])
        breakout = finite(state["breakoutBps"])
        if candidate.minimum_volume_ratio > 0 and finite(state["volumeRatio"]) < candidate.minimum_volume_ratio:
            continue
        side = 0
        metric = 0.0
        if candidate.family == "DAY_TREND_CONT":
            if abs(day_ret) < candidate.threshold_bps or abs(recent) < candidate.recent_threshold_bps or day_ret * recent <= 0:
                continue
            side = 1 if day_ret > 0 else -1
            metric = min(abs(day_ret), abs(recent))
        elif candidate.family == "DAY_EXHAUST_REV":
            if abs(day_ret) < candidate.threshold_bps or abs(recent) < candidate.recent_threshold_bps or day_ret * recent >= 0:
                continue
            side = 1 if recent > 0 else -1
            metric = min(abs(day_ret), abs(recent))
        elif candidate.family == "MORNING_RANGE_BREAK":
            if abs(breakout) < candidate.threshold_bps or abs(recent) < candidate.recent_threshold_bps or breakout * recent <= 0:
                continue
            side = 1 if breakout > 0 else -1
            metric = min(abs(breakout), abs(recent))
        elif candidate.family == "CROSS_RESIDUAL_CONT":
            residual = day_ret - median_day
            if abs(residual) < candidate.threshold_bps or abs(recent) < candidate.recent_threshold_bps or residual * recent <= 0:
                continue
            side = 1 if residual > 0 else -1
            metric = min(abs(residual), abs(recent))
            state = {**state, "crossResidualBps": residual, "medianDayReturnBps": median_day}
        else:
            raise ValueError(candidate.family)
        if not direction_allowed(candidate.direction_mode, side):
            continue
        edge = max(0.0, metric - 5.0)
        strength = metric + 0.25 * abs(day_ret) + 10.0 * finite(state["volumeRatio"])
        eligible.append((strength, symbol, side, edge, state))
    if not eligible:
        return None
    _strength, symbol, side, edge, state = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge, state


def build_trade(candidate: Candidate, day: str, day_rows: Dict[str, dict], funding: Dict[str, Sequence[Tuple[int, float]]]) -> Optional[dict]:
    selected = signal(candidate, day_rows)
    if selected is None:
        return None
    symbol, side, edge, state = selected
    bars = day_rows[symbol]["bars"]
    entry_minute = candidate.entry_minute
    entry_price = finite(state["entryPrice"])
    entry_ts = int(state["entryTs"])
    if entry_minute == 870:
        exit_price = finite(bars[930][1])
        exit_ts = int(bars[930][0])
        scan_minutes = (870, 900)
    else:
        exit_price = finite(bars[930][4])
        exit_ts = int(bars[930][0]) + 30 * 60_000
        scan_minutes = (900, 930)
    reason = "TIME_CLOSE"
    for minute in scan_minutes:
        bar = bars[minute]
        high, low = finite(bar[2]), finite(bar[3])
        if side > 0:
            stop_hit = low <= entry_price * (1.0 - SL_PCT / 100.0)
            take_hit = high >= entry_price * (1.0 + TP_PCT / 100.0)
            stop_price = entry_price * (1.0 - SL_PCT / 100.0)
            take_price = entry_price * (1.0 + TP_PCT / 100.0)
        else:
            stop_hit = high >= entry_price * (1.0 + SL_PCT / 100.0)
            take_hit = low <= entry_price * (1.0 - TP_PCT / 100.0)
            stop_price = entry_price * (1.0 + SL_PCT / 100.0)
            take_price = entry_price * (1.0 - TP_PCT / 100.0)
        if stop_hit or take_hit:
            exit_price, reason = (stop_price, "PRICE_STOP") if stop_hit else (take_price, "PRICE_TAKE_PROFIT")
            exit_ts = int(bar[0]) + 30 * 60_000
            break
    price_return = side * (exit_price / entry_price - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(funding.get(symbol, []), entry_ts, exit_ts)
    return {
        "strategy": "V46_CLOSING_OVERLAY",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "edgeProxyBps": edge,
        "dayReturnBps": finite(state["dayReturnBps"]),
        "recentReturnBps": finite(state["recentReturnBps"]),
        "breakoutBps": finite(state["breakoutBps"]),
        "volumeRatio": finite(state["volumeRatio"]),
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": reason,
    }


def build_trades(candidate, days, rows, funding):
    return [trade for day in days if (trade := build_trade(candidate, day, {s: rows[s][day] for s in v14.SYMBOLS}, funding)) is not None]


def route(v11_rows, v19_rows, overlay_rows, cost_bps, days):
    baseline, stats0 = v22.route(v11_rows, v19_rows, cost_bps, days, True)
    allowed = set(days)
    by_base = {str(row["day"]): row for row in baseline}
    by_overlay = {str(row["day"]): row for row in overlay_rows if str(row["day"]) in allowed}
    events = list(baseline); stats = Counter(stats0)
    for day in sorted(allowed):
        overlay = by_overlay.get(day)
        if overlay is None:
            continue
        value = v22.trade_value(overlay, cost_bps)
        if value is None:
            stats["V46_COST_GATE_REJECTED"] += 1
            continue
        base = by_base.get(day)
        if base is not None:
            if int(overlay["entryTs"]) < int(base["exitTs"]):
                stats["V46_OVERLAP_BLOCKED"] += 1
                continue
            if finite(base.get("netReturn")) <= -0.02:
                stats["V46_DAILY_LOSS_BLOCKED"] += 1
                continue
        events.append({**overlay, "netReturn": value, "route": "V46_CLOSING_OVERLAY"})
        stats["V46_CLOSING_OVERLAY_SELECTED"] += 1
    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]), str(row["route"]))), dict(stats)


def scenario_set(v11_rows, v19_rows, overlay_rows, days):
    results={}; routing={}
    for name,cost in SCENARIOS.items():
        events,stats=route(v11_rows,v19_rows,overlay_rows,cost,days); results[name]=v22.metrics(events); routing[name]=stats
    return results,routing


def audit(v11_rows,v19_rows,overlay_rows,target,development,validation,final,holdout):
    full,routing=scenario_set(v11_rows,v19_rows,overlay_rows,target); dev,devr=scenario_set(v11_rows,v19_rows,overlay_rows,development); val,valr=scenario_set(v11_rows,v19_rows,overlay_rows,validation); fin,_=scenario_set(v11_rows,v19_rows,overlay_rows,final); hol,_=scenario_set(v11_rows,v19_rows,overlay_rows,holdout)
    ne,_=route(v11_rows,v19_rows,overlay_rows,SCENARIOS["NORMAL"],target); pe,_=route(v11_rows,v19_rows,overlay_rows,SCENARIOS["P95"],target)
    nme,nm=v22.remove_best_month(ne); pme,pm=v22.remove_best_month(pe)
    fn=v22.metrics([r for r in ne if r.get("route")!="V11_EQ_PRIMARY"]); fp=v22.metrics([r for r in pe if r.get("route")!="V11_EQ_PRIMARY"])
    devo=int(devr["NORMAL"].get("V46_CLOSING_OVERLAY_SELECTED",0)); valo=int(valr["NORMAL"].get("V46_CLOSING_OVERLAY_SELECTED",0))
    checks={
        "developmentNormalAndP95Positive":dev["NORMAL"]["compoundedReturnPct"]>0 and dev["P95"]["compoundedReturnPct"]>0,
        "validationMinimumEightNormalTrades":val["NORMAL"]["trades"]>=8,
        "validationMinimumFourOverlayTrades":valo>=4,
        "validationNormalProfitFactorAtLeast1_2":(val["NORMAL"]["profitFactor"] or 0)>=1.2,
        "validationNormalAndP95Positive":val["NORMAL"]["compoundedReturnPct"]>0 and val["P95"]["compoundedReturnPct"]>0,
        "finalNormalAndP95Positive":fin["NORMAL"]["compoundedReturnPct"]>0 and fin["P95"]["compoundedReturnPct"]>0,
        "holdoutMinimumTrades":hol["NORMAL"]["trades"]>=v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive":hol["NORMAL"]["compoundedReturnPct"]>0 and hol["P95"]["compoundedReturnPct"]>0,
        "normalAboveV22":full["NORMAL"]["compoundedReturnPct"]>BASELINE_NORMAL,
        "p95AboveV22":full["P95"]["compoundedReturnPct"]>BASELINE_P95,
        "fallbackNormalAboveV19":fn["compoundedReturnPct"]>BASELINE_FALLBACK_NORMAL,
        "fallbackP95AboveV19":fp["compoundedReturnPct"]>BASELINE_FALLBACK_P95,
        "normalProfitFactorAtLeast1_5":(full["NORMAL"]["profitFactor"] or 0)>=1.5,
        "normalDrawdownNoWorseThanMinus15Pct":full["NORMAL"]["maxDrawdownPct"]>=-15,
        "normalMinimumFiftyTrades":full["NORMAL"]["trades"]>=50,
        "positiveProfitConcentrationAtMost40Pct":full["NORMAL"]["maximumPositiveProfitSymbolShare"]<=0.40,
        "bestTradeRemovedNormalAndP95Positive":v22.metrics(v22.remove_best(ne))["compoundedReturnPct"]>0 and v22.metrics(v22.remove_best(pe))["compoundedReturnPct"]>0,
        "bestMonthRemovedNormalAndP95Positive":v22.metrics(nme)["compoundedReturnPct"]>0 and v22.metrics(pme)["compoundedReturnPct"]>0,
        "severeFailClosedNonnegative":full["SEVERE"]["compoundedReturnPct"]>=0,
    }
    return {"full":full,"development":dev,"validation":val,"finalReused":fin,"holdout":hol,"routing":routing,"developmentRouting":devr,"validationRouting":valr,"developmentOverlayTrades":devo,"validationOverlayTrades":valo,"fallbackFull":{"NORMAL":fn,"P95":fp},"checks":checks,"allStrictHurdlesPassed":all(checks.values()),"robustness":{"normalBestTradeRemoved":v22.metrics(v22.remove_best(ne)),"p95BestTradeRemoved":v22.metrics(v22.remove_best(pe)),"normalBestMonthRemoved":{"month":nm,"metrics":v22.metrics(nme)},"p95BestMonthRemoved":{"month":pm,"metrics":v22.metrics(pme)}}}


def development_pass(r,b):
    return r["developmentOverlayTrades"]>=8 and r["development"]["NORMAL"]["compoundedReturnPct"]>b["development"]["NORMAL"]["compoundedReturnPct"] and r["development"]["P95"]["compoundedReturnPct"]>b["development"]["P95"]["compoundedReturnPct"] and (r["development"]["NORMAL"]["profitFactor"] or 0)>=1.3

def validation_pass(r,b):
    return r["validation"]["NORMAL"]["trades"]>=8 and r["validationOverlayTrades"]>=4 and r["validation"]["NORMAL"]["compoundedReturnPct"]>b["validation"]["NORMAL"]["compoundedReturnPct"] and r["validation"]["P95"]["compoundedReturnPct"]>b["validation"]["P95"]["compoundedReturnPct"] and (r["validation"]["NORMAL"]["profitFactor"] or 0)>=1.2

def score(r,b):
    return r["validation"]["NORMAL"]["compoundedReturnPct"]-b["validation"]["NORMAL"]["compoundedReturnPct"]+r["validation"]["P95"]["compoundedReturnPct"]-b["validation"]["P95"]["compoundedReturnPct"]+0.2*r["validationOverlayTrades"]-0.25*abs(r["validation"]["NORMAL"]["maxDrawdownPct"])


def analyze(cache_root:Path)->dict:
    v14.base.verify_source(v14.base.V11_ROOT,v14.base.V11_SOURCE_SHA);v14.base.verify_source(v14.base.V13_ROOT,v14.base.V13_SOURCE_SHA);v19.configure_exact_data_window()
    days,aligned,adiag=v19.v17.load_all(cache_root/"aligned");warm=[d for d in days if v19.WARMUP_START.date().isoformat()<=d<v19.BT_END_DAY_EXCLUSIVE]
    market=v14.v11.v9.load_market(cache_root/"aster-market");rows,mdiag=load_intraday(market,warm);common=[d for d in warm if all(d in rows[s] for s in v14.SYMBOLS)]
    fraw=v14.funding_mod.load_funding(cache_root/"funding");funding={s:v14.funding_mod.funding_points(r) for s,r in fraw.items()}
    target=[d for d in common if v19.BT_START_DAY<=d<v19.BT_END_DAY_EXCLUSIVE];pre=[d for d in target if d<HOLDOUT_START];hold=[d for d in target if d>=HOLDOUT_START];splits=v14.split_days(pre)
    v11,vdiag=v22.build_v11eq(warm,aligned);v19r=v22.build_fallback(warm,aligned);baseline=v22.audit(v11,v19r,target,splits["DEVELOPMENT"],splits["VALIDATION"],splits["FINAL_REUSED"],hold,True)
    devs=[];diagnostics=[]
    for c in CANDIDATES:
        over=build_trades(c,common,rows,funding);r=audit(v11,v19r,over,target,splits["DEVELOPMENT"],splits["VALIDATION"],splits["FINAL_REUSED"],hold)
        diagnostics.append({"candidate":asdict(c),"rawTrades":len(over),"development":r["development"],"validation":r["validation"],"developmentOverlayTrades":r["developmentOverlayTrades"],"validationOverlayTrades":r["validationOverlayTrades"],"full":r["full"],"fallbackFull":r["fallbackFull"],"finalReused":r["finalReused"],"holdout":r["holdout"],"checks":r["checks"]})
        if development_pass(r,baseline):devs.append((c,r))
    devs.sort(key=lambda x:x[1]["development"]["NORMAL"]["compoundedReturnPct"]+x[1]["development"]["P95"]["compoundedReturnPct"],reverse=True);vals=[x for x in devs[:60] if validation_pass(x[1],baseline)];vals.sort(key=lambda x:score(x[1],baseline),reverse=True)
    winner=vals[0] if vals else None;status="ASTER_ONLY_V46_NO_VALIDATED_CLOSING_OVERLAY";wp=None
    if winner:
        c,r=winner;accepted=r["allStrictHurdlesPassed"];status="ASTER_ONLY_V46_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V46_WINNER_DID_NOT_CLEAR_FINAL_AUDIT";wp={"candidate":asdict(c),"accepted":accepted,"audit":r}
    diagnostics.sort(key=lambda x:x["development"]["NORMAL"]["compoundedReturnPct"]+x["development"]["P95"]["compoundedReturnPct"],reverse=True)
    return v14.rounded({"version":46,"strategyId":STRATEGY_ID,"status":status,"candidateCount":len(CANDIDATES),"developmentSurvivors":len(devs),"validationSurvivors":len(vals),"winner":wp,"baseline":baseline,"topDevelopmentDiagnostics":diagnostics[:25],"period":{"startInclusiveUtc":v19.BT_START.isoformat(),"endExclusiveUtc":v19.BT_END_EXCLUSIVE.isoformat(),"calendarDays":365,"targetSessions":len(target),"holdoutSessions":len(hold)},"architecture":{"venue":"ASTER_ONLY","signalSource":"ASTER_INTRADAY_CLOSING_MOMENTUM_AND_REVERSAL","entryNy":["14:30","15:00"],"maximumConcurrentGross":1.0,"maximumConcurrentPositions":1,"baselineV11AndV19Preserved":True,"overlayOnlyAfterBaselineExit":True,"closesByNy1600":True,"hyperliquidUsed":False},"selectionDiscipline":{"candidateCountFrozenBeforeExecution":True,"developmentSelectsTopSixty":True,"validationSelectsAtMostOne":True,"finalAndHoldoutUsedForSelection":False,"productionPromotionAllowed":False},"data":{"aligned":adiag,"asterIntraday":mdiag,"commonSessions":len(common)},"v11Diagnostics":vdiag,"safety":{"mode":"RESEARCH_ONLY","orderSubmissionAllowed":False,"productionChanged":False,"liveChanged":False,"vpsChanged":False,"cryptoV96Changed":False,"v11EqChanged":False,"v19Changed":False,"v13dProductionChanged":False}})


def report(r):
    lines=["# Aster-only V46 Closing Overlay","",f"Status: **{r['status']}**","",f"Candidates: {r['candidateCount']}",f"Development survivors: {r['developmentSurvivors']}",f"Validation survivors: {r['validationSurvivors']}",""]
    if r["winner"]:
        w=r["winner"];a=w["audit"];lines += [f"Winner: `{w['candidate']['candidate_id']}`",f"Accepted: {w['accepted']}",f"Normal: {a['full']['NORMAL']['compoundedReturnPct']:.6f}%",f"P95: {a['full']['P95']['compoundedReturnPct']:.6f}%",f"Fallback Normal: {a['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%",f"Fallback P95: {a['fallbackFull']['P95']['compoundedReturnPct']:.6f}%",f"Validation overlay trades: {a['validationOverlayTrades']}",""]
    lines += ["Research only. No Production, LIVE, VPS or order state was changed.",""];return "\n".join(lines)

def main():
    p=argparse.ArgumentParser();p.add_argument("--cache-dir",required=True);p.add_argument("--output-dir",required=True);a=p.parse_args();o=Path(a.output_dir).resolve();o.mkdir(parents=True,exist_ok=True);r=analyze(Path(a.cache_dir).resolve());(o/"result.json").write_text(json.dumps(r,indent=2,ensure_ascii=False)+"\n",encoding="utf-8");(o/"report.md").write_text(report(r),encoding="utf-8");print(json.dumps({"status":r["status"],"developmentSurvivors":r["developmentSurvivors"],"validationSurvivors":r["validationSurvivors"],"winner":r["winner"],"topDevelopmentDiagnostics":r["topDevelopmentDiagnostics"][:5]},indent=2,ensure_ascii=False));return 0
if __name__=="__main__":raise SystemExit(main())
