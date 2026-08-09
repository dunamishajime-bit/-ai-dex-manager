from __future__ import annotations

import itertools, json, math, os, statistics
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_nextgen_independent_families_v49 as core

STRATEGY_ID = "PARALLEL_RELATIVE_VALUE_V52"
ALTS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
HOUR = 3_600_000
PERIODS = {
    "development": (v4.START_2023, v4.START_2024),
    "validation": (v4.START_2024, v4.START_2025),
    "confirmation": (v4.START_2025, v4.START_2026),
    "holdout": (v4.START_2026, v4.END),
}

@dataclass(frozen=True)
class Variant:
    family: str
    variant_id: str
    params: dict

def normalize(weights: Dict[str,float], gross: float) -> Dict[str,float]:
    g=sum(abs(x) for x in weights.values())
    return {} if g<=1e-12 else {s:w*gross/g for s,w in weights.items() if abs(w)>1e-12}

def pct(closes,s,i,h):
    return None if i-h<0 or closes[s][i-h]<=0 else (closes[s][i]/closes[s][i-h]-1)*100

def lr(closes,s,i,h):
    if i-h<0:return []
    return [math.log(closes[s][j]/closes[s][j-1]) for j in range(i-h+1,i+1) if closes[s][j-1]>0 and closes[s][j]>0]

def beta(closes,s,i,h):
    a,b=lr(closes,s,i,h),lr(closes,"BTC",i,h); n=min(len(a),len(b))
    if n<48:return None
    a,b=a[-n:],b[-n:]; ma,mb=statistics.fmean(a),statistics.fmean(b)
    vb=sum((x-mb)**2 for x in b)
    return None if vb<=1e-15 else sum((a[k]-ma)*(b[k]-mb) for k in range(n))/vb

def corr(xs,ys):
    n=min(len(xs),len(ys))
    if n<24:return 0.0
    xs,ys=xs[-n:],ys[-n:]; mx,my=statistics.fmean(xs),statistics.fmean(ys)
    vx=sum((x-mx)**2 for x in xs); vy=sum((y-my)**2 for y in ys)
    return 0.0 if vx<=1e-15 or vy<=1e-15 else sum((xs[k]-mx)*(ys[k]-my) for k in range(n))/math.sqrt(vx*vy)

def expand(times, signals):
    cur={}; out={}
    for t in times:
        if t in signals:cur=signals[t]
        out[t]=cur
    return out

def residual_xsmom(v,times,closes,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<max(p['betaLb'],p['horizon'],168)+2 or (t//HOUR)%p['rebalance']:continue
        br=pct(closes,'BTC',i,p['horizon']); bt=pct(closes,'BTC',i,168)
        if br is None or bt is None:continue
        vals=[]
        for s in ALTS:
            b=beta(closes,s,i,p['betaLb']); r=pct(closes,s,i,p['horizon'])
            if b is not None and r is not None:vals.append((s,r-b*br,b))
        if len(vals)<4 or max(x[1] for x in vals)-min(x[1] for x in vals)<p['spread'] or abs(bt)<p['btcTrend']:
            sig[t]={}; continue
        vals=sorted(vals,key=lambda x:x[1]); lo,hi=vals[0],vals[-1]
        w={hi[0]:0.5,lo[0]:-0.5}
        net_beta=0.5*hi[2]-0.5*lo[2]
        w['BTC']=-net_beta
        sig[t]=normalize(w,p['gross'])
    return expand(times,sig)

def residual_zreversal(v,times,closes,highs,lows,funding):
    p=v.params; sig={}; hist={s:[] for s in ALTS}
    for i,t in enumerate(times):
        if i<max(p['betaLb'],p['horizon'])+2:continue
        br=pct(closes,'BTC',i,p['horizon'])
        if br is None:continue
        vals=[]
        for s in ALTS:
            b=beta(closes,s,i,p['betaLb']); r=pct(closes,s,i,p['horizon'])
            if b is not None and r is not None:
                rv=r-b*br; hist[s].append(rv); vals.append((s,rv,b))
        if t<v4.START_2023 or (t//HOUR)%p['rebalance'] or len(vals)<4:continue
        z=[]
        for s,rv,b in vals:
            h=hist[s][-p['zLb']:]
            if len(h)<max(24,p['zLb']//2):continue
            sd=statistics.pstdev(h)
            if sd>1e-9:z.append((s,(rv-statistics.fmean(h))/sd,b))
        if len(z)<4:
            sig[t]={};continue
        z=sorted(z,key=lambda x:x[1]); lo,hi=z[0],z[-1]
        if lo[1]>-p['z'] or hi[1]<p['z']:
            sig[t]={};continue
        w={lo[0]:0.5,hi[0]:-0.5}; net_beta=0.5*lo[2]-0.5*hi[2]; w['BTC']=-net_beta
        sig[t]=normalize(w,p['gross'])
    return expand(times,sig)

def pair_stable_reversion(v,times,closes,highs,lows,funding):
    p=v.params; sig={}; pairs=list(itertools.combinations(ALTS,2))
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<p['lb']+p['zLb']+2 or (t//HOUR)%p['rebalance']:continue
        best=None
        for a,b in pairs:
            xa=lr(closes,a,i,p['lb']); xb=lr(closes,b,i,p['lb']); c=corr(xa,xb)
            if c<p['minCorr']:continue
            lbeta=beta_pair(closes,a,b,i,p['lb'])
            if lbeta is None or lbeta<=0:continue
            spreads=[]
            start=max(1,i-p['zLb']+1)
            for j in range(start,i+1):
                if closes[a][j]>0 and closes[b][j]>0:spreads.append(math.log(closes[a][j])-lbeta*math.log(closes[b][j]))
            if len(spreads)<24:continue
            sd=statistics.pstdev(spreads)
            if sd<=1e-9:continue
            z=(spreads[-1]-statistics.fmean(spreads))/sd
            score=abs(z)*c
            if abs(z)>=p['z'] and (best is None or score>best[0]):best=(score,a,b,lbeta,z)
        if best is None:sig[t]={};continue
        _,a,b,h,z=best
        w={a:-1.0 if z>0 else 1.0,b:h if z>0 else -h}
        sig[t]=normalize(w,p['gross'])
    return expand(times,sig)

def beta_pair(closes,a,b,i,h):
    x,y=lr(closes,a,i,h),lr(closes,b,i,h); n=min(len(x),len(y))
    if n<48:return None
    x,y=x[-n:],y[-n:]; mx,my=statistics.fmean(x),statistics.fmean(y); vy=sum((q-my)**2 for q in y)
    return None if vy<=1e-15 else sum((x[k]-mx)*(y[k]-my) for k in range(n))/vy

def rs_cash_rotation(v,times,closes,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<max(p['horizon'],p['slow'])+2 or (t//HOUR)%p['rebalance']:continue
        btc=pct(closes,'BTC',i,p['slow']); bfast=pct(closes,'BTC',i,p['horizon'])
        if btc is None or bfast is None or btc<p['btcFloor']:
            sig[t]={};continue
        vals=[]
        for s in ALTS:
            r=pct(closes,s,i,p['horizon'])
            if r is not None:vals.append((s,r-bfast))
        vals=sorted(vals,key=lambda x:x[1],reverse=True)
        chosen=[x for x in vals if x[1]>=p['edge']][:p['topK']]
        sig[t]=normalize({s:1 for s,_ in chosen},p['gross']) if chosen else {}
    return expand(times,sig)

def funding_persistence_carry(v,times,closes,highs,lows,funding):
    p=v.params; sig={}; fh={s:[] for s in ALTS}; cum={s:0.0 for s in ALTS}
    for i,t in enumerate(times):
        for s in ALTS:
            cum[s]+=funding[s].get(t,0.0); fh[s].append(cum[s])
        if t<v4.START_2023 or i<max(p['fundLb'],p['trend'])+2 or (t//HOUR)%p['rebalance']:continue
        vals=[]
        for s in ALTS:
            c=fh[s][i]-fh[s][i-p['fundLb']]; m=pct(closes,s,i,p['trend'])
            prev=fh[s][i-p['persistGap']]-fh[s][max(0,i-p['persistGap']-p['fundLb'])] if i>=p['persistGap']+p['fundLb'] else 0
            if m is not None:vals.append((s,c,m,prev))
        if len(vals)<4:sig[t]={};continue
        lo=min(vals,key=lambda x:x[1]); hi=max(vals,key=lambda x:x[1])
        if hi[1]-lo[1]<p['spread'] or hi[1]*hi[3]<=0 or lo[1]*lo[3]<=0 or abs(hi[2])>p['trendGuard'] or abs(lo[2])>p['trendGuard']:
            sig[t]={};continue
        sig[t]=normalize({lo[0]:0.5,hi[0]:-0.5},p['gross'])
    return expand(times,sig)

FNS={
 'residual_xsmom':residual_xsmom,
 'residual_zreversal':residual_zreversal,
 'pair_stable_reversion':pair_stable_reversion,
 'rs_cash_rotation':rs_cash_rotation,
 'funding_persistence_carry':funding_persistence_carry,
}

def variants():
    out=[]
    for b,h,s,bt,g,r in itertools.product([168,336],[24,72],[2,4],[1,3],[0.6,0.9],[12,24]):
        p=dict(betaLb=b,horizon=h,spread=s,btcTrend=bt,gross=g,rebalance=r); out.append(Variant('residual_xsmom',f'RX_B{b}_H{h}_S{s}_T{bt}_G{g}_R{r}',p))
    for b,h,zl,z,g,r in itertools.product([168,336],[24,72],[168,336],[1.5,2.0],[0.6,0.9],[12,24]):
        p=dict(betaLb=b,horizon=h,zLb=zl,z=z,gross=g,rebalance=r); out.append(Variant('residual_zreversal',f'RZ_B{b}_H{h}_L{zl}_Z{z}_G{g}_R{r}',p))
    for lb,zl,z,c,g,r in itertools.product([336,720],[168,336],[1.5,2.0],[0.65,0.8],[0.5,0.8],[12,24]):
        p=dict(lb=lb,zLb=zl,z=z,minCorr=c,gross=g,rebalance=r); out.append(Variant('pair_stable_reversion',f'PS_L{lb}_ZL{zl}_Z{z}_C{c}_G{g}_R{r}',p))
    for h,sl,e,k,g,r in itertools.product([72,168],[168,336],[1,3],[1,2],[0.6,0.9],[12,24]):
        p=dict(horizon=h,slow=sl,edge=e,topK=k,gross=g,rebalance=r,btcFloor=0); out.append(Variant('rs_cash_rotation',f'RS_H{h}_S{sl}_E{e}_K{k}_G{g}_R{r}',p))
    for fl,pg,tr,sp,g,r in itertools.product([168,336],[72,168],[72,168],[0.02,0.05],[0.6,0.9],[8,24]):
        p=dict(fundLb=fl,persistGap=pg,trend=tr,spread=sp,gross=g,rebalance=r,trendGuard=8); out.append(Variant('funding_persistence_carry',f'FP_F{fl}_P{pg}_T{tr}_S{sp}_G{g}_R{r}',p))
    return out

def evaluate(v,data):
    times,closes,highs,lows,funding=data; targets=FNS[v.family](v,times,closes,highs,lows,funding)
    def period(p):
        return {'normal':core.simulate(targets,times,closes,funding,*p,10,0),'stress':core.simulate(targets,times,closes,funding,*p,30,1)}
    return targets,{k:period(p) for k,p in list(PERIODS.items())[:2]}

def prelim(e):
    for key,nmin in [('development',24),('validation',18)]:
        n=e[key]['normal']; s=e[key]['stress']
        if n['cycles']<nmin or (n['profitFactor'] or 0)<1.15 or n['compoundedReturnPct']<=0 or n['maxDrawdownPct']<=-20 or (s['profitFactor'] or 0)<=1.0:return False
        if n['bestCycleProfitSharePct']>40 or (n['profitFactorWithoutBest'] or 0)<=1:return False
    return True

def score(e):
    d=e['development']['normal']; v=e['validation']['normal']
    return min(d['profitFactor'] or 0,v['profitFactor'] or 0)*10+min(d['compoundedReturnPct'],v['compoundedReturnPct'])*0.1+min(d['maxDrawdownPct'],v['maxDrawdownPct'])*0.05

def main():
    state=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')).resolve(); cache=Path.cwd()/'.cache'/'perp-research-usdm'
    raw={s:v4.load_symbol(cache,s) for s in v4.SYMBOLS}; data=core.prepare(raw); times,closes,highs,lows,funding=data
    grouped={f:[] for f in FNS}
    for v in variants():grouped[v.family].append(v)
    result={'version':52,'strategyId':STRATEGY_ID,'status':'NO_ROBUST_IMPROVEMENT','robustCandidate':None,'families':{},'productionChanged':False,'realTradingEnabled':False}
    for fam,vs in grouped.items():
        passed=[]
        for v in vs:
            targets,e=evaluate(v,data)
            if prelim(e):passed.append((score(e),v,targets,e))
        rec={'evaluatedVariants':len(vs),'developmentValidationPassed':len(passed),'selected':None,'status':'NO_DEVELOPMENT_VALIDATION_EDGE','passed':False}
        if passed:
            _,v,targets,e=max(passed,key=lambda x:x[0]); conf={'normal':core.simulate(targets,times,closes,funding,*PERIODS['confirmation'],10,0),'stress':core.simulate(targets,times,closes,funding,*PERIODS['confirmation'],30,1)}
            # confirmation is opened once after freeze. Only open holdout if confirmation passes.
            cn=conf['normal']; cs=conf['stress']; conf_ok=cn['cycles']>=18 and (cn['profitFactor'] or 0)>1 and cn['compoundedReturnPct']>0 and cn['maxDrawdownPct']>-20 and (cs['profitFactor'] or 0)>1 and cn['bestCycleProfitSharePct']<=40 and (cn['profitFactorWithoutBest'] or 0)>1
            selected={'variant':asdict(v),'development':e['development'],'validation':e['validation'],'confirmation':conf,'confirmationPassed':conf_ok}
            rec['status']='CONFIRMATION_REJECTED'
            if conf_ok:
                hold={'normal':core.simulate(targets,times,closes,funding,*PERIODS['holdout'],10,0),'stress':core.simulate(targets,times,closes,funding,*PERIODS['holdout'],30,1)}
                hn,hs=hold['normal'],hold['stress']; hold_ok=hn['cycles']>=10 and (hn['profitFactor'] or 0)>1 and hn['compoundedReturnPct']>0 and hn['maxDrawdownPct']>-20 and (hs['profitFactor'] or 0)>1 and hn['bestCycleProfitSharePct']<=40 and (hn['profitFactorWithoutBest'] or 0)>1
                combined={'normal':core.simulate(targets,times,closes,funding,v4.START_2025,v4.END,10,0),'stress':core.simulate(targets,times,closes,funding,v4.START_2025,v4.END,30,1)}
                an,ass=combined['normal'],combined['stress']; robust=hold_ok and an['cycles']>=30 and (an['profitFactor'] or 0)>=1.20 and an['maxDrawdownPct']>-20 and (ass['profitFactor'] or 0)>1 and an['bestCycleProfitSharePct']<=40 and (an['profitFactorWithoutBest'] or 0)>1
                selected.update({'holdout':hold,'combined2025ToHoldout':combined,'holdoutPassed':hold_ok,'robustPassed':robust}); rec['status']='ROBUST_PASS' if robust else 'HOLDOUT_REJECTED'; rec['passed']=robust
                if robust and result['robustCandidate'] is None:result['robustCandidate']={'family':fam,'variant':asdict(v),'selected':selected}; result['status']='ROBUST_CANDIDATE_FOUND'
            rec['selected']=selected
        result['families'][fam]=rec
    state.mkdir(parents=True,exist_ok=True); (state/'parallel-relative-value-v52.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Parallel Relative Value V52','',f"- Status: **{result['status']}**",'- Production changed: NO','- Real trading: DISABLED','']
    for fam,r in result['families'].items():
        lines += [f'## {fam}',f"- Evaluated: {r['evaluatedVariants']}",f"- Dev+Validation passed: {r['developmentValidationPassed']}",f"- Status: **{r['status']}**"]
        s=r.get('selected')
        if s:
            c=s['confirmation']['normal']; lines += [f"- Selected: `{s['variant']['variant_id']}`",f"- Confirmation: N {c['cycles']} / PF {c['profitFactor']} / Return {c['compoundedReturnPct']}% / DD {c['maxDrawdownPct']}%"]
            if 'holdout' in s:
                h=s['holdout']['normal']; lines += [f"- Holdout: N {h['cycles']} / PF {h['profitFactor']} / Return {h['compoundedReturnPct']}% / DD {h['maxDrawdownPct']}%",f"- Holdout Stress PF: {s['holdout']['stress']['profitFactor']}"]
        lines.append('')
    (state/'parallel-relative-value-v52.md').write_text('\n'.join(lines),encoding='utf-8'); print('\n'.join(lines))

if __name__=='__main__':main()
