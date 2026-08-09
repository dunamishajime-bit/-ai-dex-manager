from __future__ import annotations
import json, math, os, statistics
from dataclasses import dataclass, asdict
from pathlib import Path

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_nextgen_independent_families_v49 as core

STRATEGY_ID='STATE_TRANSITION_V55'
SYMS=['BTC','ETH','BNB','SOL','LINK','AVAX']; ALTS=SYMS[1:]; HOUR=3_600_000
PERIODS={'development':(v4.START_2023,v4.START_2024),'validation':(v4.START_2024,v4.START_2025),'confirmation':(v4.START_2025,v4.START_2026),'holdout':(v4.START_2026,v4.END)}

@dataclass(frozen=True)
class V:
    family:str; variant_id:str; p:dict

def ret(c,s,i,h): return None if i-h<0 else (c[s][i]/c[s][i-h]-1)*100

def logrets(c,s,i,h):
    if i-h<0:return []
    return [math.log(c[s][j]/c[s][j-1]) for j in range(i-h+1,i+1) if c[s][j-1]>0]

def vol(c,s,i,h):
    x=logrets(c,s,i,h); return statistics.pstdev(x)*math.sqrt(24*365)*100 if len(x)>=12 else None

def corr(c,a,b,i,h):
    x=logrets(c,a,i,h); y=logrets(c,b,i,h); n=min(len(x),len(y))
    if n<24:return None
    x=x[-n:]; y=y[-n:]; mx=statistics.fmean(x); my=statistics.fmean(y)
    dx=sum((z-mx)**2 for z in x); dy=sum((z-my)**2 for z in y)
    return None if dx<=1e-15 or dy<=1e-15 else sum((x[k]-mx)*(y[k]-my) for k in range(n))/math.sqrt(dx*dy)

def norm(w,g):
    z=sum(abs(x) for x in w.values()); return {} if z<=1e-12 else {s:x*g/z for s,x in w.items() if abs(x)>1e-12}

def expand(times,sig):
    cur={}; out={}
    for t in times:
        if t in sig:cur=sig[t]
        out[t]=cur
    return out

def vol_transition(v,t,c,f):
    p=v.p; o={}
    for i,ts in enumerate(t):
        if ts<v4.START_2023 or i<max(p['long'],p['short'],p['mom'])+2 or (ts//HOUR)%p['step']:continue
        prev=vol(c,'BTC',i-p['confirm'],p['short']); now=vol(c,'BTC',i,p['short']); base=vol(c,'BTC',i,p['long']); m=ret(c,'BTC',i,p['mom'])
        if None in (prev,now,base,m):continue
        crossed=prev/base<p['lowRatio'] and now/base>p['highRatio']
        if not crossed:o[ts]={};continue
        vals=[(ret(c,s,i,p['mom']) or -999,s) for s in SYMS]; vals.sort(reverse=True)
        if m>p['dir']: o[ts]=norm({vals[0][1]:1},p['gross'])
        elif m<-p['dir']: o[ts]={'BTC':-p['gross']}
        else:o[ts]={}
    return expand(t,o)

def correlation_break(v,t,c,f):
    p=v.p;o={}
    for i,ts in enumerate(t):
        if ts<v4.START_2023 or i<p['long']+p['confirm']+2 or (ts//HOUR)%p['step']:continue
        cs=[corr(c,s,'BTC',i,p['short']) for s in ALTS]; cl=[corr(c,s,'BTC',i,p['long']) for s in ALTS]
        cs=[x for x in cs if x is not None];cl=[x for x in cl if x is not None]
        if len(cs)<4 or len(cl)<4:o[ts]={};continue
        shock=statistics.fmean(cl)-statistics.fmean(cs)
        if shock<p['drop']:o[ts]={};continue
        vals=[]
        for s in ALTS:
            r=ret(c,s,i,p['mom']); b=ret(c,'BTC',i,p['mom'])
            if r is not None and b is not None:vals.append((r-b,s))
        vals.sort()
        if not vals:o[ts]={};continue
        # after correlation fracture, trade re-coupling: long laggard / short leader beta-light spread
        o[ts]=norm({vals[0][1]:1,vals[-1][1]:-1},p['gross']) if vals[-1][0]-vals[0][0]>=p['spread'] else {}
    return expand(t,o)

def breadth_flip(v,t,c,f):
    p=v.p;o={}
    for i,ts in enumerate(t):
        if ts<v4.START_2023 or i<p['h']+p['lag']+2 or (ts//HOUR)%p['step']:continue
        def br(j):return sum(1 for s in SYMS if (ret(c,s,j,p['h']) or 0)>0)/len(SYMS)
        a=br(i-p['lag']);b=br(i)
        if a<=p['weak'] and b>=p['recover']:
            vals=sorted([(ret(c,s,i,p['h']) or -999,s) for s in ALTS],reverse=True)[:p['k']];o[ts]=norm({s:1 for _,s in vals},p['gross'])
        else:o[ts]={}
    return expand(t,o)

def funding_unwind(v,t,c,f):
    p=v.p;o={};cum={}
    for s in ALTS:
        x=[];z=0.0
        for ts in t:z+=f[s].get(ts,0.0);x.append(z)
        cum[s]=x
    for i,ts in enumerate(t):
        if ts<v4.START_2023 or i<p['look']+p['lag']+2 or (ts//HOUR)%p['step']:continue
        vals=[]
        for s in ALTS:
            old=cum[s][i-p['lag']]-cum[s][i-p['lag']-p['look']];now=cum[s][i]-cum[s][i-p['look']]
            vals.append((old,now,s))
        hi=max(vals);lo=min(vals)
        w={}
        if hi[0]>=p['extreme'] and hi[1]<=hi[0]*p['normRatio']:w[hi[2]]=-1
        if lo[0]<=-p['extreme'] and lo[1]>=lo[0]*p['normRatio']:w[lo[2]]=1
        o[ts]=norm(w,p['gross']) if w else {}
    return expand(t,o)

def trend_change(v,t,c,f):
    p=v.p;o={}
    for i,ts in enumerate(t):
        if ts<v4.START_2023 or i<p['slow']+p['confirm']+2 or (ts//HOUR)%p['step']:continue
        old=ret(c,'BTC',i-p['confirm'],p['slow']);new=ret(c,'BTC',i,p['fast']);confirm=ret(c,'BTC',i,p['confirm'])
        if None in (old,new,confirm):continue
        if old>=p['persist'] and new<0 and confirm<-p['turn']:o[ts]={'BTC':-p['gross']}
        elif old<=-p['persist'] and new>0 and confirm>p['turn']:o[ts]={'BTC':p['gross']}
        else:o[ts]={}
    return expand(t,o)

def leadership_shift(v,t,c,f):
    p=v.p;o={}
    for i,ts in enumerate(t):
        if ts<v4.START_2023 or i<p['h']+p['lag']+2 or (ts//HOUR)%p['step']:continue
        def alt(j):return statistics.fmean([ret(c,s,j,p['h']) or 0 for s in ALTS])
        d0=alt(i-p['lag'])-(ret(c,'BTC',i-p['lag'],p['h']) or 0);d1=alt(i)-(ret(c,'BTC',i,p['h']) or 0)
        if d0<=-p['gap'] and d1>=p['gap']:
            vals=sorted([(ret(c,s,i,p['h']) or -999,s) for s in ALTS],reverse=True)[:p['k']];o[ts]=norm({s:1 for _,s in vals},p['gross'])
        elif d0>=p['gap'] and d1<=-p['gap']:o[ts]={'BTC':p['gross']}
        else:o[ts]={}
    return expand(t,o)

def panic_stabilize(v,t,c,f):
    p=v.p;o={}
    for i,ts in enumerate(t):
        if ts<v4.START_2023 or i<max(p['drawH'],p['volH'],p['rebound'])+2 or (ts//HOUR)%p['step']:continue
        draw=sum(1 for s in SYMS if (ret(c,s,i-p['rebound'],p['drawH']) or 0)<=p['draw'])
        rv=vol(c,'BTC',i-p['rebound'],p['volH']); rb=ret(c,'BTC',i,p['rebound'])
        breadth=sum(1 for s in SYMS if (ret(c,s,i,p['rebound']) or 0)>0)
        if draw>=p['panicBreadth'] and rv and rv>=p['highVol'] and rb and rb>=p['rb'] and breadth>=p['recoverBreadth']:
            vals=sorted([(ret(c,s,i,p['rebound']) or -999,s) for s in ALTS],reverse=True)[:p['k']];o[ts]=norm({s:1 for _,s in vals},p['gross'])
        else:o[ts]={}
    return expand(t,o)

FNS={'vol_transition':vol_transition,'correlation_break':correlation_break,'breadth_flip':breadth_flip,'funding_unwind':funding_unwind,'trend_change':trend_change,'leadership_shift':leadership_shift,'panic_stabilize':panic_stabilize}

def variants():
    return [
      V('vol_transition','VT_A',dict(short=24,long=168,mom=12,confirm=6,lowRatio=.65,highRatio=1.15,dir=.6,gross=.7,step=6)),
      V('vol_transition','VT_B',dict(short=24,long=336,mom=24,confirm=8,lowRatio=.7,highRatio=1.10,dir=1.0,gross=.7,step=8)),
      V('correlation_break','CB_A',dict(short=48,long=336,confirm=12,mom=24,drop=.25,spread=2,gross=.6,step=12)),
      V('correlation_break','CB_B',dict(short=72,long=504,confirm=12,mom=48,drop=.30,spread=3,gross=.6,step=12)),
      V('breadth_flip','BF_A',dict(h=24,lag=12,weak=.34,recover=.67,k=2,gross=.7,step=6)),
      V('breadth_flip','BF_B',dict(h=48,lag=24,weak=.34,recover=.67,k=2,gross=.7,step=12)),
      V('funding_unwind','FU_A',dict(look=168,lag=24,extreme=.08,normRatio=.5,gross=.5,step=8)),
      V('funding_unwind','FU_B',dict(look=336,lag=48,extreme=.12,normRatio=.6,gross=.5,step=8)),
      V('trend_change','TC_A',dict(slow=336,fast=48,confirm=12,persist=8,turn=1,gross=.6,step=6)),
      V('trend_change','TC_B',dict(slow=504,fast=72,confirm=24,persist=10,turn=1.5,gross=.6,step=12)),
      V('leadership_shift','LS_A',dict(h=72,lag=24,gap=2,k=2,gross=.7,step=12)),
      V('leadership_shift','LS_B',dict(h=168,lag=48,gap=3,k=2,gross=.7,step=12)),
      V('panic_stabilize','PS_A',dict(drawH=24,volH=72,rebound=6,draw=-5,panicBreadth=4,highVol=80,rb=.8,recoverBreadth=4,k=2,gross=.7,step=3)),
      V('panic_stabilize','PS_B',dict(drawH=48,volH=168,rebound=12,draw=-8,panicBreadth=4,highVol=70,rb=1.2,recoverBreadth=4,k=2,gross=.7,step=6)),
    ]

def evalp(targets,data,period):
    t,c,h,l,f=data;a,b=period
    return {'normal':core.simulate(targets,t,c,f,a,b,10,0),'stress':core.simulate(targets,t,c,f,a,b,30,1)}

def gate(x,nmin,pf=1.20):
    n=x['normal'];s=x['stress']
    return n['cycles']>=nmin and (n['profitFactor'] or 0)>=pf and n['compoundedReturnPct']>0 and n['maxDrawdownPct']>-20 and (s['profitFactor'] or 0)>1.0 and n['bestCycleProfitSharePct']<=40 and (n['profitFactorWithoutBest'] or 0)>1.0

def main():
    state=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));state.mkdir(parents=True,exist_ok=True)
    cache=Path.cwd()/'.cache'/'perp-research-usdm';raw={s:v4.load_symbol(cache,s) for s in v4.SYMBOLS};data=core.prepare(raw);t,c,h,l,f=data
    grouped={k:[] for k in FNS}
    for v in variants():grouped[v.family].append(v)
    result={'version':55,'strategyId':STRATEGY_ID,'status':'NO_ROBUST_IMPROVEMENT','robustCandidate':None,'families':{},'dataLimitations':{'liquidity_transition':'SKIPPED: no multi-year genuine depth/spread history in research cache; forward microstructure data is not substituted or fabricated'},'productionChanged':False,'realTradingEnabled':False}
    for fam,vs in grouped.items():
        survivors=[]
        for v in vs:
            targets=FNS[fam](v,t,c,f);dev=evalp(targets,data,PERIODS['development'])
            if not gate(dev,16):continue
            val=evalp(targets,data,PERIODS['validation'])
            if gate(val,12):survivors.append((min(dev['normal']['profitFactor'],val['normal']['profitFactor']),v,targets,dev,val))
        rec={'evaluatedVariants':len(vs),'developmentValidationPassed':len(survivors),'passed':False,'status':'NO_DEVELOPMENT_VALIDATION_EDGE'}
        if survivors:
            _,v,targets,dev,val=max(survivors,key=lambda x:x[0]);conf=evalp(targets,data,PERIODS['confirmation']);rec.update({'status':'CONFIRMATION_REJECTED','selected':{'variant':asdict(v),'development':dev,'validation':val,'confirmation':conf}})
            if gate(conf,12):
                hold=evalp(targets,data,PERIODS['holdout']);rec['selected']['holdout']=hold
                if gate(hold,8,pf=1.0):rec['passed']=True;rec['status']='ROBUST_PASS';result['status']='ROBUST_PASS';result['robustCandidate']={'family':fam,**rec['selected']}
        result['families'][fam]=rec
    out=state/'state-transition-v55.json';out.write_text(json.dumps(core.round_obj(result),indent=2),encoding='utf-8')
    lines=[f'# {STRATEGY_ID}', '', f"Status: **{result['status']}**", '', 'Strict chronology: 2023 Development -> 2024 Validation -> 2025 untouched Confirmation -> 2026 untouched Holdout. Holdout is opened only after Confirmation passes.', '', '| Family | Variants | Dev+Val passed | Status |', '|---|---:|---:|---|']
    for fam,r in result['families'].items():lines.append(f"| {fam} | {r['evaluatedVariants']} | {r['developmentValidationPassed']} | {r['status']} |")
    lines += ['', 'Liquidity transition was not backfilled with synthetic data; it is explicitly skipped unless genuine depth/spread history exists.', '', 'Normal cost: 10 bps. Stress: 30 bps plus one-hour execution delay. Funding is included by the shared simulator.', '', 'Research only; production/VPS/LIVE/account/order/approval state unchanged.']
    (state/'state-transition-v55.md').write_text('\n'.join(lines),encoding='utf-8')
    print(json.dumps(core.round_obj(result)))

if __name__=='__main__':main()
