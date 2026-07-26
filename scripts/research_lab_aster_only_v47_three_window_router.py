from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v39_overnight_open_router as v39
import research_lab_aster_only_v40_overnight_residual_router as v40
import research_lab_aster_only_v42_idiosyncratic_open_residual as v42
import research_lab_aster_only_v46_closing_overlay as v46

STRATEGY_ID = "DISDEX_ASTER_ONLY_V47_THREE_WINDOW_ROUTER"
SCENARIOS = v39.SCENARIOS
CORE = v42.Candidate(
    "R100__ONMAX100__OPENMAX10000__LONG_ONLY__REL_ANY__DOM1",
    100.0,
    100.0,
    10_000.0,
    "LONG_ONLY",
    "ANY",
    1.0,
)
CLOSING = {
    "NONE": None,
    "MRB_LONG": v46.Candidate(
        "MORNING_RANGE_BREAK__T125__R25__E870__V1.25__LONG_ONLY",
        "MORNING_RANGE_BREAK", 125.0, 25.0, 870, 1.25, "LONG_ONLY",
    ),
    "CROSS_LONG": v46.Candidate(
        "CROSS_RESIDUAL_CONT__T200__R25__E900__V0__LONG_ONLY",
        "CROSS_RESIDUAL_CONT", 200.0, 25.0, 900, 0.0, "LONG_ONLY",
    ),
}


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    reversal_confirmation_bps: float
    reversal_holding_hours: int
    reversal_gross: float
    reversal_direction: str
    closing_mode: str
    block_same_symbol: bool


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"REV_C{confirm:g}_H{hours}_G{gross:g}_{direction}__CLOSE_{closing}__{'BLOCK_SAME' if block else 'ALLOW_SAME'}",
        confirm,
        hours,
        gross,
        direction,
        closing,
        block,
    )
    for confirm in (25.0, 75.0)
    for hours in (1, 2)
    for gross in (0.10, 0.25, 0.50)
    for direction in ("BOTH", "LONG_ONLY", "SHORT_ONLY")
    for closing in ("NONE", "MRB_LONG", "CROSS_LONG")
    for block in (False, True)
)


def reversal_candidate(candidate: Candidate) -> v39.Candidate:
    return v39.Candidate(
        candidate_id=candidate.candidate_id,
        family="OPEN_REVERSAL",
        minimum_overnight_bps=150.0,
        minimum_confirmation_bps=candidate.reversal_confirmation_bps,
        minimum_overnight_zscore=1.5,
        maximum_holding_hours=candidate.reversal_holding_hours,
    )


def direction_allowed(mode: str, side: int) -> bool:
    return mode == "BOTH" or (mode == "LONG_ONLY" and side > 0) or (mode == "SHORT_ONLY" and side < 0)


def filter_reversal(candidate: Candidate, rows: Sequence[dict]) -> List[dict]:
    result = []
    for row in rows:
        if not direction_allowed(candidate.reversal_direction, int(row["side"])):
            continue
        result.append({
            **row,
            "gross": candidate.reversal_gross,
            "holdingHours": candidate.reversal_gross * v39.finite(row.get("holdingHours")),
        })
    return result


def fractional_value(row: dict, cost_bps: float) -> Optional[float]:
    if cost_bps > v39.v14.MAX_OBSERVABLE_ROUND_TRIP_BPS:
        return None
    if v39.finite(row.get("edgeProxyBps")) - cost_bps < v39.v14.MIN_NET_EDGE_BPS:
        return None
    gross = v39.finite(row.get("gross"), 1.0)
    return gross * (v39.finite(row.get("grossReturn")) - cost_bps / 10_000.0)


def route(candidate, v11_rows, v19_rows, core_rows, reversal_rows, closing_rows, cost_bps, days):
    allowed = set(days)
    maps = {
        "v11": {str(r["day"]): r for r in v11_rows if str(r["day"]) in allowed},
        "v19": {str(r["day"]): r for r in v19_rows if str(r["day"]) in allowed},
        "core": {str(r["day"]): r for r in core_rows if str(r["day"]) in allowed},
        "rev": {str(r["day"]): r for r in reversal_rows if str(r["day"]) in allowed},
        "close": {str(r["day"]): r for r in closing_rows if str(r["day"]) in allowed},
    }
    events=[]; stats=Counter()
    for day in sorted(allowed):
        daily=0.0; next_free=-1; used_symbols=set(); primary=maps["v11"].get(day)
        if primary is not None:
            value=v39.v22.trade_value(primary,cost_bps)
            if value is not None:
                events.append({**primary,"netReturn":value,"route":"V11_EQ_PRIMARY"});stats["V11_EQ_SELECTED"]+=1;daily=value;next_free=int(primary["exitTs"]);used_symbols.add(str(primary.get("symbol")))
            else:stats["V11_EQ_COST_GATE_REJECTED"]+=1
        else:
            core=maps["core"].get(day)
            if core is not None:
                value=v39.v22.trade_value(core,cost_bps)
                if value is not None:
                    events.append({**core,"netReturn":value,"route":"V47_CORE_RESIDUAL"});stats["V47_CORE_RESIDUAL_SELECTED"]+=1;daily=value;next_free=int(core["exitTs"]);used_symbols.add(str(core.get("symbol")))
            if core is None or not any(r.get("day")==day and r.get("route")=="V47_CORE_RESIDUAL" for r in events[-1:]):
                rev=maps["rev"].get(day)
                if rev is not None:
                    if candidate.block_same_symbol and str(rev.get("symbol")) in used_symbols:
                        stats["V47_REVERSAL_SAME_SYMBOL_BLOCKED"]+=1
                    else:
                        value=fractional_value(rev,cost_bps)
                        if value is not None:
                            events.append({**rev,"netReturn":value,"route":"V47_OPEN_REVERSAL_AUX"});stats["V47_OPEN_REVERSAL_AUX_SELECTED"]+=1;daily=value;next_free=int(rev["exitTs"]);used_symbols.add(str(rev.get("symbol")))
                        else:stats["V47_REVERSAL_COST_GATE_REJECTED"]+=1
        fallback=maps["v19"].get(day)
        if fallback is not None and primary is None and daily>-0.02:
            if int(fallback["entryTs"])>=next_free:
                value=v39.v22.trade_value(fallback,cost_bps)
                if value is not None:
                    events.append({**fallback,"netReturn":value,"route":"V19_FALLBACK"});stats["V19_FALLBACK_SELECTED"]+=1;daily=(1+daily)*(1+value)-1;next_free=int(fallback["exitTs"]);used_symbols.add(str(fallback.get("symbol")))
                else:stats["V19_FALLBACK_COST_GATE_REJECTED"]+=1
            else:stats["V19_OVERLAP_BLOCKED"]+=1
        close=maps["close"].get(day)
        if close is not None and daily>-0.02:
            if int(close["entryTs"])<next_free:
                stats["V47_CLOSING_OVERLAP_BLOCKED"]+=1
            elif candidate.block_same_symbol and str(close.get("symbol")) in used_symbols:
                stats["V47_CLOSING_SAME_SYMBOL_BLOCKED"]+=1
            else:
                value=v39.v22.trade_value(close,cost_bps)
                if value is not None:
                    events.append({**close,"netReturn":value,"route":"V47_CLOSING_OVERLAY"});stats["V47_CLOSING_OVERLAY_SELECTED"]+=1
                else:stats["V47_CLOSING_COST_GATE_REJECTED"]+=1
    return sorted(events,key=lambda r:(int(r["entryTs"]),int(r["exitTs"]),str(r["route"]))),dict(stats)


def scenario_set(candidate,rows,days):
    results={};routing={}
    for name,cost in SCENARIOS.items():
        events,stats=route(candidate,cost_bps=cost,days=days,**rows);results[name]=v39.v22.metrics(events);routing[name]=stats
    return results,routing


def audit(candidate,rows,target,development,validation,final,holdout):
    full,routing=scenario_set(candidate,rows,target);dev,devr=scenario_set(candidate,rows,development);val,valr=scenario_set(candidate,rows,validation);fin,_=scenario_set(candidate,rows,final);hol,_=scenario_set(candidate,rows,holdout)
    ne,_=route(candidate,cost_bps=SCENARIOS["NORMAL"],days=target,**rows);pe,_=route(candidate,cost_bps=SCENARIOS["P95"],days=target,**rows);nme,nm=v39.v22.remove_best_month(ne);pme,pm=v39.v22.remove_best_month(pe)
    fn=v39.v22.metrics([r for r in ne if r.get("route")!="V11_EQ_PRIMARY"]);fp=v39.v22.metrics([r for r in pe if r.get("route")!="V11_EQ_PRIMARY"])
    keys=("V47_CORE_RESIDUAL_SELECTED","V47_OPEN_REVERSAL_AUX_SELECTED","V47_CLOSING_OVERLAY_SELECTED");deva=sum(int(devr["NORMAL"].get(k,0)) for k in keys);vala=sum(int(valr["NORMAL"].get(k,0)) for k in keys)
    checks={"developmentNormalAndP95Positive":dev["NORMAL"]["compoundedReturnPct"]>0 and dev["P95"]["compoundedReturnPct"]>0,"validationMinimumEightNormalTrades":val["NORMAL"]["trades"]>=8,"validationMinimumFourAuxTrades":vala>=4,"validationNormalProfitFactorAtLeast1_2":(val["NORMAL"]["profitFactor"] or 0)>=1.2,"validationNormalAndP95Positive":val["NORMAL"]["compoundedReturnPct"]>0 and val["P95"]["compoundedReturnPct"]>0,"finalNormalAndP95Positive":fin["NORMAL"]["compoundedReturnPct"]>0 and fin["P95"]["compoundedReturnPct"]>0,"holdoutMinimumTrades":hol["NORMAL"]["trades"]>=v39.v20.STRICT_HURDLES["minimumHoldoutTrades"],"holdoutNormalAndP95Positive":hol["NORMAL"]["compoundedReturnPct"]>0 and hol["P95"]["compoundedReturnPct"]>0,"normalAboveV22":full["NORMAL"]["compoundedReturnPct"]>v39.BASELINE_NORMAL,"p95AboveV22":full["P95"]["compoundedReturnPct"]>v39.BASELINE_P95,"fallbackNormalAboveV19":fn["compoundedReturnPct"]>v39.BASELINE_FALLBACK_NORMAL,"fallbackP95AboveV19":fp["compoundedReturnPct"]>v39.BASELINE_FALLBACK_P95,"normalProfitFactorAtLeast1_5":(full["NORMAL"]["profitFactor"] or 0)>=1.5,"normalDrawdownNoWorseThanMinus15Pct":full["NORMAL"]["maxDrawdownPct"]>=-15,"normalMinimumFiftyTrades":full["NORMAL"]["trades"]>=50,"positiveProfitConcentrationAtMost40Pct":full["NORMAL"]["maximumPositiveProfitSymbolShare"]<=0.40,"bestTradeRemovedNormalAndP95Positive":v39.v22.metrics(v39.v22.remove_best(ne))["compoundedReturnPct"]>0 and v39.v22.metrics(v39.v22.remove_best(pe))["compoundedReturnPct"]>0,"bestMonthRemovedNormalAndP95Positive":v39.v22.metrics(nme)["compoundedReturnPct"]>0 and v39.v22.metrics(pme)["compoundedReturnPct"]>0,"severeFailClosedNonnegative":full["SEVERE"]["compoundedReturnPct"]>=0}
    return {"full":full,"development":dev,"validation":val,"finalReused":fin,"holdout":hol,"routing":routing,"developmentRouting":devr,"validationRouting":valr,"developmentAuxTrades":deva,"validationAuxTrades":vala,"fallbackFull":{"NORMAL":fn,"P95":fp},"checks":checks,"allStrictHurdlesPassed":all(checks.values()),"robustness":{"normalBestTradeRemoved":v39.v22.metrics(v39.v22.remove_best(ne)),"p95BestTradeRemoved":v39.v22.metrics(v39.v22.remove_best(pe)),"normalBestMonthRemoved":{"month":nm,"metrics":v39.v22.metrics(nme)},"p95BestMonthRemoved":{"month":pm,"metrics":v39.v22.metrics(pme)}}}


def development_pass(r,b):return r["developmentAuxTrades"]>=8 and r["development"]["NORMAL"]["compoundedReturnPct"]>b["development"]["NORMAL"]["compoundedReturnPct"] and r["development"]["P95"]["compoundedReturnPct"]>b["development"]["P95"]["compoundedReturnPct"] and (r["development"]["NORMAL"]["profitFactor"] or 0)>=1.3
def validation_pass(r,b):return r["validation"]["NORMAL"]["trades"]>=8 and r["validationAuxTrades"]>=4 and r["validation"]["NORMAL"]["compoundedReturnPct"]>b["validation"]["NORMAL"]["compoundedReturnPct"] and r["validation"]["P95"]["compoundedReturnPct"]>b["validation"]["P95"]["compoundedReturnPct"] and (r["validation"]["NORMAL"]["profitFactor"] or 0)>=1.2
def score(r,b):return r["validation"]["NORMAL"]["compoundedReturnPct"]-b["validation"]["NORMAL"]["compoundedReturnPct"]+r["validation"]["P95"]["compoundedReturnPct"]-b["validation"]["P95"]["compoundedReturnPct"]+0.2*r["validationAuxTrades"]-0.25*abs(r["validation"]["NORMAL"]["maxDrawdownPct"])


def analyze(cache_root:Path)->dict:
    v39.v14.base.verify_source(v39.v14.base.V11_ROOT,v39.v14.base.V11_SOURCE_SHA);v39.v14.base.verify_source(v39.v14.base.V13_ROOT,v39.v14.base.V13_SOURCE_SHA);v39.v19.configure_exact_data_window()
    days,aligned,adiag=v39.v19.v17.load_all(cache_root/"aligned");warm=[d for d in days if v39.v19.WARMUP_START.date().isoformat()<=d<v39.v19.BT_END_DAY_EXCLUSIVE];market=v39.v14.v11.v9.load_market(cache_root/"aster-market")
    orows,odiag=v39.parse_market(market,warm);crows,cdiag=v46.load_intraday(market,warm);common=[d for d in warm if all(d in orows[s] and d in crows[s] for s in v39.v14.SYMBOLS)];fraw=v39.v14.funding_mod.load_funding(cache_root/"funding");funding={s:v39.v14.funding_mod.funding_points(r) for s,r in fraw.items()}
    af=v39.build_features(common,orows,funding);rf=v40.build_features(common,orows,funding);core=v42.build_trades(CORE,common,rf);target=[d for d in common if v39.v19.BT_START_DAY<=d<v39.v19.BT_END_DAY_EXCLUSIVE];pre=[d for d in target if d<v39.HOLDOUT_START];hold=[d for d in target if d>=v39.HOLDOUT_START];splits=v39.v14.split_days(pre)
    v11,vdiag=v39.v22.build_v11eq(warm,aligned);v19r=v39.v22.build_fallback(warm,aligned);baseline=v39.v22.audit(v11,v19r,target,splits["DEVELOPMENT"],splits["VALIDATION"],splits["FINAL_REUSED"],hold,True)
    reversal_cache={};closing_cache={mode:([] if definition is None else v46.build_trades(definition,common,crows,funding)) for mode,definition in CLOSING.items()};devs=[];diagnostics=[]
    for c in CANDIDATES:
        rev_key=(c.reversal_confirmation_bps,c.reversal_holding_hours,c.reversal_direction,c.reversal_gross)
        if rev_key not in reversal_cache:
            raw=v39.build_trades(reversal_candidate(c),common,af);reversal_cache[rev_key]=filter_reversal(c,raw)
        rows={"v11_rows":v11,"v19_rows":v19r,"core_rows":core,"reversal_rows":reversal_cache[rev_key],"closing_rows":closing_cache[c.closing_mode]};r=audit(c,rows,target,splits["DEVELOPMENT"],splits["VALIDATION"],splits["FINAL_REUSED"],hold)
        diagnostics.append({"candidate":asdict(c),"rawCoreTrades":len(core),"rawReversalTrades":len(reversal_cache[rev_key]),"rawClosingTrades":len(closing_cache[c.closing_mode]),"development":r["development"],"validation":r["validation"],"developmentAuxTrades":r["developmentAuxTrades"],"validationAuxTrades":r["validationAuxTrades"],"full":r["full"],"fallbackFull":r["fallbackFull"],"finalReused":r["finalReused"],"holdout":r["holdout"],"checks":r["checks"]})
        if development_pass(r,baseline):devs.append((c,r))
    devs.sort(key=lambda x:x[1]["development"]["NORMAL"]["compoundedReturnPct"]+x[1]["development"]["P95"]["compoundedReturnPct"],reverse=True);vals=[x for x in devs[:80] if validation_pass(x[1],baseline)];vals.sort(key=lambda x:score(x[1],baseline),reverse=True);winner=vals[0] if vals else None;status="ASTER_ONLY_V47_NO_VALIDATED_THREE_WINDOW_ROUTER";wp=None
    if winner:
        c,r=winner;accepted=r["allStrictHurdlesPassed"];status="ASTER_ONLY_V47_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V47_WINNER_DID_NOT_CLEAR_FINAL_AUDIT";wp={"candidate":asdict(c),"accepted":accepted,"audit":r}
    diagnostics.sort(key=lambda x:x["development"]["NORMAL"]["compoundedReturnPct"]+x["development"]["P95"]["compoundedReturnPct"],reverse=True)
    return v39.v14.rounded({"version":47,"strategyId":STRATEGY_ID,"status":status,"candidateCount":len(CANDIDATES),"developmentSurvivors":len(devs),"validationSurvivors":len(vals),"winner":wp,"baseline":baseline,"core":asdict(CORE),"topDevelopmentDiagnostics":diagnostics[:30],"period":{"startInclusiveUtc":v39.v19.BT_START.isoformat(),"endExclusiveUtc":v39.v19.BT_END_EXCLUSIVE.isoformat(),"calendarDays":365,"targetSessions":len(target),"holdoutSessions":len(hold)},"architecture":{"venue":"ASTER_ONLY","signalSource":"THREE_WINDOW_OPEN_RESIDUAL_REVERSAL_AND_CLOSE","windowsNy":["10:30","12:30","14:30/15:00"],"maximumConcurrentGross":1.0,"maximumConcurrentPositions":1,"sequentialIntradayEntriesAllowed":True,"fractionalReversalGross":True,"v11EqPriority":True,"hyperliquidUsed":False},"selectionDiscipline":{"candidateCountFrozenBeforeExecution":True,"developmentSelectsTopEighty":True,"validationSelectsAtMostOne":True,"finalAndHoldoutUsedForSelection":False,"productionPromotionAllowed":False},"data":{"aligned":adiag,"openData":odiag,"closingData":cdiag,"commonSessions":len(common)},"v11Diagnostics":vdiag,"safety":{"mode":"RESEARCH_ONLY","orderSubmissionAllowed":False,"productionChanged":False,"liveChanged":False,"vpsChanged":False,"cryptoV96Changed":False,"v11EqChanged":False,"v19Changed":False,"v13dProductionChanged":False}})


def report(r):
    lines=["# Aster-only V47 Three-Window Router","",f"Status: **{r['status']}**","",f"Candidates: {r['candidateCount']}",f"Development survivors: {r['developmentSurvivors']}",f"Validation survivors: {r['validationSurvivors']}",""]
    if r["winner"]:
        w=r["winner"];a=w["audit"];lines += [f"Winner: `{w['candidate']['candidate_id']}`",f"Accepted: {w['accepted']}",f"Normal: {a['full']['NORMAL']['compoundedReturnPct']:.6f}%",f"P95: {a['full']['P95']['compoundedReturnPct']:.6f}%",f"Fallback Normal: {a['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%",f"Fallback P95: {a['fallbackFull']['P95']['compoundedReturnPct']:.6f}%",f"Validation auxiliary trades: {a['validationAuxTrades']}",""]
    lines += ["Research only. No Production, LIVE, VPS or order state was changed.",""];return "\n".join(lines)

def main():
    p=argparse.ArgumentParser();p.add_argument("--cache-dir",required=True);p.add_argument("--output-dir",required=True);a=p.parse_args();o=Path(a.output_dir).resolve();o.mkdir(parents=True,exist_ok=True);r=analyze(Path(a.cache_dir).resolve());(o/"result.json").write_text(json.dumps(r,indent=2,ensure_ascii=False)+"\n",encoding="utf-8");(o/"report.md").write_text(report(r),encoding="utf-8");print(json.dumps({"status":r["status"],"developmentSurvivors":r["developmentSurvivors"],"validationSurvivors":r["validationSurvivors"],"winner":r["winner"],"topDevelopmentDiagnostics":r["topDevelopmentDiagnostics"][:5]},indent=2,ensure_ascii=False));return 0
if __name__=="__main__":raise SystemExit(main())
