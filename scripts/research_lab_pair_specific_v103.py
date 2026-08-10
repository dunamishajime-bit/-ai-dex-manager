from __future__ import annotations

import argparse, json, math, os, statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS
NORMAL_BPS=b.NORMAL_BPS
STRESS_BPS=b.STRESS_BPS
HOUR=b.HOUR
ret=b.ret
metric=b.metric
future_trade=b.future_trade

STYLE_POOLS={
 'cycle':{
  'BTC':['drawdown_recovery_cycle','volatility_memory_break'],
  'ETH':['volatility_memory_break','drawdown_recovery_cycle'],
  'BNB':['drawdown_recovery_cycle','volatility_memory_break'],
  'SOL':['volatility_memory_break','drawdown_recovery_cycle'],
  'LINK':['drawdown_recovery_cycle','volatility_memory_break'],
  'AVAX':['volatility_memory_break','drawdown_recovery_cycle']},
 'dependency':{
  'BTC':['cross_asset_decoupling','serial_memory_transition'],
  'ETH':['serial_memory_transition','cross_asset_decoupling'],
  'BNB':['cross_asset_decoupling','serial_memory_transition'],
  'SOL':['serial_memory_transition','cross_asset_decoupling'],
  'LINK':['cross_asset_decoupling','serial_memory_transition'],
  'AVAX':['serial_memory_transition','cross_asset_decoupling']},
 'temporal':{
  'BTC':['session_impulse_decay','overnight_range_resolution'],
  'ETH':['overnight_range_resolution','session_impulse_decay'],
  'BNB':['session_impulse_decay','overnight_range_resolution'],
  'SOL':['overnight_range_resolution','session_impulse_decay'],
  'LINK':['session_impulse_decay','overnight_range_resolution'],
  'AVAX':['overnight_range_resolution','session_impulse_decay']},
}
CFG={'risk':.85,'cool':8,'maxslots':3}

def corr(a,c):
    if len(a)!=len(c) or len(a)<24:return 0.0
    ma=statistics.fmean(a); mc=statistics.fmean(c)
    va=sum((x-ma)**2 for x in a); vc=sum((x-mc)**2 for x in c)
    if va<=1e-12 or vc<=1e-12:return 0.0
    return sum((x-ma)*(y-mc) for x,y in zip(a,c))/math.sqrt(va*vc)

def lagcorr(xs):
    return corr(xs[:-1],xs[1:]) if len(xs)>25 else 0.0

def drawdown(c,i,n):
    if i<n:return 0.0
    hi=max(float(c[j]['high']) for j in range(i-n+1,i+1)); px=float(c[i]['close'])
    return (px/hi-1)*100 if hi>0 else 0.0

def signal(mech,s,candles,idx,ts,cfg):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    r3=ret(c,i,3); r6=ret(c,i,6); r12=ret(c,i,12); r24=ret(c,i,24); r72=ret(c,i,72)
    if None in (r3,r6,r12,r24,r72):return None
    v24=b.vol(c,i,24); v96=b.vol(c,i,96); v336=b.vol(c,i,336); eff=b.efficiency(c,i,72); br=b.breadth(candles,idx,ts,24)
    if v336<=1e-9 or v24>3.2*v336:return None

    if mech=='drawdown_recovery_cycle':
        dd=drawdown(c,i,168); olddd=drawdown(c,i-24,168); rp=b.range_position(c,i,72)
        if olddd<-8 and dd>olddd+2.0 and r6>0 and br>=.50 and v24/v336<1.8 and rp>.35:
            return (1,30,.80)
        if olddd>-2 and dd<olddd-3.0 and r6<0 and br<=.50 and eff>.22:
            return (-1,18,.62)

    elif mech=='volatility_memory_break':
        old=b.rseries(c,i-96,192); new=b.rseries(c,i,96)
        if len(old)<150 or len(new)<80:return None
        lo=lagcorr(old); ln=lagcorr(new); vr=v24/max(v96,1e-9)
        if lo<-.06 and ln>.07 and 1.05<vr<2.2 and abs(r6)>.65 and eff>.18:
            return (1 if r6>0 else -1,18,.72)
        if lo>.08 and ln<-.05 and vr<1.55 and abs(r6)>.75 and eff<.25:
            return (-1 if r6>0 else 1,12,.58)

    elif mech=='cross_asset_decoupling':
        sr=b.rseries(c,i,168); bi=idx['BTC'].get(ts)
        if bi is None or bi<336:return None
        brs=b.rseries(candles['BTC'],bi,168)
        oldc=corr(sr[:84],brs[:84]); newc=corr(sr[-84:],brs[-84:]); med=b.median_move(candles,idx,ts,12); rel=r12-med
        if oldc>.55 and newc<.15 and abs(rel)>1.0 and eff>.22:
            return (1 if rel>0 else -1,24,.70)
        if oldc<.15 and newc>.50 and abs(rel)>1.0 and eff<.28:
            return (-1 if rel>0 else 1,18,.56)

    elif mech=='serial_memory_transition':
        xs=b.rseries(c,i,288)
        if len(xs)<250:return None
        a=lagcorr(xs[:144]); z=lagcorr(xs[-144:]); rp=b.range_position(c,i,96)
        if a<=0 and z>.09 and abs(r12)>1.0 and .15<rp<.85:
            return (1 if r12>0 else -1,24,.74)
        if a>=0 and z<-.08 and abs(r6)>.8 and (rp>.75 or rp<.25):
            return (-1 if r6>0 else 1,12,.60)

    elif mech=='session_impulse_decay':
        hour=(int(ts)//HOUR)%24
        if hour not in (0,1,7,8,13,14,16,17):return None
        m=b.median_move(candles,idx,ts,6); rel=r6-m
        if abs(rel)>1.0 and eff>.30 and ((rel>0 and br>=.5) or (rel<0 and br<=.5)):
            return (1 if rel>0 else -1,12,.66)
        if abs(rel)>1.25 and eff<.16:
            return (-1 if rel>0 else 1,9,.52)

    elif mech=='overnight_range_resolution':
        hour=(int(ts)//HOUR)%24
        if hour not in (6,7,8,9,14,15,16):return None
        rp=b.range_position(c,i,48); prev=b.range_position(c,i-6,48); vr=v24/max(v96,1e-9)
        if prev<.78 and rp>.90 and r3>0 and eff>.26 and vr<2.0:return (1,15,.70)
        if prev>.22 and rp<.10 and r3<0 and eff>.26 and vr<2.0:return (-1,15,.70)
        if (rp>.92 and r3<-.4) or (rp<.08 and r3>.4):return (-1 if rp>.5 else 1,9,.48)
    return None

def run(style):
    b.CANDIDATES=STYLE_POOLS[style]; b.signal=signal
    candles,idx,_=b.base.load(); ps=b.base.periods(candles)
    chosen,diag=b.choose(candles,idx,ps['development'],CFG)
    dm,_,_=b.portfolio(chosen,candles,idx,*ps['development'],NORMAL_BPS,0,CFG)
    vm,_,_=b.portfolio(chosen,candles,idx,*ps['validation'],NORMAL_BPS,0,CFG)
    vs,_,_=b.portfolio(chosen,candles,idx,*ps['validation'],STRESS_BPS,1,CFG)
    res={'strategyId':f'PAIR_SPECIFIC_V103_{style.upper()}','periods':ps,'chosenPairEngines':chosen,'selection':diag,'development':dm,'validation':vm,'validationStress':vs,'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or (dm.get('returnPct') or 0)<=0 or (vm.get('pf') or 0)<1.05 or (vm.get('returnPct') or 0)<=0:
        res.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,_,_=b.portfolio(chosen,candles,idx,*ps['confirmation'],NORMAL_BPS,0,CFG); cs,_,_=b.portfolio(chosen,candles,idx,*ps['confirmation'],STRESS_BPS,1,CFG)
        res.update(confirmation=cm,confirmationStress=cs)
        if not b.gate(cm,cs):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=b.portfolio(chosen,candles,idx,*ps['holdout'],NORMAL_BPS,0,CFG); hs,_,_=b.portfolio(chosen,candles,idx,*ps['holdout'],STRESS_BPS,1,CFG)
            ym,yp,yc=b.portfolio(chosen,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0,CFG); ys,_,_=b.portfolio(chosen,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1,CFG)
            pos=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS); sh=[abs(v) for v in yc.values()]; conc=max(sh)/sum(sh) if sum(sh)>1e-9 else 1.0
            ok=b.gate(ym,ys) and (hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 and (ym.get('returnPct') or 0)>=60 and pos>=4 and conc<.45
            res.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,yearPair=yp,yearContribution=yc,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True); stem=f'pair-specific-v103-{style}'; txt=json.dumps(res,indent=2)
    (out/f'{stem}.json').write_text(txt,encoding='utf-8'); (out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n',encoding='utf-8'); print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--style',choices=STYLE_POOLS,required=True); args=ap.parse_args(); run(args.style)
