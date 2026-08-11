from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109

HOUR=v109.HOUR; NORMAL_BPS=v109.NORMAL_BPS; STRESS_BPS=v109.STRESS_BPS
ret=v109.ret; metric=v109.metric

CANDS={
 'btc_breakout_continuation':('BTC',.78,5.5,168),
 'btc_reversal_leadership':('BTC',.72,4.5,120),
 'eth_relative_acceleration':('ETH',.74,5.5,144),
 'bnb_regime_dependency':('BNB',.70,5.0,120),
 'avax_volatility_lifecycle':('AVAX',.62,7.0,96),
}

def mean(x): return statistics.fmean(x) if x else 0.0
def sd(x): return statistics.pstdev(x) if len(x)>1 else 1.0
def vol(c,i,n): return v109.b.vol(c,i,n)
def eff(c,i,n): return v109.b.efficiency(c,i,n)
def rp(c,i,n): return v109.b.range_position(c,i,n)

def zret(c,i,n,base=168):
    r=ret(c,i,n); v=vol(c,i,base)
    return 0.0 if r is None or v<=1e-9 else r/(v*math.sqrt(n)+1e-9)

def breadth(candles,idx,ts,n=24): return v109.b.breadth(candles,idx,ts,n)
def medmove(candles,idx,ts,n): return v109.b.median_move(candles,idx,ts,n)

def signal(cid,candles,idx,ts):
    s=CANDS[cid][0]; c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return 0
    r3=ret(c,i,3) or 0;r6=ret(c,i,6) or 0;r12=ret(c,i,12) or 0;r24=ret(c,i,24) or 0;r72=ret(c,i,72) or 0
    v24=vol(c,i,24);v96=vol(c,i,96);v336=vol(c,i,336);e=eff(c,i,72);b=breadth(candles,idx,ts,24);pos=rp(c,i,96)
    if v336<=1e-9 or v24>3.2*v336:return 0
    if cid=='btc_breakout_continuation':
        prev=rp(c,i-12,96); impulse=zret(c,i,12); trend=zret(c,i,72)
        if prev<.80 and pos>.90 and impulse>.85 and trend>.75 and e>.25 and b>=.50:return 1
        if prev>.20 and pos<.10 and impulse<-.85 and trend<-.75 and e>.25 and b<=.50:return -1
        if pos>.72 and r3<0 and r12>0 and trend>.55 and e>.22:return 1
        if pos<.28 and r3>0 and r12<0 and trend<-.55 and e>.22:return -1
    elif cid=='btc_reversal_leadership':
        med6=medmove(candles,idx,ts,6);med24=medmove(candles,idx,ts,24);d6=r6-med6;d24=r24-med24
        if d24>1.0 and d6<-.35 and pos>.78 and e<.24 and b<.67:return -1
        if d24<-1.0 and d6>.35 and pos<.22 and e<.24 and b>.33:return 1
        if abs(d24)>1.25 and abs(d6)>.55 and (d6*d24)<0 and e<.20:return -1 if d24>0 else 1
    elif cid=='eth_relative_acceleration':
        bi=idx['BTC'].get(ts)
        if bi is None:return 0
        btc=candles['BTC']; rel6=r6-(ret(btc,bi,6) or 0); rel24=r24-(ret(btc,bi,24) or 0); rel72=r72-(ret(btc,bi,72) or 0)
        if rel6>.55 and rel24>.85 and rel72>.65 and r6>0 and e>.23 and b>=.50:return 1
        if rel6<-.55 and rel24<-.85 and rel72<-.65 and r6<0 and e>.23 and b<=.50:return -1
        if rel24>.75 and rel6<-.25 and r3>0 and pos>.55 and e>.20:return 1
        if rel24<-.75 and rel6>.25 and r3<0 and pos<.45 and e>.20:return -1
    elif cid=='bnb_regime_dependency':
        bi=idx['BTC'].get(ts);ei=idx['ETH'].get(ts)
        if bi is None or ei is None:return 0
        btc=candles['BTC'];eth=candles['ETH']; market=.5*((ret(btc,bi,24) or 0)+(ret(eth,ei,24) or 0)); rel=r24-market
        active=.80 < v24/max(v96,1e-9) < 1.85 and e>.18
        if active and market>.65 and rel>.35 and r6>0 and pos>.55:return 1
        if active and market<-.65 and rel<-.35 and r6<0 and pos<.45:return -1
        if abs(market)<.35 and abs(rel)>1.25 and e<.18:return -1 if rel>0 else 1
    elif cid=='avax_volatility_lifecycle':
        vr=v24/max(v96,1e-9); impulse=zret(c,i,6);trend=zret(c,i,24)
        if .95<vr<1.85 and impulse>.70 and trend>.80 and e>.24 and pos>.60 and b>=.50:return 1
        if .95<vr<1.85 and impulse<-.70 and trend<-.80 and e>.24 and pos<.40 and b<=.50:return -1
        if vr>1.35 and vr<2.25 and trend>1.05 and r3<0 and e<.24 and pos>.78:return -1
        if vr>1.35 and vr<2.25 and trend<-1.05 and r3>0 and e<.24 and pos<.22:return 1
    return 0

def trades(cid,candles,idx,start,end,cost,delay):
    s,risk,trail,maxhold=CANDS[cid];c=candles[s];state=0;entry=peak=trough=None;ets=None;vals=[];recs=[];cool_until=-1
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        px=float(c[i]['close']); sig=signal(cid,candles,idx,ts)
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//HOUR
            adverse=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            reverse=(sig and sig==-state)
            fade=(state>0 and zret(c,i,12)<-.20) or (state<0 and zret(c,i,12)>.20)
            if reverse or adverse<=-trail or held>=maxhold or (held>=12 and fade):
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=(state*(xp/entry-1)*100-cost/100)*risk
                vals.append(pnl);recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':pnl});state=0;cool_until=ts+6*HOUR
        if state==0 and ts>=cool_until and sig:
            ei=i+1+delay
            if ei<len(c):state=sig;entry=float(c[ei]['open']);peak=entry;trough=entry;ets=ts
    return vals,recs

def eval_block(cid,candles,idx,p,cost,delay):
    x,_=trades(cid,candles,idx,*p,cost,delay);return metric(x)

def dev_stability(cid,candles,idx,p):
    a,b=p; step=(b-a)//3;out=[]
    for k in range(3):
        q=(a+k*step,b if k==2 else a+(k+1)*step);out.append(eval_block(cid,candles,idx,q,NORMAL_BPS,0))
    pos=sum((m.get('returnPct') or 0)>0 and (m.get('pf') or 0)>1 for m in out)
    return {'folds':out,'positivePfFolds':pos}

def run(cid):
    s=CANDS[cid][0];candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
    dm=eval_block(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=eval_block(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=eval_block(cid,candles,idx,ps['validation'],STRESS_BPS,1);stab=dev_stability(cid,candles,idx,ps['development'])
    res={'strategyId':'V110_'+cid.upper(),'pair':s,'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'developmentStability':stab,'productionChanged':False,'realTradingEnabled':False}
    devok=(dm.get('pf') or 0)>=1.05 and (dm.get('returnPct') or 0)>0 and stab['positivePfFolds']>=2
    valok=(vm.get('pf') or 0)>=1.05 and (vm.get('returnPct') or 0)>0 and (vs.get('pf') or 0)>1
    if not(devok and valok):res.update(status='FAIL',reason='DEV_VALIDATION')
    else:
        cm=eval_block(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=eval_block(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);res.update(confirmation=cm,confirmationStress=cs)
        if not((cm.get('pf') or 0)>=1.20 and (cm.get('returnPct') or 0)>0 and (cm.get('maxDDPct') or -999)>-20 and (cs.get('pf') or 0)>1):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm=eval_block(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=eval_block(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ym=eval_block(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0);ys=eval_block(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
            ok=(hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.20 and (ym.get('returnPct') or 0)>0 and (ym.get('maxDDPct') or -999)>-20 and (ys.get('pf') or 0)>1
            res.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);txt=json.dumps(res,indent=2);stem='active4-v110-'+cid;(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
