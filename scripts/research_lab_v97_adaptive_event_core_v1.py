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
BAR_MS, DAY_MS = v6.BAR_MS, v6.DAY_MS
BASE_GROSS = 0.75
MAX_GROSS = 1.25
TARGET_RETURN_PCT = 101.998210
TARGET_TRADES = 50
BASE_CFG = v6.Config('V97_A4H_BASE','SHORT_PULLBACK',10,5.0,8,1.0,0.0,84)

@dataclass(frozen=True)
class ControlConfig:
    config_id: str
    lookback_days: int
    weak_return_pct: float
    weak_gross: float
    strong_return_pct: float
    strong_gross: float
    dd_trigger_pct: float
    dd_gross: float
    recent_trades: int
    min_recent_ewma_pct: float
    loss_streak_limit: int
    loss_streak_gross: float

@dataclass
class FrozenPosition:
    symbol: str
    side: int
    bars_held: int
    max_bars: int
    gross: float


def finite(value: Any, fallback: float = 0.0) -> float:
    try: x = float(value)
    except (TypeError, ValueError): return fallback
    return x if math.isfinite(x) else fallback


def compound(values: Iterable[float]) -> float:
    eq = 1.0
    for value in values: eq *= max(0.001, 1.0 + float(value))
    return eq - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    wins = sum(v for v in values if v > 0); losses = -sum(v for v in values if v < 0)
    return wins / losses if losses > 1e-15 else (999.0 if wins > 0 else None)


def rounded(value: Any):
    if isinstance(value, float): return round(value, 6)
    if isinstance(value, dict): return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list): return [rounded(v) for v in value]
    return value


def configs() -> List[ControlConfig]:
    out = [ControlConfig('V97_FIXED_075',30,-999.0,BASE_GROSS,999.0,BASE_GROSS,-999.0,BASE_GROSS,3,-999.0,99,BASE_GROSS)]
    for lb,wr,wg,sr,sg,dd,dg,n,rmin,sl,lg in itertools.product(
        (15,30,45),(0.0,2.0),(0.0,0.25,0.50),(5.0,8.0,12.0),(0.90,1.00,1.25),
        (-4.0,-6.0,-8.0),(0.0,0.25,0.50),(3,5),(-0.5,0.0,0.5),(2,3),(0.0,0.25,0.50)):
        sig = lb*3+int(wr*10)*5+int(wg*100)*7+int(sr)*11+int(sg*100)*13+int(abs(dd))*17+int(dg*100)*19+n*23+int((rmin+1)*10)*29+sl*31+int(lg*100)*37
        if sig % 97 not in (0,1,2,3): continue
        out.append(ControlConfig(f'V97_LB{lb}_WR{wr:g}_WG{wg:g}_SR{sr:g}_SG{sg:g}_DD{dd:g}_DG{dg:g}_N{n}_RM{rmin:g}_LS{sl}_LG{lg:g}',lb,wr,wg,sr,sg,dd,dg,n,rmin,sl,lg))
    return out


def build_parity(market: dict):
    nr, ne = v6.simulate(BASE_CFG, market, False); sr, se = v6.simulate(BASE_CFG, market, True)
    nm = v6.metrics(nr, ne, START_MS, END_MS); sm = v6.metrics(sr, se, START_MS, END_MS)
    same = [(int(a['entryTs']),a['symbol'],int(a['side'])) for a in ne] == [(int(a['entryTs']),a['symbol'],int(a['side'])) for a in se]
    if int(nm['tradeEpisodes']) != TARGET_TRADES or abs(finite(nm['compoundedReturnPct'])-TARGET_RETURN_PCT) > 0.00001 or not same:
        raise RuntimeError(f'V97_BASE_PARITY_FAILED trades={nm["tradeEpisodes"]} return={nm["compoundedReturnPct"]} same={same}')
    schedule=[]
    for row in ne:
        schedule.append({'entryTs':int(row['entryTs']),'exitTs':int(row['entryTs'])+int(BASE_CFG.hold_hours//v6.BAR_HOURS)*BAR_MS,'symbol':row['symbol'],'side':int(row['side']),'holdHours':BASE_CFG.hold_hours,'signal':{k:row[k] for k in ('score','signalFamily','movePct','bouncePct','current4hPct','relativePct','volumeRatio') if k in row}})
    return nr, sr, schedule, nm, sm


def trade_ledger(schedule: Sequence[dict], market: dict) -> List[dict]:
    out=[]
    for item in schedule:
        s=item['symbol']; side=int(item['side']); a=int(item['entryTs']); b=int(item['exitTs'])
        ia=market['indexes'][s].get(a); ib=market['indexes'][s].get(b)
        if ia is None or ib is None: raise RuntimeError(f'V97_LEDGER_PRICE_MISSING {s} {a} {b}')
        ep=float(market['bars'][s][ia]['open']); xp=float(market['bars'][s][ib]['open']); funding=0.0; ts=a
        while ts < b:
            funding += -side*BASE_GROSS*market['funding'][s].get(ts,0.0); ts += BAR_MS
        net = side*BASE_GROSS*(xp/ep-1.0)+funding-2.0*BASE_GROSS*10.0/10000.0
        out.append({**item,'shadowReturn':net,'shadowReturnPct':net*100.0})
    return out


def trailing(rows: Sequence[dict], ts: int, days: int) -> Tuple[float,float]:
    vals=[finite(r['return']) for r in rows if ts-days*DAY_MS <= int(r['ts']) < ts]
    if not vals: return 0.0,0.0
    eq=peak=1.0; dd=0.0
    for v in vals:
        eq*=max(0.001,1+v); peak=max(peak,eq); dd=min(dd,eq/peak-1.0)
    return (eq-1.0)*100.0,dd*100.0


def recent(ledger: Sequence[dict], ts: int, n: int) -> dict:
    rows=[r for r in ledger if int(r['exitTs']) <= ts][-n:]
    if not rows: return {'sample':0,'ewmaPct':0.0,'lossStreak':0,'profitFactor':None}
    vals=[finite(r['shadowReturn']) for r in rows]; weights=list(range(1,len(vals)+1)); ewma=sum(v*w for v,w in zip(vals,weights))/sum(weights)*100.0
    streak=0
    for v in reversed(vals):
        if v < 0: streak += 1
        else: break
    return {'sample':len(vals),'ewmaPct':ewma,'lossStreak':streak,'profitFactor':profit_factor(vals)}


def gross_for(cfg: ControlConfig, shadow: Sequence[dict], ledger: Sequence[dict], ts: int):
    if cfg.config_id == 'V97_FIXED_075': return BASE_GROSS,{'state':'FIXED','gross':BASE_GROSS}
    ret,dd=trailing(shadow,ts,cfg.lookback_days); stat=recent(ledger,ts,cfg.recent_trades); gross=BASE_GROSS; state='NORMAL'
    if dd <= cfg.dd_trigger_pct: gross=cfg.dd_gross; state='DD'
    elif stat['sample'] >= min(3,cfg.recent_trades) and stat['lossStreak'] >= cfg.loss_streak_limit: gross=cfg.loss_streak_gross; state='LOSS_STREAK'
    elif stat['sample'] >= min(3,cfg.recent_trades) and stat['ewmaPct'] < cfg.min_recent_ewma_pct: gross=min(cfg.weak_gross,BASE_GROSS); state='RECENT_WEAK'
    elif ret <= cfg.weak_return_pct: gross=cfg.weak_gross; state='ROLLING_WEAK'
    elif ret >= cfg.strong_return_pct and stat['ewmaPct'] > max(0.0,cfg.min_recent_ewma_pct): gross=cfg.strong_gross; state='STRONG'
    gross=max(0.0,min(MAX_GROSS,gross))
    return gross,{'state':state,'gross':gross,'trailingReturnPct':ret,'trailingDDPct':dd,'recentTradeStats':stat}


def simulate(schedule: Sequence[dict], cfg: ControlConfig, market: dict, shadow: Sequence[dict], ledger: Sequence[dict], cost: float, adverse: float):
    by_entry={int(x['entryTs']):x for x in schedule}; times=[t for t in market['times'] if START_MS <= t < END_MS]; pos: Optional[FrozenPosition]=None; rows=[]; entries=[]; prev: Dict[str,float]={}
    for ts in times:
        if pos is None and ts in by_entry:
            item=by_entry[ts]; gross,ctrl=gross_for(cfg,shadow,ledger,ts); pos=FrozenPosition(item['symbol'],int(item['side']),0,max(1,int(item['holdHours'])//v6.BAR_HOURS),gross); entries.append({**item,'allocatedGross':gross,'executed':gross>0,'controller':ctrl})
        w={}; value=0.0
        if pos is not None and pos.gross > 0:
            w[pos.symbol]=pos.side*pos.gross; idx=market['indexes'][pos.symbol].get(ts)
            if idx is not None:
                bar=market['bars'][pos.symbol][idx]; value += pos.side*pos.gross*(float(bar['close'])/float(bar['open'])-1.0); value -= pos.side*pos.gross*market['funding'][pos.symbol].get(ts,0.0); value -= pos.gross*adverse/10000.0
        turnover=sum(abs(w.get(s,0.0)-prev.get(s,0.0)) for s in set(w)|set(prev)); value -= turnover*cost/10000.0; gross_now=sum(abs(x) for x in w.values()); rows.append({'ts':ts,'return':value,'gross':gross_now,'maxGross':gross_now,'regime':-1 if w else 0}); prev=dict(w)
        if pos is not None:
            pos.bars_held += 1
            if pos.bars_held >= pos.max_bars: pos=None
    return rows,entries


def metrics(rows: Sequence[dict], entries: Sequence[dict], start: int, end: int) -> dict:
    active=[r for r in rows if start <= int(r['ts']) < end]; vals=[finite(r['return']) for r in active]; eq=peak=1.0; dd=0.0; months: Dict[str,List[float]]={}
    for r in active:
        v=finite(r['return']); eq*=max(0.001,1+v); peak=max(peak,eq); dd=min(dd,eq/peak-1.0); key=dt.datetime.fromtimestamp(int(r['ts'])/1000,tz=UTC).strftime('%Y-%m'); months.setdefault(key,[]).append(v)
    monthly={k:compound(v)*100.0 for k,v in months.items()}; scheduled=[e for e in entries if start <= int(e['entryTs']) < end]; actual=[e for e in scheduled if bool(e.get('executed',True))]; years=max(1e-9,(end-start)/(365.25*DAY_MS))
    return {'tradeEpisodes':len(actual),'scheduledEpisodes':len(scheduled),'compoundedReturnPct':(eq-1.0)*100.0,'cagrPct':(eq**(1.0/years)-1.0)*100.0 if eq>0 else None,'maxDrawdownPct':dd*100.0,'profitFactor':profit_factor(vals),'positiveMonthRatio':sum(v>0 for v in monthly.values())/len(monthly) if monthly else 0.0,'monthlyReturnsPct':monthly,'averageAllocatedGross':sum(finite(e['allocatedGross']) for e in scheduled)/len(scheduled) if scheduled else 0.0,'maxAllocatedGross':max((finite(e['allocatedGross']) for e in scheduled),default=0.0)}


def parity(reference: Sequence[dict], replay: Sequence[dict]) -> dict:
    if len(reference) != len(replay): return {'sameLength':False,'maxAbsReturnDelta':None,'sameGross':False}
    return {'sameLength':True,'maxAbsReturnDelta':max((abs(finite(a['return'])-finite(b['return'])) for a,b in zip(reference,replay)),default=0.0),'sameGross':all(abs(finite(a.get('gross'))-finite(b.get('gross'))) <= 1e-12 for a,b in zip(reference,replay))}


def evaluate(cfg: ControlConfig, market: dict, schedule: Sequence[dict], shadow: Sequence[dict], ledger: Sequence[dict]):
    scenarios={'normal':(10.0,0.0),'moderate':(25.0,1.0),'severe':(50.0,3.0),'extreme':(75.0,5.0)}; replay={}; entries={}
    for name,(cost,adverse) in scenarios.items(): replay[name],entries[name]=simulate(schedule,cfg,market,shadow,ledger,cost,adverse)
    ranges={'fold1':(START_MS,F1_MS),'fold2':(F1_MS,F2_MS),'fold3':(F2_MS,F3_MS),'lateEvaluation':(F3_MS,END_MS),'full':(START_MS,END_MS)}; out={'variantId':cfg.config_id,'config':asdict(cfg)}
    for rn,(a,b) in ranges.items(): out[rn]={name:metrics(replay[name],entries[name],a,b) for name in scenarios}
    ns=[out[x]['normal'] for x in ('fold1','fold2','fold3')]; ss=[out[x]['severe'] for x in ('fold1','fold2','fold3')]; pre=compound([finite(x['compoundedReturnPct'])/100 for x in ns])*100; pres=compound([finite(x['compoundedReturnPct'])/100 for x in ss])*100; pn=sum(finite(x['compoundedReturnPct'])>0 for x in ns); ps=sum(finite(x['compoundedReturnPct'])>0 for x in ss); worst=min(finite(x['maxDrawdownPct'],-99) for x in ns); apf=sum(min(5,finite(x.get('profitFactor'))) for x in ns)/3; trades=sum(int(x['tradeEpisodes']) for x in ns)
    eligible=trades>=18 and pn==3 and ps>=2 and pre>=65 and pres>=20 and worst>=-15 and apf>=1.15; score=pre+0.65*pres+5*(pn+ps)+5*max(0,apf-1)-0.25*abs(worst) if eligible else -1e12; out['preSelection']={'eligible':eligible,'score':score,'compoundedReturnPct':pre,'severeCompoundedReturnPct':pres,'positiveFolds':pn,'positiveSevereFolds':ps,'tradeEpisodes':trades,'worstFoldDrawdownPct':worst,'averageFoldProfitFactor':apf}
    return out,replay,entries


def compact(r: dict): return {k:r[k] for k in ('variantId','config','preSelection','fold1','fold2','fold3','lateEvaluation','full')}


def main():
    p=argparse.ArgumentParser(); p.add_argument('--output-dir',default='.research-state/v97'); args=p.parse_args(); outdir=Path(args.output_dir); outdir.mkdir(parents=True,exist_ok=True); market=v6.load_market(); base,base_severe,schedule,base_metrics,base_severe_metrics=build_parity(market); ledger=trade_ledger(schedule,market)
    fixed=configs()[0]; fr,fe=simulate(schedule,fixed,market,base,ledger,10,0); fs,fse=simulate(schedule,fixed,market,base,ledger,50,3); pn=parity(base,fr); ps=parity(base_severe,fs); fm=metrics(fr,fe,START_MS,END_MS); parity_ok=pn['sameLength'] and pn['maxAbsReturnDelta']<=1e-12 and pn['sameGross'] and ps['sameLength'] and ps['maxAbsReturnDelta']<=1e-12 and ps['sameGross'] and fm['tradeEpisodes']==TARGET_TRADES and abs(finite(fm['compoundedReturnPct'])-TARGET_RETURN_PCT)<=0.00001
    if not parity_ok: raise RuntimeError(f'V97_FROZEN_REPLAY_PARITY_FAILED normal={pn} severe={ps} metrics={fm}')
    results=[]; replays={}; ledgers={}
    for cfg in configs():
        r,rp,en=evaluate(cfg,market,schedule,base,ledger); results.append(r); replays[cfg.config_id]=rp; ledgers[cfg.config_id]=en['normal']
    eligible=sorted((r for r in results if r['preSelection']['eligible']),key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True); ranked=sorted(results,key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True); sel=eligible[0] if eligible else ranked[0]; full=sel['full']['normal']; sev=sel['full']['severe']; ext=sel['full']['extreme']; late=sel['lateEvaluation']['normal']; lsev=sel['lateEvaluation']['severe']; late_pass=int(late['tradeEpisodes'])>=2 and finite(late['compoundedReturnPct'])>0 and finite(lsev['compoundedReturnPct'])>0 and finite(late['maxDrawdownPct'],-99)>=-12 and finite(late.get('profitFactor'))>1.05; full_pass=finite(full['compoundedReturnPct'])>TARGET_RETURN_PCT and finite(full['maxDrawdownPct'],-99)>=-15 and finite(full.get('profitFactor'))>1.22 and finite(sev['compoundedReturnPct'])>25 and finite(sev['maxDrawdownPct'],-99)>=-22 and finite(ext['compoundedReturnPct'])>0; status='V97_RESEARCH_PASS' if sel['preSelection']['eligible'] and late_pass and full_pass else 'V97_RESEARCH_DIAGNOSTIC'; top=sorted(results,key=lambda r:finite(r['full']['normal']['compoundedReturnPct'],-1e12),reverse=True)
    payload=rounded({'version':1,'strategyId':'V97_ADAPTIVE_EVENT_CORE_V1','status':status,'architecture':{'primaryCore':'V6 exact A4H SHORT_PULLBACK L10 D5 B8 +1 H84','frozenSchedule':True,'baseGross':BASE_GROSS,'maxGross':MAX_GROSS,'router':'V11-derived past-only weakness/loss-streak Cash-or-reduce control','dynamicGross':'V12-derived rolling shadow return/DD sizing','onePositionMaximum':True,'sameControllerNormalStress':True,'fundingIncluded':True,'signalOnCompleted4hBarEntryNext4hOpen':True},'parityGate':{'expectedTrades':TARGET_TRADES,'expectedReturnPct':TARGET_RETURN_PCT,'baseNormal':base_metrics,'baseSevere':base_severe_metrics,'fixedReplay':fm,'normalRowParity':pn,'severeRowParity':ps,'passed':parity_ok},'candidateCounts':{'tested':len(results),'eligible':len(eligible)},'selected':compact(sel),'selectedEntryLedger':ledgers[sel['variantId']],'selectedPassesLateEvaluation':late_pass,'selectedPassesFullAcceptance':full_pass,'topPreSelection':[compact(r) for r in ranked[:25]],'topFullDiagnosticOnly':[compact(r) for r in top[:25]],'selectionPolicy':{'rankingUsesOnlyFirstThreeFolds':True,'lateEvaluationUsedForRanking':False,'fullPeriodUsedForRanking':False,'futureDataInController':False,'controllerUsesFrozenNormalShadowOnly':True},'selectedReplay':{'variantId':sel['variantId'],**replays[sel['variantId']]},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}); (outdir/'v97-research.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n'); (outdir/'v97-frozen-schedule.json').write_text(json.dumps(rounded(schedule),ensure_ascii=False,indent=2)+'\n'); (outdir/'v97-research.md').write_text('\n'.join(['# V97 Adaptive Event Core V1 — Research','',f'- Status: **{status}**',f'- Parity: **{parity_ok}** / {fm["tradeEpisodes"]} trades / {fm["compoundedReturnPct"]:.6f}%',f'- Tested: **{len(results)}** / eligible: **{len(eligible)}**',f'- Selected: **{sel["variantId"]}**',f'- Full Normal: **{full["compoundedReturnPct"]:.6f}%** / DD **{full["maxDrawdownPct"]:.6f}%** / PF **{finite(full.get("profitFactor")):.6f}**',f'- Full Severe: **{sev["compoundedReturnPct"]:.6f}%** / DD **{sev["maxDrawdownPct"]:.6f}%**',f'- Full Extreme: **{ext["compoundedReturnPct"]:.6f}%** / DD **{ext["maxDrawdownPct"]:.6f}%**',f'- Late Normal: **{late["compoundedReturnPct"]:.6f}%** / Severe **{lsev["compoundedReturnPct"]:.6f}%**',f'- Late gate: **{late_pass}** / Full gate: **{full_pass}**','','Selection uses only folds 1–3. 2026-06-01 onward is opened only after selection.','No LIVE, VPS, production, approval, order, or position state is changed.'])+'\n'); print(json.dumps({'status':status,'parity':payload['parityGate'],'candidateCounts':payload['candidateCounts'],'selected':sel['variantId'],'pre':sel['preSelection'],'full':sel['full'],'late':sel['lateEvaluation'],'latePass':late_pass,'fullPass':full_pass,'bestFullDiagnostic':compact(top[0])},indent=2))

if __name__=='__main__': main()
