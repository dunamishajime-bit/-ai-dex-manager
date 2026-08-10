from __future__ import annotations

import argparse, json, math, os, statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS; HOUR=b.HOUR
ret=b.ret; metric=b.metric; future_trade=b.future_trade

STYLE_POOLS={
 'trend_quality':{
  'BTC':['trend_pullback_release','breadth_quality_break'], 'ETH':['breadth_quality_break','trend_pullback_release'],
  'BNB':['trend_pullback_release','breadth_quality_break'], 'SOL':['breadth_quality_break','trend_pullback_release'],
  'LINK':['trend_pullback_release','breadth_quality_break'], 'AVAX':['breadth_quality_break','trend_pullback_release']},
 'exhaustion':{
  'BTC':['shock_exhaustion_reversal','range_failure_reversal'], 'ETH':['range_failure_reversal','shock_exhaustion_reversal'],
  'BNB':['shock_exhaustion_reversal','range_failure_reversal'], 'SOL':['range_failure_reversal','shock_exhaustion_reversal'],
  'LINK':['shock_exhaustion_reversal','range_failure_reversal'], 'AVAX':['range_failure_reversal','shock_exhaustion_reversal']},
 'relative_phase':{
  'BTC':['leadership_phase_shift','relative_strength_persistence'], 'ETH':['relative_strength_persistence','leadership_phase_shift'],
  'BNB':['leadership_phase_shift','relative_strength_persistence'], 'SOL':['relative_strength_persistence','leadership_phase_shift'],
  'LINK':['leadership_phase_shift','relative_strength_persistence'], 'AVAX':['relative_strength_persistence','leadership_phase_shift']},
}
CFG={'risk':.82,'cool':10,'maxslots':3}

def zscore(xs):
    if len(xs)<24:return 0.0
    m=statistics.fmean(xs); sd=statistics.pstdev(xs)
    return (xs[-1]-m)/sd if sd>1e-9 else 0.0

def signal(mech,s,candles,idx,ts,cfg):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    r3=ret(c,i,3); r6=ret(c,i,6); r12=ret(c,i,12); r24=ret(c,i,24); r72=ret(c,i,72); r168=ret(c,i,168)
    if None in (r3,r6,r12,r24,r72,r168):return None
    v24=b.vol(c,i,24); v96=b.vol(c,i,96); v336=b.vol(c,i,336); eff=b.efficiency(c,i,72); br=b.breadth(candles,idx,ts,24); rp=b.range_position(c,i,96)
    if v336<=1e-9 or v24>3.0*v336:return None

    if mech=='trend_pullback_release':
        old=ret(c,i-12,72); pull=ret(c,i,12)
        if old is None:return None
        if old>4.0 and -2.2<pull<0 and r3>.25 and eff>.24 and br>=.50 and rp>.48:return (1,30,.78)
        if old<-4.0 and 0<pull<2.2 and r3<-.25 and eff>.24 and br<=.50 and rp<.52:return (-1,24,.70)

    elif mech=='breadth_quality_break':
        med=b.median_move(candles,idx,ts,24); rel=r24-med; vr=v24/max(v96,1e-9)
        if br>=.67 and r24>2.0 and rel>.5 and eff>.30 and 1.0<vr<1.9 and rp>.62:return (1,24,.72)
        if br<=.33 and r24<-2.0 and rel<-.5 and eff>.30 and 1.0<vr<1.9 and rp<.38:return (-1,24,.72)

    elif mech=='shock_exhaustion_reversal':
        rs=b.rseries(c,i,120); z=zscore(rs); vr=v24/max(v96,1e-9)
        if r12<-3.0 and r3>.35 and z<-.9 and vr>1.35 and eff<.30 and rp<.30:return (1,15,.62)
        if r12>3.0 and r3<-.35 and z>.9 and vr>1.35 and eff<.30 and rp>.70:return (-1,15,.62)

    elif mech=='range_failure_reversal':
        prev=b.range_position(c,i-6,96)
        if prev>.92 and rp<.78 and r6<-.5 and eff<.26 and br<.67:return (-1,18,.60)
        if prev<.08 and rp>.22 and r6>.5 and eff<.26 and br>.33:return (1,18,.60)

    elif mech=='leadership_phase_shift':
        med12=b.median_move(candles,idx,ts,12); med72=b.median_move(candles,idx,ts,72); rel12=r12-med12; rel72=r72-med72
        if rel72<-.8 and rel12>1.0 and r6>0 and eff>.22 and br>=.50:return (1,24,.68)
        if rel72>.8 and rel12<-1.0 and r6<0 and eff>.22 and br<=.50:return (-1,24,.68)

    elif mech=='relative_strength_persistence':
        med24=b.median_move(candles,idx,ts,24); med168=b.median_move(candles,idx,ts,168); a=r24-med24; z=r168-med168
        if a>1.0 and z>2.0 and r6>.25 and eff>.28 and rp>.55 and br>=.5:return (1,30,.74)
        if a<-1.0 and z<-2.0 and r6<-.25 and eff>.28 and rp<.45 and br<=.5:return (-1,30,.74)
    return None

def run(style):
    b.CANDIDATES=STYLE_POOLS[style]; b.signal=signal
    candles,idx,_=b.base.load(); ps=b.base.periods(candles)
    chosen,diag=b.choose(candles,idx,ps['development'],CFG)
    dm,_,_=b.portfolio(chosen,candles,idx,*ps['development'],NORMAL_BPS,0,CFG)
    vm,_,_=b.portfolio(chosen,candles,idx,*ps['validation'],NORMAL_BPS,0,CFG)
    vs,_,_=b.portfolio(chosen,candles,idx,*ps['validation'],STRESS_BPS,1,CFG)
    res={'strategyId':f'PAIR_SPECIFIC_V105_{style.upper()}','periods':ps,'chosenPairEngines':chosen,'selection':diag,'development':dm,'validation':vm,'validationStress':vs,'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or (dm.get('returnPct') or 0)<=0 or (vm.get('pf') or 0)<1.05 or (vm.get('returnPct') or 0)<=0:
        res.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,_,_=b.portfolio(chosen,candles,idx,*ps['confirmation'],NORMAL_BPS,0,CFG); cs,_,_=b.portfolio(chosen,candles,idx,*ps['confirmation'],STRESS_BPS,1,CFG)
        res.update(confirmation=cm,confirmationStress=cs)
        if not b.gate(cm,cs):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,_,_=b.portfolio(chosen,candles,idx,*ps['holdout'],NORMAL_BPS,0,CFG); hs,_,_=b.portfolio(chosen,candles,idx,*ps['holdout'],STRESS_BPS,1,CFG)
            ym,yp,yc=b.portfolio(chosen,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0,CFG); ys,_,_=b.portfolio(chosen,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1,CFG)
            pos=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS); sh=[abs(v) for v in yc.values()]; conc=max(sh)/sum(sh) if sum(sh)>1e-9 else 1.0
            ok=b.gate(ym,ys) and (hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 and (ym.get('returnPct') or 0)>=60 and pos>=4 and conc<.45
            res.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,yearPair=yp,yearContribution=yc,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True); stem=f'pair-specific-v105-{style}'; txt=json.dumps(res,indent=2)
    (out/f'{stem}.json').write_text(txt,encoding='utf-8'); (out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n',encoding='utf-8'); print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--style',choices=STYLE_POOLS,required=True); args=ap.parse_args(); run(args.style)
