from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b
SYMS=b.SYMS; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS; HOUR=b.HOUR
ret=b.ret; metric=b.metric; future_trade=b.future_trade
STYLE_POOLS={
 'serial_state':{
  'BTC':['autocorr_state_router','vol_term_rotation'],'ETH':['vol_term_rotation','autocorr_state_router'],
  'BNB':['autocorr_state_router','drawdown_recovery_state'],'SOL':['vol_term_rotation','autocorr_state_router'],
  'LINK':['drawdown_recovery_state','autocorr_state_router'],'AVAX':['autocorr_state_router','vol_term_rotation']},
 'asymmetry_state':{
  'BTC':['downside_asymmetry_release','drawdown_recovery_state'],'ETH':['drawdown_recovery_state','downside_asymmetry_release'],
  'BNB':['downside_asymmetry_release','relative_vol_lead'],'SOL':['relative_vol_lead','downside_asymmetry_release'],
  'LINK':['drawdown_recovery_state','relative_vol_lead'],'AVAX':['downside_asymmetry_release','drawdown_recovery_state']},
 'relative_state':{
  'BTC':['relative_vol_lead','vol_term_rotation'],'ETH':['relative_vol_lead','drawdown_recovery_state'],
  'BNB':['vol_term_rotation','relative_vol_lead'],'SOL':['relative_vol_lead','autocorr_state_router'],
  'LINK':['relative_vol_lead','downside_asymmetry_release'],'AVAX':['vol_term_rotation','relative_vol_lead']}}
CFG={'risk':.86,'cool':8,'maxslots':3}

def corr(x,y):
    if len(x)<24 or len(x)!=len(y):return 0.0
    mx=statistics.fmean(x); my=statistics.fmean(y)
    vx=sum((a-mx)**2 for a in x); vy=sum((a-my)**2 for a in y)
    return sum((a-mx)*(c-my) for a,c in zip(x,y))/math.sqrt(vx*vy) if vx>1e-12 and vy>1e-12 else 0.0

def semivol(c,i,n):
    rs=b.rseries(c,i,n); up=[x*x for x in rs if x>0]; dn=[x*x for x in rs if x<0]
    return math.sqrt(sum(dn)/max(1,len(dn))),math.sqrt(sum(up)/max(1,len(up)))

def signal(mech,s,candles,idx,ts,cfg):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    r3=ret(c,i,3); r6=ret(c,i,6); r12=ret(c,i,12); r24=ret(c,i,24); r72=ret(c,i,72); r168=ret(c,i,168)
    if None in (r3,r6,r12,r24,r72,r168):return None
    v24=b.vol(c,i,24); v96=b.vol(c,i,96); v336=b.vol(c,i,336); eff=b.efficiency(c,i,72); br=b.breadth(candles,idx,ts,24); rp=b.range_position(c,i,168)
    if v336<=1e-9 or v24>3.2*v336:return None
    if mech=='vol_term_rotation':
        old=b.vol(c,i-48,24)/max(b.vol(c,i-48,336),1e-9); now=v24/max(v336,1e-9); mid=v96/max(v336,1e-9)
        if old<.72 and now>1.05 and now>mid*1.15 and eff>.24 and abs(r12)>1.0 and ((r12>0 and br>=.5) or (r12<0 and br<=.5)):return (1 if r12>0 else -1,24,.72)
        if old>1.25 and now<.90 and eff<.22 and abs(r24)>2.0 and r3*r24<0:return (-1 if r24>0 else 1,15,.60)
    elif mech=='autocorr_state_router':
        rs=b.rseries(c,i,336); old=rs[:168]; new=rs[-168:]
        ao=corr(old[:-1],old[1:]); an=corr(new[:-1],new[1:])
        if ao<-.04 and an>.08 and abs(r12)>1.0 and eff>.23:return (1 if r12>0 else -1,24,.70)
        if ao>.08 and an<-.04 and abs(r12)>1.5 and eff<.25 and r3*r12<0:return (-1 if r12>0 else 1,15,.60)
    elif mech=='downside_asymmetry_release':
        od,ou=semivol(c,i-72,168); nd,nu=semivol(c,i,72); ro=od/max(ou,1e-9); rn=nd/max(nu,1e-9)
        if ro>1.22 and rn<.88 and r6>.25 and rp<.70 and br>=.5:return (1,24,.68)
        if ro<.82 and rn>1.28 and r6<-.25 and rp>.30 and br<=.5:return (-1,21,.66)
    elif mech=='relative_vol_lead':
        own=r24/max(v96*math.sqrt(24),1e-9); peers=[]
        for q in SYMS:
            qi=idx[q].get(ts)
            if qi is None:continue
            qr=ret(candles[q],qi,24); qv=b.vol(candles[q],qi,96)
            if qr is not None and qv>1e-9:peers.append(qr/(qv*math.sqrt(24)))
        med=statistics.median(peers) if peers else 0.0; rel=own-med
        if rel>.70 and r6>.20 and eff>.25 and br>=.5 and rp>.52:return (1,24,.72)
        if rel<-.70 and r6<-.20 and eff>.25 and br<=.5 and rp<.48:return (-1,24,.72)
    elif mech=='drawdown_recovery_state':
        hi=max(float(c[j]['high']) for j in range(i-168,i+1)); px=float(c[i]['close']); dd=100*(px/hi-1)
        oldhi=max(float(c[j]['high']) for j in range(i-240,i-72)); oldpx=float(c[i-72]['close']); olddd=100*(oldpx/oldhi-1)
        if olddd<-10 and dd>-7 and r24>1.2 and r6>0 and br>=.5 and eff>.20:return (1,30,.70)
        lo=min(float(c[j]['low']) for j in range(i-168,i+1)); up=100*(px/lo-1); oldlo=min(float(c[j]['low']) for j in range(i-240,i-72)); oldup=100*(oldpx/oldlo-1)
        if oldup>12 and up<8 and r24<-1.2 and r6<0 and br<=.5 and eff>.20:return (-1,24,.66)
    return None

def run(style):
    b.CANDIDATES=STYLE_POOLS[style]; b.signal=signal
    candles,idx,_=b.base.load(); ps=b.base.periods(candles); chosen,diag=b.choose(candles,idx,ps['development'],CFG)
    dm,_,_=b.portfolio(chosen,candles,idx,*ps['development'],NORMAL_BPS,0,CFG); vm,_,_=b.portfolio(chosen,candles,idx,*ps['validation'],NORMAL_BPS,0,CFG); vs,_,_=b.portfolio(chosen,candles,idx,*ps['validation'],STRESS_BPS,1,CFG)
    res={'strategyId':f'PAIR_SPECIFIC_V106_{style.upper()}','periods':ps,'chosenPairEngines':chosen,'selection':diag,'development':dm,'validation':vm,'validationStress':vs,'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or (dm.get('returnPct') or 0)<=0 or (vm.get('pf') or 0)<1.05 or (vm.get('returnPct') or 0)<=0:res.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,_,_=b.portfolio(chosen,candles,idx,*ps['confirmation'],NORMAL_BPS,0,CFG); cs,_,_=b.portfolio(chosen,candles,idx,*ps['confirmation'],STRESS_BPS,1,CFG); res.update(confirmation=cm,confirmationStress=cs)
        if not b.gate(cm,cs):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=b.portfolio(chosen,candles,idx,*ps['holdout'],NORMAL_BPS,0,CFG); hs,_,_=b.portfolio(chosen,candles,idx,*ps['holdout'],STRESS_BPS,1,CFG); ym,yp,yc=b.portfolio(chosen,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0,CFG); ys,_,_=b.portfolio(chosen,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1,CFG)
            pos=sum((yp[x].get('returnPct') or 0)>0 for x in SYMS); sh=[abs(v) for v in yc.values()]; conc=max(sh)/sum(sh) if sum(sh)>1e-9 else 1.0
            ok=b.gate(ym,ys) and (hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 and (ym.get('returnPct') or 0)>=60 and pos>=4 and conc<.45
            res.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,yearPair=yp,yearContribution=yc,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True); stem=f'pair-specific-v106-{style}'; txt=json.dumps(res,indent=2); (out/f'{stem}.json').write_text(txt,encoding='utf-8'); (out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n',encoding='utf-8'); print(txt)
if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--style',choices=STYLE_POOLS,required=True); a=ap.parse_args(); run(a.style)
