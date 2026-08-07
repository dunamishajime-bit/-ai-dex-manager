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

UTC=dt.timezone.utc
START_MS,END_MS=v6.START_MS,v6.END_MS
F1_MS,F2_MS,F3_MS=v6.F1_MS,v6.F2_MS,v6.F3_MS
BAR_MS,DAY_MS=v6.BAR_MS,v6.DAY_MS
BASE_GROSS=0.75
MAX_GROSS=1.25
BENCHMARK=101.998210
A_CFG=v6.Config('A4H_EXACT','SHORT_PULLBACK',10,5.0,8,1.0,0.0,84)

@dataclass(frozen=True)
class SizeConfig:
    config_id:str
    lookback_days:int
    weak_threshold_pct:float
    weak_gross:float
    strong_threshold_pct:float
    strong_gross:float
    dd_threshold_pct:float
    dd_gross:float

@dataclass
class Position:
    symbol:str;side:int;entry_ts:int;bars_held:int;max_bars:int;allocated_gross:float


def finite(v:Any,fallback=0.0)->float:
    try:x=float(v)
    except (TypeError,ValueError):return fallback
    return x if math.isfinite(x) else fallback

def compound(vals:Iterable[float])->float:
    e=1.0
    for v in vals:e*=max(0.001,1+float(v))
    return e-1
def pf(vals:Sequence[float]):
    w=sum(v for v in vals if v>0);l=-sum(v for v in vals if v<0)
    return w/l if l>1e-15 else (999.0 if w>0 else None)
def rounded(v):
    if isinstance(v,float):return round(v,6)
    if isinstance(v,dict):return {k:rounded(x) for k,x in v.items()}
    if isinstance(v,list):return [rounded(x) for x in v]
    return v

def configs():
    out=[]
    for lb,weak,wg,strong,sg,dd,dg in itertools.product(
        (15,30,45,60),
        (-2.0,0.0,2.0),
        (0.0,0.25,0.50),
        (3.0,5.0,8.0,12.0),
        (0.90,1.00,1.25),
        (-4.0,-6.0,-8.0),
        (0.0,0.25,0.50),
    ):
        # Bound surface deterministically while retaining all 15/30d variants.
        sig=lb*3+int((weak+3)*10)*5+int(wg*100)*7+int(strong)*11+int(sg*100)*13+int(abs(dd))*17+int(dg*100)*19
        if lb>=45 and sig%2:continue
        out.append(SizeConfig(f'V12_LB{lb}_W{weak:g}_WG{wg:g}_S{strong:g}_SG{sg:g}_DD{dd:g}_DG{dg:g}',lb,weak,wg,strong,sg,dd,dg))
    return out

def build_opportunities(market):
    out=[]
    for ts in market['times']:
        if not (START_MS<=ts<END_MS-BAR_MS):continue
        item=v6.short_signal(A_CFG,ts,market,False)
        if item is None:continue
        symbol,side,meta=item
        out.append(v10.Opportunity('A4H',ts,ts+BAR_MS,symbol,side,84,meta))
    return out

def trailing(rows,ts,days):
    start=ts-days*DAY_MS;vals=[float(r['return']) for r in rows if start<=int(r['ts'])<ts]
    if not vals:return 0.0,0.0
    ret=compound(vals)*100;eq=peak=1.0;dd=0.0
    for value in vals:
        eq*=max(0.001,1+value);peak=max(peak,eq);dd=min(dd,eq/peak-1)
    return ret,dd*100

def size_for(cfg,shadow,ts):
    ret,dd=trailing(shadow,ts,cfg.lookback_days)
    gross=BASE_GROSS;state='NORMAL'
    if dd<=cfg.dd_threshold_pct:
        gross=cfg.dd_gross;state='DD'
    elif ret<=cfg.weak_threshold_pct:
        gross=cfg.weak_gross;state='WEAK'
    elif ret>=cfg.strong_threshold_pct:
        gross=cfg.strong_gross;state='STRONG'
    return max(0.0,min(MAX_GROSS,gross)),ret,dd,state

def simulate(cfg,market,opps,shadow,severe=False):
    by_entry={}
    for opp in opps:by_entry.setdefault(opp.entry_ts,[]).append(opp)
    times=[ts for ts in market['times'] if START_MS<=ts<END_MS];pos=None;rows=[];entries=[];prev={};cost=50 if severe else 10;adverse=3 if severe else 0
    for ts in times:
        if pos is None and by_entry.get(ts):
            opp=max(by_entry[ts],key=lambda x:(finite(x.meta.get('score',x.meta.get('signalScore',0))),x.symbol));gross,trail_ret,trail_dd,state=size_for(cfg,shadow,ts)
            if gross>0:
                pos=Position(opp.symbol,opp.side,ts,0,max(1,opp.hold_hours//4),gross);entries.append({'entryTs':ts,'symbol':opp.symbol,'gross':gross,'sizeState':state,'trailingReturnPct':trail_ret,'trailingDDPct':trail_dd,**opp.meta})
        weights={};value=0.0
        if pos is not None:
            weights[pos.symbol]=pos.side*pos.allocated_gross;idx=market['indexes'][pos.symbol].get(ts)
            if idx is not None:
                bar=market['bars'][pos.symbol][idx];value+=pos.side*pos.allocated_gross*(float(bar['close'])/float(bar['open'])-1);value-=pos.side*pos.allocated_gross*market['funding'][pos.symbol].get(ts,0.0)
                if severe:value-=pos.allocated_gross*adverse/10000
        turnover=sum(abs(weights.get(s,0)-prev.get(s,0)) for s in set(weights)|set(prev));value-=turnover*cost/10000;gross_now=sum(abs(v) for v in weights.values());rows.append({'ts':ts,'return':value,'gross':gross_now,'maxGross':gross_now,'regime':-1 if weights else 0});prev=dict(weights)
        if pos is not None:
            pos.bars_held+=1
            if pos.bars_held>=pos.max_bars:pos=None
    return rows,entries

def metrics(rows,entries,start,end):
    act=[r for r in rows if start<=int(r['ts'])<end];vals=[float(r['return']) for r in act];eq=peak=1.0;dd=0;months={}
    for r in act:
        eq*=max(0.001,1+float(r['return']));peak=max(peak,eq);dd=min(dd,eq/peak-1);key=dt.datetime.fromtimestamp(int(r['ts'])/1000,tz=UTC).strftime('%Y-%m');months.setdefault(key,[]).append(float(r['return']))
    monthly={k:compound(v)*100 for k,v in months.items()};years=max(1e-9,(end-start)/(365.25*DAY_MS));window_entries=[e for e in entries if start<=int(e['entryTs'])<end]
    return {'tradeEpisodes':len(window_entries),'compoundedReturnPct':(eq-1)*100,'cagrPct':(eq**(1/years)-1)*100 if eq>0 else None,'maxDrawdownPct':dd*100,'profitFactor':pf(vals),'positiveMonthRatio':sum(v>0 for v in monthly.values())/len(monthly) if monthly else 0,'monthlyReturnsPct':monthly,'averageAllocatedGross':sum(float(e['gross']) for e in window_entries)/len(window_entries) if window_entries else 0,'maxAllocatedGross':max((float(e['gross']) for e in window_entries),default=0)}
def evaluate(cfg,market,opps,shadow):
    n,e=simulate(cfg,market,opps,shadow,False);s,se=simulate(cfg,market,opps,shadow,True);ranges={'fold1':(START_MS,F1_MS),'fold2':(F1_MS,F2_MS),'fold3':(F2_MS,F3_MS),'lateEvaluation':(F3_MS,END_MS),'full':(START_MS,END_MS)};out={'variantId':cfg.config_id,'config':asdict(cfg)}
    for name,(a,b) in ranges.items():out[name]={'normal':metrics(n,e,a,b),'severe':metrics(s,se,a,b)}
    ns=[out[x]['normal'] for x in ('fold1','fold2','fold3')];ss=[out[x]['severe'] for x in ('fold1','fold2','fold3')];pre=compound([finite(x['compoundedReturnPct'])/100 for x in ns])*100;pres=compound([finite(x['compoundedReturnPct'])/100 for x in ss])*100;pn=sum(finite(x['compoundedReturnPct'])>0 for x in ns);ps=sum(finite(x['compoundedReturnPct'])>0 for x in ss);tr=sum(int(x['tradeEpisodes']) for x in ns);worst=min(finite(x['maxDrawdownPct'],-99) for x in ns);apf=sum(min(5,finite(x.get('profitFactor'))) for x in ns)/3;eligible=tr>=10 and pn==3 and ps>=2 and pre>=55 and pres>=20 and worst>=-15 and apf>=1.15;score=pre+0.7*pres+5*(pn+ps)+5*max(0,apf-1)-0.2*abs(worst) if eligible else -1e12;out['preSelection']={'eligible':eligible,'score':score,'compoundedReturnPct':pre,'severeCompoundedReturnPct':pres,'positiveFolds':pn,'positiveSevereFolds':ps,'tradeEpisodes':tr,'worstFoldDrawdownPct':worst,'averageFoldProfitFactor':apf};return out,n,s,e
def compact(r):return {k:r[k] for k in ('variantId','config','preSelection','fold1','fold2','fold3','lateEvaluation','full')}
def main():
    p=argparse.ArgumentParser();p.add_argument('--output-dir',default='.research-state/v96-v12');a=p.parse_args();o=Path(a.output_dir);o.mkdir(parents=True,exist_ok=True);market=v6.load_market();opps=build_opportunities(market);shadow,shadow_entries=v10.simulate_shadow(opps,market,False);results=[];replays={};entry_ledgers={}
    for cfg in configs():
        r,n,s,e=evaluate(cfg,market,opps,shadow);results.append(r);replays[r['variantId']]=(n,s);entry_ledgers[r['variantId']]=e
    eligible=sorted((r for r in results if r['preSelection']['eligible']),key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True);ranked=sorted(results,key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True);sel=eligible[0] if eligible else ranked[0];n,s=replays[sel['variantId']];full=sel['full']['normal'];fs=sel['full']['severe'];late=sel['lateEvaluation']['normal'];ls=sel['lateEvaluation']['severe'];latepass=int(late['tradeEpisodes'])>=2 and finite(late['compoundedReturnPct'])>0 and finite(ls['compoundedReturnPct'])>0 and finite(late['maxDrawdownPct'],-99)>=-12 and finite(late.get('profitFactor'))>1.05;beats=finite(full['compoundedReturnPct'])>BENCHMARK and finite(fs['compoundedReturnPct'])>25 and finite(full['maxDrawdownPct'],-99)>=-15 and finite(full.get('profitFactor'))>1.22;status='V96_RECENT_EVENT_CORE_V12_PASS' if sel['preSelection']['eligible'] and latepass and beats else 'V96_RECENT_EVENT_CORE_V12_DIAGNOSTIC';top=sorted(results,key=lambda r:finite(r['full']['normal']['compoundedReturnPct'],-1e12),reverse=True);payload=rounded({'version':12,'strategyId':'V96_RECENT_EVENT_CORE_V12_ADAPTIVE_GROSS','status':status,'architecture':{'baseSignal':'A4H exact +101.998% event core','shadowGross':BASE_GROSS,'runtimeGrossRange':[0,MAX_GROSS],'sizing':'past 15/30/45/60d shadow return and DD only','sameSizingNormalSevere':True},'benchmark':{'fixedGrossDiagnosticPct':BENCHMARK},'shadowFixedGross':metrics(shadow,shadow_entries,START_MS,END_MS),'candidateCounts':{'tested':len(results),'eligible':len(eligible)},'selected':compact(sel),'selectedEntryLedger':entry_ledgers[sel['variantId']],'selectedPassesLateEvaluation':latepass,'selectedBeats101p998':beats,'topPreSelection':[compact(r) for r in ranked[:25]],'topFullDiagnosticOnly':[compact(r) for r in top[:25]],'selectionPolicy':{'rankingUsesOnlyFirstThreeFolds':True,'lateEvaluationUsedForRanking':False,'fullPeriodUsedForRanking':False,'sizingUsesOnlyPastShadowReturnsAtEntry':True},'selectedReplay':{'strategyId':'V96_RECENT_EVENT_CORE_V12_ADAPTIVE_GROSS','variantId':sel['variantId'],'normal':n,'severe':s},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}});(o/'v96-recent-event-core-v12.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':status,'fixed':payload['shadowFixedGross'],'counts':payload['candidateCounts'],'selected':sel['variantId'],'pre':sel['preSelection'],'full':sel['full'],'late':sel['lateEvaluation'],'beats':beats,'latePass':latepass,'bestFullDiagnostic':compact(top[0])},indent=2))
if __name__=='__main__':main()
