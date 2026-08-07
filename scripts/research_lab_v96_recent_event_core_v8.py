from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import research_lab_v96_recent_event_core_v6 as v6

UTC=dt.timezone.utc
START_MS,END_MS=v6.START_MS,v6.END_MS
F1_MS,F2_MS,F3_MS=v6.F1_MS,v6.F2_MS,v6.F3_MS
BAR_HOURS,BAR_MS,DAY_MS,GROSS=v6.BAR_HOURS,v6.BAR_MS,v6.DAY_MS,v6.GROSS
BENCHMARK=101.998210
BASE=v6.Config('V8_BASE','SHORT_PULLBACK',10,5.0,8,1.0,0.0,84)

@dataclass(frozen=True)
class Quality:
    config_id:str
    bounce_max:float
    relative_min:float
    volume_floor:float
    current4h_max:float
    cooldown_hours:int
    universe:str

@dataclass
class Position:
    symbol:str;side:int;entry_price:float;entry_ts:int;bars_held:int;max_bars:int


def finite(v,fallback=0.0):
    try:x=float(v)
    except (TypeError,ValueError):return fallback
    return x if math.isfinite(x) else fallback

def compound(vals:Iterable[float])->float:
    e=1.0
    for v in vals:e*=max(0.001,1+float(v))
    return e-1

def rounded(v):
    if isinstance(v,float):return round(v,6)
    if isinstance(v,dict):return {k:rounded(x) for k,x in v.items()}
    if isinstance(v,list):return [rounded(x) for x in v]
    return v

def configs():
    out=[]
    for bmax,rel,vol,cmax,cool,univ in itertools.product((1.5,2.0,3.0,99.0),(0.0,2.0,4.0),(0.0,0.8),(0.0,0.5,1.0,99.0),(0,12,24),('ALL','ALTS')):
        out.append(Quality(f'V8_BMAX{bmax:g}_RW{rel:g}_V{vol:g}_C4{cmax:g}_CD{cool}_{univ}',bmax,rel,vol,cmax,cool,univ))
    return out

def quality_signal(q:Quality,ts:int,mkt:dict):
    item=v6.short_signal(BASE,ts,mkt,False)
    if item is None:return None
    symbol,side,meta=item
    if q.universe=='ALTS' and symbol=='BTC':return None
    bounce=finite(meta.get('bouncePct'));rel=finite(meta.get('relativePct'));vol=finite(meta.get('volumeRatio'));current=finite(meta.get('current4hPct'))
    if bounce>q.bounce_max:return None
    if rel>-q.relative_min:return None
    if vol<q.volume_floor:return None
    if current>q.current4h_max:return None
    return symbol,side,{**meta,'quality':q.config_id}

def simulate(q,mkt,severe=False):
    times=[t for t in mkt['times'] if START_MS<=t<END_MS];pos=None;pending=None;rows=[];entries=[];prev={};cost=50 if severe else 10;adverse=3 if severe else 0;cooldown_until=0
    for ts in times:
        if pos is None and pending is not None and ts>=cooldown_until:
            symbol,side,meta=pending;idx=mkt['indexes'][symbol].get(ts)
            if idx is not None:
                pos=Position(symbol,side,float(mkt['bars'][symbol][idx]['open']),ts,0,84//BAR_HOURS);entries.append({'entryTs':ts,'symbol':symbol,'side':side,**meta})
            pending=None
        weights={};value=0.0
        if pos is not None:
            weights[pos.symbol]=pos.side*GROSS;idx=mkt['indexes'][pos.symbol].get(ts)
            if idx is not None:
                bar=mkt['bars'][pos.symbol][idx];value+=pos.side*GROSS*(float(bar['close'])/float(bar['open'])-1);value-=pos.side*GROSS*mkt['funding'][pos.symbol].get(ts,0.0)
                if severe:value-=GROSS*adverse/10000
        turnover=sum(abs(weights.get(s,0)-prev.get(s,0)) for s in set(weights)|set(prev));value-=turnover*cost/10000;gross=sum(abs(x) for x in weights.values());rows.append({'ts':ts,'return':value,'gross':gross,'maxGross':gross,'regime':-1 if weights else 0});prev=dict(weights)
        if pos is not None:
            pos.bars_held+=1
            if pos.bars_held>=pos.max_bars:
                pos=None;cooldown_until=ts+q.cooldown_hours*v6.HOUR
        if pos is None and pending is None and ts>=cooldown_until:pending=quality_signal(q,ts,mkt)
    return rows,entries

def evaluate(q,mkt):
    n,e=simulate(q,mkt,False);s,se=simulate(q,mkt,True);ranges={'fold1':(START_MS,F1_MS),'fold2':(F1_MS,F2_MS),'fold3':(F2_MS,F3_MS),'lateEvaluation':(F3_MS,END_MS),'full':(START_MS,END_MS)};out={'variantId':q.config_id,'config':asdict(q)}
    for name,(a,b) in ranges.items():out[name]={'normal':v6.metrics(n,e,a,b),'severe':v6.metrics(s,se,a,b)}
    ns=[out[x]['normal'] for x in ('fold1','fold2','fold3')];ss=[out[x]['severe'] for x in ('fold1','fold2','fold3')];pre=compound([finite(x['compoundedReturnPct'])/100 for x in ns])*100;pres=compound([finite(x['compoundedReturnPct'])/100 for x in ss])*100;pn=sum(finite(x['compoundedReturnPct'])>0 for x in ns);ps=sum(finite(x['compoundedReturnPct'])>0 for x in ss);tr=sum(int(x['tradeEpisodes']) for x in ns);worst=min(finite(x['maxDrawdownPct'],-99) for x in ns);apf=sum(min(5,finite(x.get('profitFactor'))) for x in ns)/3;eligible=tr>=12 and pn==3 and ps>=2 and pre>=45 and pres>=15 and worst>=-15 and apf>=1.12;score=pre+0.7*pres+5*(pn+ps)+5*max(0,apf-1)-0.2*abs(worst) if eligible else -1e12;out['preSelection']={'eligible':eligible,'score':score,'compoundedReturnPct':pre,'severeCompoundedReturnPct':pres,'positiveFolds':pn,'positiveSevereFolds':ps,'tradeEpisodes':tr,'worstFoldDrawdownPct':worst,'averageFoldProfitFactor':apf};return out,n,s

def compact(r):return {k:r[k] for k in ('variantId','config','preSelection','fold1','fold2','fold3','lateEvaluation','full')}
def main():
    p=argparse.ArgumentParser();p.add_argument('--output-dir',default='.research-state/v96-v8');a=p.parse_args();o=Path(a.output_dir);o.mkdir(parents=True,exist_ok=True);m=v6.load_market();results=[];replays={}
    for q in configs():
        r,n,s=evaluate(q,m);results.append(r);replays[r['variantId']]=(n,s)
    elig=sorted((r for r in results if r['preSelection']['eligible']),key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True);ranked=sorted(results,key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True);sel=elig[0] if elig else ranked[0];n,s=replays[sel['variantId']];full=sel['full']['normal'];fs=sel['full']['severe'];late=sel['lateEvaluation']['normal'];ls=sel['lateEvaluation']['severe'];latepass=int(late['tradeEpisodes'])>=3 and finite(late['compoundedReturnPct'])>0 and finite(ls['compoundedReturnPct'])>0 and finite(late['maxDrawdownPct'],-99)>=-12 and finite(late.get('profitFactor'))>1.05;beats=finite(full['compoundedReturnPct'])>BENCHMARK and finite(fs['compoundedReturnPct'])>25 and finite(full['maxDrawdownPct'],-99)>=-15 and finite(full.get('profitFactor'))>1.22;status='V96_RECENT_EVENT_CORE_V8_PASS' if sel['preSelection']['eligible'] and latepass and beats else 'V96_RECENT_EVENT_CORE_V8_DIAGNOSTIC';top=sorted(results,key=lambda r:finite(r['full']['normal']['compoundedReturnPct'],-1e12),reverse=True);payload=rounded({'version':8,'strategyId':'V96_RECENT_EVENT_CORE_V8_4H_QUALITY_FILTER','status':status,'architecture':{'barHours':4,'gross':.75,'base':'10d -5%, 8h +1%, short84h','filters':['bounce upper cap','relative weakness','volume floor','current 4h max','cooldown','universe']},'candidateCounts':{'tested':len(results),'eligible':len(elig)},'selected':compact(sel),'selectedPassesLateEvaluation':latepass,'selectedBeats101p998':beats,'topPreSelection':[compact(r) for r in ranked[:20]],'topFullDiagnosticOnly':[compact(r) for r in top[:20]],'selectionPolicy':{'rankingUsesOnlyFirstThreeFolds':True,'lateEvaluationUsedForRanking':False,'fullPeriodUsedForRanking':False},'selectedReplay':{'strategyId':'V96_RECENT_EVENT_CORE_V8_4H_QUALITY_FILTER','variantId':sel['variantId'],'normal':n,'severe':s},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}});(o/'v96-recent-event-core-v8.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':status,'counts':payload['candidateCounts'],'selected':sel['variantId'],'pre':sel['preSelection'],'full':sel['full'],'late':sel['lateEvaluation'],'beats':beats,'latePass':latepass,'bestFullDiagnostic':compact(top[0])},indent=2))
if __name__=='__main__':main()
