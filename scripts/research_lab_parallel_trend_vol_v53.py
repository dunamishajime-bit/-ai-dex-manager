from __future__ import annotations

import itertools, json, math, os, statistics
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_nextgen_independent_families_v49 as core

STRATEGY_ID = "PARALLEL_TREND_VOL_V53"
SYMS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
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

def pct(c,s,i,h):
    return None if i-h<0 or c[s][i-h]<=0 else (c[s][i]/c[s][i-h]-1)*100

def vol(c,s,i,h):
    if i-h<1:return None
    xs=[]
    for j in range(i-h+1,i+1):
        if c[s][j-1]>0 and c[s][j]>0: xs.append(math.log(c[s][j]/c[s][j-1]))
    return statistics.pstdev(xs)*math.sqrt(24*365)*100 if len(xs)>=max(12,h//2) else None

def normalize(w:Dict[str,float],gross:float):
    g=sum(abs(x) for x in w.values())
    return {} if g<=1e-12 else {s:x*gross/g for s,x in w.items() if abs(x)>1e-12}

def expand(times,sig):
    cur={}; out={}
    for t in times:
        if t in sig: cur=sig[t]
        out[t]=cur
    return out

def breakout_voltarget(v,times,c,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<max(p['lookback'],p['breadthH'],p['volLb'])+2 or (t//HOUR)%p['rebalance']:continue
        breadth=sum(1 for s in SYMS if (pct(c,s,i,p['breadthH']) or -999)>0)
        if breadth<p['breadthMin']:
            sig[t]={}; continue
        cand=[]
        for s in SYMS:
            prev=max(c[s][i-p['lookback']:i]); rv=vol(c,s,i,p['volLb'])
            if c[s][i]>prev and rv and rv>0:
                mom=pct(c,s,i,p['breadthH']) or 0; cand.append((mom,s,min(p['maxWeight'],p['targetVol']/rv)))
        cand=sorted(cand,reverse=True)[:p['topK']]
        sig[t]=normalize({s:w for _,s,w in cand},p['gross']) if cand else {}
    return expand(times,sig)

def compression_expansion(v,times,c,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<max(p['longVol'],p['breakLb'])+2 or (t//HOUR)%p['rebalance']:continue
        cand=[]
        for s in SYMS:
            vs=vol(c,s,i,p['shortVol']); vl=vol(c,s,i,p['longVol'])
            if not vs or not vl or vl<=0 or vs/vl>p['compress']:continue
            prev=max(c[s][i-p['breakLb']:i]); mom=pct(c,s,i,p['momH'])
            if c[s][i]>prev and mom is not None and mom>p['momFloor']: cand.append((mom,s))
        cand=sorted(cand,reverse=True)[:p['topK']]
        sig[t]=normalize({s:1 for _,s in cand},p['gross']) if cand else {}
    return expand(times,sig)

def trend_accel(v,times,c,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<p['slow']+2 or (t//HOUR)%p['rebalance']:continue
        vals=[]
        for s in SYMS:
            f=pct(c,s,i,p['fast']); sl=pct(c,s,i,p['slow'])
            if f is not None and sl is not None: vals.append((f-sl*p['scale'],s,f,sl))
        if not vals: sig[t]={}; continue
        vals.sort(reverse=True); score,s,f,sl=vals[0]
        sig[t]=normalize({s:1},p['gross']) if score>p['edge'] and sl>p['slowFloor'] else {}
    return expand(times,sig)

def breadth_momentum(v,times,c,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<p['horizon']+2 or (t//HOUR)%p['rebalance']:continue
        vals=[(pct(c,s,i,p['horizon']),s) for s in SYMS]; vals=[x for x in vals if x[0] is not None]
        breadth=sum(1 for r,_ in vals if r>0)/max(1,len(vals))
        if breadth<p['breadth']:
            sig[t]={};continue
        chosen=[x for x in sorted(vals,reverse=True) if x[0]>p['floor']][:p['topK']]
        sig[t]=normalize({s:1 for _,s in chosen},p['gross']) if chosen else {}
    return expand(times,sig)

def downside_hedge_cash(v,times,c,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<p['slow']+2 or (t//HOUR)%p['rebalance']:continue
        m=pct(c,'BTC',i,p['slow']); f=pct(c,'BTC',i,p['fast'])
        if m is not None and f is not None and m<p['slowCut'] and f<p['fastCut']: sig[t]={'BTC':-p['gross']}
        else: sig[t]={}
    return expand(times,sig)

def vol_regime_rotation(v,times,c,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<max(p['volLb'],p['momH'])+2 or (t//HOUR)%p['rebalance']:continue
        bv=vol(c,'BTC',i,p['volLb']); bm=pct(c,'BTC',i,p['momH'])
        if bv is None or bm is None:continue
        if bv>=p['highVol'] and bm<0: sig[t]={'BTC':-p['bearGross']}; continue
        if bv<=p['lowVol'] and bm>0:
            vals=[(pct(c,s,i,p['momH']),s) for s in ALTS]; vals=[x for x in vals if x[0] is not None and x[0]>p['floor']]
            vals=sorted(vals,reverse=True)[:p['topK']]; sig[t]=normalize({s:1 for _,s in vals},p['bullGross']) if vals else {}
        else: sig[t]={}
    return expand(times,sig)

def session_breakout(v,times,c,highs,lows,funding):
    p=v.params; sig={}
    for i,t in enumerate(times):
        hr=(t//HOUR)%24
        if t<v4.START_2023 or i<p['lookback']+2 or hr not in p['hours']:continue
        vals=[]
        for s in SYMS:
            prev=max(c[s][i-p['lookback']:i]); r=pct(c,s,i,p['momH'])
            if c[s][i]>prev and r is not None and r>p['floor']: vals.append((r,s))
        vals=sorted(vals,reverse=True)[:p['topK']]; sig[t]=normalize({s:1 for _,s in vals},p['gross']) if vals else {}
    return expand(times,sig)

def horizon_rotation(v,times,c,highs,lows,funding):
    p=v.params; sig={}; horizons=p['horizons']
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<max(horizons)+p['scoreLb']+2 or (t//HOUR)%p['rebalance']:continue
        # Causal horizon selector: trailing predictive sign score only; no future/holdout fitting.
        hs=[]
        for h in horizons:
            ok=tot=0
            for j in range(i-p['scoreLb'],i,24):
                if j-h<0 or j+24>=i:continue
                a=pct(c,'BTC',j,h); b=pct(c,'BTC',j+24,24)
                if a is None or b is None:continue
                tot+=1; ok+=1 if a*b>0 else 0
            if tot>=8: hs.append((ok/tot,h))
        if not hs: sig[t]={};continue
        _,h=max(hs); vals=[(pct(c,s,i,h),s) for s in SYMS]; vals=[x for x in vals if x[0] is not None and x[0]>p['floor']]
        vals=sorted(vals,reverse=True)[:p['topK']]; sig[t]=normalize({s:1 for _,s in vals},p['gross']) if vals else {}
    return expand(times,sig)

FNS={'breakout_voltarget':breakout_voltarget,'compression_expansion':compression_expansion,'trend_accel':trend_accel,'breadth_momentum':breadth_momentum,'downside_hedge_cash':downside_hedge_cash,'vol_regime_rotation':vol_regime_rotation,'session_breakout':session_breakout,'horizon_rotation':horizon_rotation}

def variants():
    out=[]
    for lb,bh,bm,tv,g,k in itertools.product([72,168],[72,168],[3,4],[20,30],[0.6,0.9],[1,2]):
        p=dict(lookback=lb,breadthH=bh,breadthMin=bm,targetVol=tv,gross=g,topK=k,volLb=168,maxWeight=1.0,rebalance=12); out.append(Variant('breakout_voltarget',f'BV_L{lb}_H{bh}_B{bm}_V{tv}_G{g}_K{k}',p))
    for cv,bk,mf,g,k in itertools.product([0.55,0.7],[24,72],[0,2],[0.6,0.9],[1,2]):
        p=dict(shortVol=24,longVol=168,compress=cv,breakLb=bk,momH=24,momFloor=mf,gross=g,topK=k,rebalance=12); out.append(Variant('compression_expansion',f'CE_C{cv}_B{bk}_M{mf}_G{g}_K{k}',p))
    for f,s,e,g in itertools.product([24,72],[168,336],[1,3],[0.6,0.9]):
        p=dict(fast=f,slow=s,scale=f/s,edge=e,slowFloor=0,gross=g,rebalance=12); out.append(Variant('trend_accel',f'TA_F{f}_S{s}_E{e}_G{g}',p))
    for h,b,fl,g,k in itertools.product([72,168],[0.5,0.67],[0,2],[0.6,0.9],[1,2]):
        p=dict(horizon=h,breadth=b,floor=fl,gross=g,topK=k,rebalance=12); out.append(Variant('breadth_momentum',f'BM_H{h}_B{b}_F{fl}_G{g}_K{k}',p))
    for s,f,sc,fc,g in itertools.product([168,336],[24,72],[-4,-8],[-2,-4],[0.3,0.5]):
        p=dict(slow=s,fast=f,slowCut=sc,fastCut=fc,gross=g,rebalance=12); out.append(Variant('downside_hedge_cash',f'DH_S{s}_F{f}_SC{sc}_FC{fc}_G{g}',p))
    for hv,lv,mh,bg,sg in itertools.product([70,90],[35,50],[72,168],[0.6,0.9],[0.3,0.5]):
        p=dict(highVol=hv,lowVol=lv,volLb=168,momH=mh,bullGross=bg,bearGross=sg,topK=2,floor=1,rebalance=12); out.append(Variant('vol_regime_rotation',f'VR_H{hv}_L{lv}_M{mh}_B{bg}_S{sg}',p))
    for lb,mh,fl,g,hset in itertools.product([12,24],[6,12],[0,1],[0.5,0.8],[(0,8,16),(4,12,20)]):
        p=dict(lookback=lb,momH=mh,floor=fl,gross=g,topK=1,hours=hset); out.append(Variant('session_breakout',f'SB_L{lb}_M{mh}_F{fl}_G{g}_H{hset[0]}',p))
    for sl,fl,g,k in itertools.product([336,720],[0,1],[0.6,0.9],[1,2]):
        p=dict(horizons=(24,72,168),scoreLb=sl,floor=fl,gross=g,topK=k,rebalance=12); out.append(Variant('horizon_rotation',f'HR_S{sl}_F{fl}_G{g}_K{k}',p))
    return out

def period_eval(targets,data,period):
    times,c,highs,lows,funding=data
    a,b=period
    return {'normal':core.simulate(targets,times,c,funding,a,b,10,0),'stress':core.simulate(targets,times,c,funding,a,b,30,1)}

def gate_block(x,nmin,pf=1.15):
    n,s=x['normal'],x['stress']
    return n['cycles']>=nmin and (n['profitFactor'] or 0)>=pf and n['compoundedReturnPct']>0 and n['maxDrawdownPct']>-20 and (s['profitFactor'] or 0)>1.0 and n['bestCycleProfitSharePct']<=40 and (n['profitFactorWithoutBest'] or 0)>1.0

def main():
    state=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')).resolve(); cache=Path.cwd()/'.cache'/'perp-research-usdm'
    raw={s:v4.load_symbol(cache,s) for s in v4.SYMBOLS}; data=core.prepare(raw); times,c,highs,lows,funding=data
    grouped={f:[] for f in FNS}
    for v in variants(): grouped[v.family].append(v)
    result={'version':53,'strategyId':STRATEGY_ID,'status':'NO_ROBUST_IMPROVEMENT','robustCandidate':None,'families':{},'productionChanged':False,'realTradingEnabled':False}
    for fam,vs in grouped.items():
        stage=[]
        for v in vs:
            targets=FNS[fam](v,times,c,highs,lows,funding); dev=period_eval(targets,data,PERIODS['development'])
            if not gate_block(dev,24): continue
            val=period_eval(targets,data,PERIODS['validation'])
            if gate_block(val,18):
                score=min(dev['normal']['profitFactor'] or 0,val['normal']['profitFactor'] or 0)+0.01*min(dev['normal']['compoundedReturnPct'],val['normal']['compoundedReturnPct'])
                stage.append((score,v,targets,dev,val))
        rec={'evaluatedVariants':len(vs),'developmentValidationPassed':len(stage),'status':'NO_DEVELOPMENT_VALIDATION_EDGE','selected':None,'passed':False}
        if stage:
            _,v,targets,dev,val=max(stage,key=lambda x:x[0]); conf=period_eval(targets,data,PERIODS['confirmation'])
            rec.update({'selected':{'variant':asdict(v),'development':dev,'validation':val,'confirmation':conf},'status':'CONFIRMATION_REJECTED'})
            if gate_block(conf,18,pf=1.20):
                hold=period_eval(targets,data,PERIODS['holdout']); rec['selected']['holdout']=hold
                hn,hs=hold['normal'],hold['stress']
                passed=hn['cycles']>=12 and (hn['profitFactor'] or 0)>1.0 and hn['compoundedReturnPct']>0 and hn['maxDrawdownPct']>-20 and (hs['profitFactor'] or 0)>1.0 and hn['bestCycleProfitSharePct']<=40 and (hn['profitFactorWithoutBest'] or 0)>1.0
                rec['passed']=passed; rec['status']='ROBUST_PASS' if passed else 'HOLDOUT_REJECTED'
                if passed and result['robustCandidate'] is None:
                    result['robustCandidate']={'family':fam,**rec['selected']}; result['status']='ROBUST_CANDIDATE_FOUND'
        result['families'][fam]=rec
    state.mkdir(parents=True,exist_ok=True)
    (state/'parallel-trend-vol-v53.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Parallel Trend Vol V53','',f"- Status: **{result['status']}**",'- Production changed: NO','- Real trading: DISABLED','', '| Family | Evaluated | Dev+Val passed | Status |','| --- | ---: | ---: | --- |']
    for fam,r in result['families'].items(): lines.append(f"| {fam} | {r['evaluatedVariants']} | {r['developmentValidationPassed']} | {r['status']} |")
    lines += ['', '## Method', '', '- 2023 Development -> 2024 Validation -> 2025 untouched Confirmation -> 2026 untouched Holdout.', '- Holdout is opened only after fixed Confirmation passes; no retuning after opening Confirmation/Holdout.', '- Normal 10 bps; Stress 30 bps plus 1-hour execution delay; funding included by shared simulator.', '- Profit concentration gate uses best-cycle share <=40% and PF excluding best >1.', '- Frozen V6/Fresh Forward V9 and production/LIVE/VPS state are untouched.']
    (state/'parallel-trend-vol-v53.md').write_text('\n'.join(lines),encoding='utf-8')
    print('\n'.join(lines))

if __name__=='__main__': main()
