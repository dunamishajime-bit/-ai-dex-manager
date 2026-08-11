from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_active4_v113 as p

HOUR=p.HOUR; NORMAL_BPS=p.NORMAL_BPS; STRESS_BPS=p.STRESS_BPS
metric=p.metric; ret=p.ret
CANDS={
 'btc_macro_breakout':('BTC',.70,7.0,480),
 'btc_retest_wave':('BTC',.68,6.5,420),
 'eth_leadership_wave':('ETH',.68,7.0,384),
 'bnb_range_release':('BNB',.62,6.5,336),
 'avax_impulse_follow':('AVAX',.54,8.5,300),
}

def f(cid,candles,idx,ts):
    s=CANDS[cid][0]; c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    q={n:(ret(c,i,n) or 0.0) for n in (3,6,12,24,48,72,120,168,240,336)}
    v={n:p.vol(c,i,n) for n in (12,24,48,96,168,336)}
    if v[168]<=1e-9 or v[336]<=1e-9:return None
    z=lambda n:q[n]/(v[168]*math.sqrt(n)+1e-9)
    return {'s':s,'c':c,'i':i,'r':q,'v':v,'z6':z(6),'z24':z(24),'z72':z(72),'z168':z(168),
      'e24':p.eff(c,i,24),'e72':p.eff(c,i,72),'e168':p.eff(c,i,168),
      'rp72':p.rp(c,i,72),'rp168':p.rp(c,i,168),'rp336':p.rp(c,i,336),
      'br':p.breadth(candles,idx,ts,24),'vr':v[24]/v[168],'shock':v[12]/v[96],
      'sl48':p.slope(c,i,48),'sl168':p.slope(c,i,168)}

def state(cid,candles,idx,ts):
    x=f(cid,candles,idx,ts)
    z={'bias':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0}
    if not x:return z
    r=x['r']; i=x['i']; c=x['c']
    if cid=='btc_macro_breakout':
        # slow regime uses persistent 7d/14d direction; fast layer can enter before full slow confirmation
        if x['z168']>.16 and x['sl168']>0 and x['rp336']>.52:z['bias']=1
        elif x['z168']<-.16 and x['sl168']<0 and x['rp336']<.48:z['bias']=-1
        prev_hi=max(float(c[j]['high']) for j in range(i-120,i)); prev_lo=min(float(c[j]['low']) for j in range(i-120,i)); px=float(c[i]['close'])
        if px>prev_hi and x['z6']>.28 and x['e24']>.20 and x['vr']>.72:z['onset']=1
        elif px<prev_lo and x['z6']<-.28 and x['e24']>.20 and x['vr']>.72:z['onset']=-1
        if x['z72']>.10 and x['e72']>.24 and x['rp168']>.55:z['continue']=1
        elif x['z72']<-.10 and x['e72']>.24 and x['rp168']<.45:z['continue']=-1
        if z['bias']==1 and r[72]>0 and r[12]<0 and r[3]>0 and x['rp72']>.38:z['reentry']=1
        elif z['bias']==-1 and r[72]<0 and r[12]>0 and r[3]<0 and x['rp72']<.62:z['reentry']=-1
        if z['bias']==1 and x['z24']<-.30 and x['rp168']<.40:z['reverse']=-1
        elif z['bias']==-1 and x['z24']>.30 and x['rp168']>.60:z['reverse']=1
        if x['shock']>1.65 and x['e24']<.12:z['exhaust']=z['bias']
    elif cid=='btc_retest_wave':
        if x['z168']>.10 and x['e168']>.16:z['bias']=1
        elif x['z168']<-.10 and x['e168']>.16:z['bias']=-1
        if abs(x['z24'])>.22 and x['e24']>.24 and x['shock']>.72:z['onset']=1 if x['z24']>0 else -1
        if abs(x['z72'])>.10 and x['e72']>.20:z['continue']=1 if x['z72']>0 else -1
        # retest is primary edge: medium trend intact, fast counter-move then reclaim
        if z['bias']==1 and r[72]>0 and r[24]<0 and r[6]>0 and x['rp168']>.48:z['reentry']=1
        elif z['bias']==-1 and r[72]<0 and r[24]>0 and r[6]<0 and x['rp168']<.52:z['reentry']=-1
        if z['bias']==1 and r[72]<0 and x['z24']<-.24:z['reverse']=-1
        elif z['bias']==-1 and r[72]>0 and x['z24']>.24:z['reverse']=1
    elif cid=='eth_leadership_wave':
        bi=idx['BTC'].get(ts); btc=candles['BTC']
        if bi is None:return z
        rel24=r[24]-(ret(btc,bi,24) or 0); rel72=r[72]-(ret(btc,bi,72) or 0); rel168=r[168]-(ret(btc,bi,168) or 0)
        if rel168>.15 and r[168]>0:z['bias']=1
        elif rel168<-.15 and r[168]<0:z['bias']=-1
        if rel24>.20 and x['z6']>.24 and x['e24']>.18:z['onset']=1
        elif rel24<-.20 and x['z6']<-.24 and x['e24']>.18:z['onset']=-1
        if rel72>.16 and x['z72']>.08 and x['e72']>.20:z['continue']=1
        elif rel72<-.16 and x['z72']<-.08 and x['e72']>.20:z['continue']=-1
        if z['bias']==1 and rel72>0 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['bias']==-1 and rel72<0 and r[12]>0 and r[3]<0:z['reentry']=-1
        if z['bias']==1 and rel24<-.28 and r[24]<0:z['reverse']=-1
        elif z['bias']==-1 and rel24>.28 and r[24]>0:z['reverse']=1
        if abs(rel24)<.06 and abs(rel72)>.28 and x['shock']>1.35:z['exhaust']=z['bias']
    elif cid=='bnb_range_release':
        # require real compression then range escape; inactive states remain cash
        prevv=p.vol(c,i-24,24)/max(p.vol(c,i-24,168),1e-9)
        market=p.medmove(candles,idx,ts,72); rel72=r[72]-market
        active=x['e168']>.16 and abs(rel72)>.12
        if active and rel72>0:z['bias']=1
        elif active and rel72<0:z['bias']=-1
        prev_hi=max(float(c[j]['high']) for j in range(i-96,i)); prev_lo=min(float(c[j]['low']) for j in range(i-96,i)); px=float(c[i]['close'])
        if active and prevv<.72 and x['vr']>.78 and px>prev_hi and x['z6']>.20:z['onset']=1
        elif active and prevv<.72 and x['vr']>.78 and px<prev_lo and x['z6']<-.20:z['onset']=-1
        if active and abs(x['z72'])>.08 and x['e72']>.20:z['continue']=1 if x['z72']>0 else -1
        if z['bias']==1 and r[72]>0 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['bias']==-1 and r[72]<0 and r[12]>0 and r[3]<0:z['reentry']=-1
        if z['bias']==1 and rel72<-.08 and x['z24']<-.20:z['reverse']=-1
        elif z['bias']==-1 and rel72>.08 and x['z24']>.20:z['reverse']=1
    else:
        market=p.medmove(candles,idx,ts,24); rel24=r[24]-market
        if rel24>.16 and r[72]>0:z['bias']=1
        elif rel24<-.16 and r[72]<0:z['bias']=-1
        if rel24>.24 and x['z6']>.22 and x['shock']>.72 and x['e24']>.17:z['onset']=1
        elif rel24<-.24 and x['z6']<-.22 and x['shock']>.72 and x['e24']>.17:z['onset']=-1
        if abs(x['z72'])>.07 and x['e72']>.18 and abs(rel24)>.10:z['continue']=1 if x['z72']>0 else -1
        if z['bias']==1 and r[48]>0 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['bias']==-1 and r[48]<0 and r[12]>0 and r[3]<0:z['reentry']=-1
        if z['bias']==1 and rel24<-.20 and x['z24']<-.18:z['reverse']=-1
        elif z['bias']==-1 and rel24>.20 and x['z24']>.18:z['reverse']=1
        if x['shock']>1.75 and x['e24']<.11:z['exhaust']=z['bias']
    return z

def simulate(cid,candles,idx,start,end,cost,delay,records=False):
    s,risk,trail,maxhold=CANDS[cid]; c=candles[s]; pos=0; entry=peak=trough=None; ets=None; vals=[]; recs=[]; cool=-1
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        st=state(cid,candles,idx,ts); px=float(c[i]['close'])
        if pos:
            peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//HOUR
            give=(px/peak-1)*100 if pos>0 else (trough/px-1)*100
            medium_ok=(st['continue']==pos or st['bias']==pos)
            reverse=(st['reverse']==-pos)
            exhaust=(st['exhaust']==pos and not medium_ok)
            # strong waves get hysteresis; only structural reverse, exhaustion or wider trail exits early
            exitnow=reverse or exhaust or give<=-trail or (held>=maxhold and not medium_ok)
            if exitnow:
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=(pos*(xp/entry-1)*100-cost/100)*risk
                vals.append(pnl);recs.append({'entryTs':ets,'exitTs':ts,'side':pos,'pnl':pnl,'entry':entry,'exit':xp,'heldHours':held});pos=0;cool=ts+6*HOUR
        if pos==0 and ts>=cool:
            d=0
            if st['onset'] and st['bias'] in (0,st['onset']):d=st['onset']
            elif st['reentry'] and st['bias']==st['reentry']:d=st['reentry']
            elif st['continue'] and st['bias']==st['continue']:d=st['continue']
            elif st['reverse'] and st['bias'] in (0,st['reverse']):d=st['reverse']
            if d:
                ei=i+1+delay
                if ei<len(c):pos=d;entry=float(c[ei]['open']);peak=trough=entry;ets=ts
    return (vals,recs) if records else vals

def evalm(cid,candles,idx,per,cost,delay):return metric(simulate(cid,candles,idx,*per,cost,delay))
def wave_diag(cid,candles,idx,per):
    s=CANDS[cid][0];c=candles[s];start,end=per;_,recs=simulate(cid,candles,idx,start,end,NORMAL_BPS,0,True);waves=[];last=-1
    for row in c:
        ts=int(row['ts']);i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=p.vol(c,i,168);p0=float(c[i]['close']);future=[float(c[j]['close']) for j in range(i+1,min(i+49,len(c)))]
        up=100*(max(future)/p0-1);dn=100*(min(future)/p0-1);th=max(3,2*v*math.sqrt(48))
        if max(up,-dn)<th:continue
        side=1 if up>=-dn else -1;mfe=up if side>0 else -dn
        hit=next((r for r in recs if ts<=r['entryTs']<=ts+24*HOUR and r['side']==side),None)
        waves.append((None,0) if not hit else ((hit['entryTs']-ts)/HOUR,100*max(0,side*(hit['exit']/hit['entry']-1)*100)/max(mfe,1e-9)))
        last=ts+48*HOUR
    got=[x for x in waves if x[0] is not None]
    return {'majorWaves':len(waves),'captured':len(got),'captureRatePct':100*len(got)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median([x[0] for x in got]) if got else None,'medianWaveMfeCapturedPct':statistics.median([x[1] for x in got]) if got else None,'missedWaves':len(waves)-len(got)}
def folds(cid,candles,idx,per):
    a,b=per;step=(b-a)//3;ms=[]
    for k in range(3):ms.append(evalm(cid,candles,idx,(a+k*step,b if k==2 else a+(k+1)*step),NORMAL_BPS,0))
    return {'folds':ms,'positivePfFolds':sum((m.get('returnPct') or 0)>0 and (m.get('pf') or 0)>1 for m in ms)}
def run(cid):
    candles,idx,_=p.v109.b.base.load();ps=p.v109.b.base.periods(candles)
    dm=evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
    dw=wave_diag(cid,candles,idx,ps['development']);vw=wave_diag(cid,candles,idx,ps['validation']);df=folds(cid,candles,idx,ps['development']);vf=folds(cid,candles,idx,ps['validation'])
    result={'strategyId':'V114_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
    promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
    if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
    else:
        cm=evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);result.update(confirmation=cm,confirmationStress=cs)
        if (cm.get('pf') or 0)<=1 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm=evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1);result.update(holdout=hm,holdoutStress=hs,status='PASS' if (hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 else 'FAIL',reason='PASS' if (hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 else 'HOLDOUT')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v114-'+cid;txt=json.dumps(result,indent=2);(out/(stem+'.json')).write_text(txt);(out/(stem+'.md')).write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=CANDS,required=True);run(ap.parse_args().candidate)
