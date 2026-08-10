from __future__ import annotations

import argparse, json, math, os, statistics
from pathlib import Path

import research_lab_six_pair_one_year_v98 as base

HOUR=base.HOUR
SYMS=["BTC","ETH","BNB","SOL","LINK","AVAX"]
NORMAL_BPS=10.0
STRESS_BPS=30.0
ret=base.ret
metric=base.metric
future_trade=base.future_trade


def mean(xs): return statistics.fmean(xs) if xs else 0.0
def sd(xs): return statistics.pstdev(xs) if len(xs)>1 else 0.0
def rseries(c,i,n):
    if i<n:return []
    return [ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]
def efficiency(c,i,n=72):
    if i<n:return 0.0
    p=[float(c[j]["close"]) for j in range(i-n,i+1)]
    path=sum(abs(p[j]-p[j-1]) for j in range(1,len(p)))
    return abs(p[-1]-p[0])/path if path>1e-12 else 0.0
def vol(c,i,n): return sd(rseries(c,i,n))
def skew(xs):
    if len(xs)<8:return 0.0
    m=mean(xs); s=sd(xs)
    return mean([((x-m)/s)**3 for x in xs]) if s>1e-12 else 0.0
def kurt(xs):
    if len(xs)<8:return 0.0
    m=mean(xs); s=sd(xs)
    return mean([((x-m)/s)**4 for x in xs])-3 if s>1e-12 else 0.0
def breadth(candles,idx,ts,n=24):
    xs=[]
    for s in SYMS:
        i=idx[s].get(ts)
        if i is not None:
            v=ret(candles[s],i,n)
            if v is not None:xs.append(v)
    return sum(v>0 for v in xs)/len(xs) if xs else .5
def median_move(candles,idx,ts,n):
    xs=[]
    for s in SYMS:
        i=idx[s].get(ts)
        if i is not None:
            v=ret(candles[s],i,n)
            if v is not None:xs.append(v)
    return statistics.median(xs) if xs else 0.0
def residual_series(candles,idx,s,ts,n=192):
    i=idx[s].get(ts); bi=idx['BTC'].get(ts); ei=idx['ETH'].get(ts)
    if i is None or bi is None or ei is None or min(i,bi,ei)<n:return []
    ar=rseries(candles[s],i,n); br=rseries(candles['BTC'],bi,n); er=rseries(candles['ETH'],ei,n)
    return [a-.55*b-.45*e for a,b,e in zip(ar,br,er)]
def range_position(c,i,n=72):
    if i<n:return .5
    hi=max(float(c[j]['high']) for j in range(i-n+1,i+1)); lo=min(float(c[j]['low']) for j in range(i-n+1,i+1)); px=float(c[i]['close'])
    return (px-lo)/(hi-lo) if hi>lo else .5

CANDIDATES={
 'BTC':['tail_state_normalization','breadth_divergence_router','range_escape_quality'],
 'ETH':['dual_factor_residual_reversion','tail_state_normalization','breadth_divergence_router'],
 'BNB':['range_escape_quality','vol_cluster_reversal','dual_factor_residual_reversion'],
 'SOL':['vol_cluster_reversal','breadth_divergence_router','tail_state_normalization'],
 'LINK':['dual_factor_residual_reversion','range_escape_quality','vol_cluster_reversal'],
 'AVAX':['tail_state_normalization','vol_cluster_reversal','breadth_divergence_router'],
}
ARCH={
 'A':{'risk':.95,'cool':6,'maxslots':3},
 'B':{'risk':.80,'cool':9,'maxslots':4},
 'C':{'risk':1.05,'cool':5,'maxslots':2},
 'D':{'risk':.70,'cool':12,'maxslots':3},
}

def signal(mech,s,candles,idx,ts,cfg):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    r3=ret(c,i,3); r6=ret(c,i,6); r12=ret(c,i,12); r24=ret(c,i,24); r72=ret(c,i,72)
    if None in (r3,r6,r12,r24,r72):return None
    v24=vol(c,i,24); v96=vol(c,i,96); v336=vol(c,i,336); eff=efficiency(c,i,72); br=breadth(candles,idx,ts,24)
    if v336<=1e-9:return None
    if v24>3.0*v336 and eff<.11:return None

    if mech=='tail_state_normalization':
        old=rseries(c,i-48,168); new=rseries(c,i,72)
        if len(old)<100 or len(new)<60:return None
        ko,kn=kurt(old),kurt(new); so,sn=skew(old),skew(new)
        if ko>1.0 and so<-.35 and kn<.65 and sn>-.20 and r3>0 and r24<0 and br>=.34:
            return (1,24,.78)
        if ko>1.0 and so>.35 and kn<.65 and sn<.20 and r3<0 and r24>0 and br<=.66:
            return (-1,18,.68)

    elif mech=='breadth_divergence_router':
        m6=median_move(candles,idx,ts,6); m24=median_move(candles,idx,ts,24)
        d6=r6-m6; d24=r24-m24; rp=range_position(c,i,96)
        if abs(d6)>.75 and abs(d24)>1.25:
            if eff>.28 and ((d6>0 and br>=.50) or (d6<0 and br<=.50)):
                return (1 if d6>0 else -1,18,.72)
            if eff<.18 and ((d6>0 and rp>.78) or (d6<0 and rp<.22)):
                return (-1 if d6>0 else 1,12,.58)

    elif mech=='range_escape_quality':
        rp=range_position(c,i,96); prev=range_position(c,i-12,96); vr=v24/max(v96,1e-9)
        if prev<.82 and rp>.92 and r6>0 and eff>.30 and .85<vr<2.25 and br>=.45:
            return (1,24,.82)
        if prev>.18 and rp<.08 and r6<0 and eff>.30 and .85<vr<2.25 and br<=.55:
            return (-1,24,.82)
        if rp>.90 and r3<-.45 and eff<.22:return (-1,12,.50)
        if rp<.10 and r3>.45 and eff<.22:return (1,12,.50)

    elif mech=='vol_cluster_reversal':
        q=[]
        for k in range(8):
            j=i-k*12
            if j<96:break
            q.append(vol(c,j,12)/max(vol(c,j,96),1e-9))
        if len(q)<6:return None
        persistent=sum(x>1.25 for x in q)>=5; calming=q[0]<q[1] and q[0]<1.20
        if persistent and calming and abs(r24)>1.6 and r3*r24<0 and eff<.30:
            return (-1 if r24>0 else 1,18,.66)

    elif mech=='dual_factor_residual_reversion':
        rr=residual_series(candles,idx,s,ts,240)
        if len(rr)<200:return None
        old=rr[:-24]; recent=rr[-24:]; z=sum(recent[-6:])/(sd(old)*math.sqrt(6)+1e-9); compression=sd(recent)/max(sd(old),1e-9)
        if compression>1.30 and abs(z)>1.15 and r3*z<0 and eff<.28:
            return (-1 if z>0 else 1,18,.68)
    return None

def events(mech,s,candles,idx,start,end,cost,delay,cfg):
    out=[]; last=-1
    for row in candles[s]:
        ts=int(row['ts'])
        if not(start<=ts<end) or ts<=last:continue
        sg=signal(mech,s,candles,idx,ts,cfg)
        if not sg:continue
        side,hold,w=sg
        x=future_trade(candles[s],idx[s],ts,side,hold,delay,cost)
        if x is None:continue
        out.append((ts,x*w*cfg['risk'])); last=ts+(hold+cfg['cool'])*HOUR
    return out

def choose(candles,idx,period,cfg):
    chosen={}; diag={}
    for s in SYMS:
        best=None
        for mech in CANDIDATES[s]:
            vals=[v for _,v in events(mech,s,candles,idx,*period,NORMAL_BPS,0,cfg)]
            m=metric(vals); pf=m.get('pf') or 0; tr=m.get('trades') or 0; rp=m.get('returnPct') or 0; dd=abs(m.get('maxDDPct') or 0); conc=m.get('bestSharePct') or 100
            score=1.8*rp+9*(min(pf,2.5)-1)+.18*min(tr,50)-.32*dd-.13*max(0,conc-35)
            if best is None or score>best[0]:best=(score,mech,m)
        chosen[s]=best[1]; diag[s]={'mechanism':best[1],'development':best[2]}
    return chosen,diag

def portfolio(chosen,candles,idx,start,end,cost,delay,cfg):
    byts={}; pair={s:[] for s in SYMS}
    for s,m in chosen.items():
        for ts,v in events(m,s,candles,idx,start,end,cost,delay,cfg):
            byts.setdefault(ts,[]).append((s,v)); pair[s].append(v)
    vals=[]; contrib={s:0.0 for s in SYMS}
    for ts in sorted(byts):
        xs=sorted(byts[ts],key=lambda z:abs(z[1]),reverse=True)[:cfg['maxslots']]
        if not xs:continue
        scale=min(1.0,1.65/len(xs)); vals.append(sum(v*scale for _,v in xs))
        for s,v in xs:contrib[s]+=v*scale
    return metric(vals),{s:metric(pair[s]) for s in SYMS},contrib

def gate(m,stress):
    return (m.get('pf') or 0)>=1.20 and (m.get('returnPct') or 0)>0 and (m.get('maxDDPct') or -999)>-20 and (stress.get('pf') or 0)>1.0

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--arch',choices=ARCH,required=True); a=ap.parse_args(); cfg=ARCH[a.arch]
    candles,idx,_=base.load(); ps=base.periods(candles); chosen,diag=choose(candles,idx,ps['development'],cfg)
    dm,_,_=portfolio(chosen,candles,idx,*ps['development'],NORMAL_BPS,0,cfg)
    vm,_,_=portfolio(chosen,candles,idx,*ps['validation'],NORMAL_BPS,0,cfg)
    vs,_,_=portfolio(chosen,candles,idx,*ps['validation'],STRESS_BPS,1,cfg)
    result={'strategyId':f'PAIR_SPECIFIC_V102_{a.arch}','periods':ps,'chosenPairEngines':chosen,'selection':diag,'development':dm,'validation':vm,'validationStress':vs,'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or (dm.get('returnPct') or 0)<=0 or (vm.get('pf') or 0)<1.05 or (vm.get('returnPct') or 0)<=0:
        result.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,_,_=portfolio(chosen,candles,idx,*ps['confirmation'],NORMAL_BPS,0,cfg); cs,_,_=portfolio(chosen,candles,idx,*ps['confirmation'],STRESS_BPS,1,cfg)
        result.update(confirmation=cm,confirmationStress=cs)
        if not gate(cm,cs):result.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=portfolio(chosen,candles,idx,*ps['holdout'],NORMAL_BPS,0,cfg); hs,_,_=portfolio(chosen,candles,idx,*ps['holdout'],STRESS_BPS,1,cfg)
            y0=ps['development'][0]; y1=ps['holdout'][1]; ym,yp,yc=portfolio(chosen,candles,idx,y0,y1,NORMAL_BPS,0,cfg); ys,_,_=portfolio(chosen,candles,idx,y0,y1,STRESS_BPS,1,cfg)
            positive=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS); shares=[abs(v) for v in yc.values()]; concentration=max(shares)/sum(shares) if sum(shares)>1e-9 else 1.0
            ok=gate(ym,ys) and (hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 and (ym.get('returnPct') or 0)>=60 and positive>=4 and concentration<.45
            result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,yearPair=yp,yearContribution=yc,pairConcentration=concentration,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True); stem=f"pair-specific-v101-{a.arch.lower()}"; txt=json.dumps(result,indent=2)
    (out/f'{stem}.json').write_text(txt,encoding='utf-8'); (out/f'{stem}.md').write_text(f"# {result['strategyId']}\n\n```json\n{txt}\n```\n",encoding='utf-8'); print(txt)
if __name__=='__main__':main()
