from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109

HOUR=v109.HOUR; NORMAL_BPS=v109.NORMAL_BPS; STRESS_BPS=v109.STRESS_BPS
ret=v109.ret; metric=v109.metric
CANDS={
 'btc_macro_impulse':('BTC',.74,5.8,240),
 'btc_breakout_reversal':('BTC',.70,5.2,192),
 'eth_leadership_cycle':('ETH',.72,6.0,216),
 'bnb_regime_release':('BNB',.66,5.5,180),
 'avax_burst_cycle':('AVAX',.58,7.0,168),
}

def vol(c,i,n): return v109.b.vol(c,i,n)
def eff(c,i,n): return v109.b.efficiency(c,i,n)
def rp(c,i,n): return v109.b.range_position(c,i,n)
def breadth(candles,idx,ts,n=24): return v109.b.breadth(candles,idx,ts,n)
def medmove(candles,idx,ts,n=24): return v109.b.median_move(candles,idx,ts,n)
def zz(c,i,n,base=168):
    v=vol(c,i,base); r=ret(c,i,n)
    return 0.0 if r is None or v<=1e-9 else r/(v*math.sqrt(n)+1e-9)
def slope(c,i,n):
    if i<n:return 0.0
    y=[math.log(float(c[j]['close'])) for j in range(i-n+1,i+1)]
    m=(n-1)/2; ym=statistics.fmean(y); den=sum((k-m)**2 for k in range(n))
    return 100*sum((k-m)*(x-ym) for k,x in enumerate(y))/den if den else 0.0

def feat(cid,candles,idx,ts):
    s=CANDS[cid][0]; c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    r3=ret(c,i,3) or 0;r6=ret(c,i,6) or 0;r12=ret(c,i,12) or 0;r24=ret(c,i,24) or 0;r72=ret(c,i,72) or 0;r168=ret(c,i,168) or 0
    v12=vol(c,i,12);v24=vol(c,i,24);v96=vol(c,i,96);v336=vol(c,i,336)
    if v336<=1e-9 or v96<=1e-9:return None
    p96=rp(c,i,96);p240=rp(c,i,240);e24=eff(c,i,24);e72=eff(c,i,72);e168=eff(c,i,168);br=breadth(candles,idx,ts,24)
    fast=zz(c,i,6); mid=zz(c,i,24); slow=zz(c,i,120); longz=zz(c,i,168)
    compression=v24/v96; volshock=v12/max(v96,1e-9); accel=fast-mid*.45
    return dict(s=s,c=c,i=i,r3=r3,r6=r6,r12=r12,r24=r24,r72=r72,r168=r168,v24=v24,v96=v96,v336=v336,p96=p96,p240=p240,e24=e24,e72=e72,e168=e168,br=br,fast=fast,mid=mid,slow=slow,longz=longz,compression=compression,volshock=volshock,accel=accel,sl12=slope(c,i,12),sl72=slope(c,i,72))

def cycle(cid,candles,idx,ts):
    f=feat(cid,candles,idx,ts)
    if not f:return {'bias':0,'init':0,'cont':0,'pull':0,'exhaust':0,'reverse':0}
    s=f['s']; bias=init=cont=pull=exhaust=reverse=0
    if cid=='btc_macro_impulse':
        # slow macro context + fast impulse + medium persistence, separate pullback continuation
        if f['slow']>.55 and f['e168']>.18 and f['p240']>.52:bias=1
        elif f['slow']<-.55 and f['e168']>.18 and f['p240']<.48:bias=-1
        if f['fast']>.75 and f['volshock']>.72 and f['e24']>.28 and f['br']>=.50:init=1
        elif f['fast']<-.75 and f['volshock']>.72 and f['e24']>.28 and f['br']<=.50:init=-1
        if f['mid']>.45 and f['sl72']>0 and f['p96']>.58:cont=1
        elif f['mid']<-.45 and f['sl72']<0 and f['p96']<.42:cont=-1
        if bias==1 and f['r24']>0 and f['r6']<0 and f['r3']>0 and .40<f['p96']<.78:pull=1
        elif bias==-1 and f['r24']<0 and f['r6']>0 and f['r3']<0 and .22<f['p96']<.60:pull=-1
        if f['p96']>.92 and f['accel']<-.35 and f['e24']<.22:exhaust=1
        elif f['p96']<.08 and f['accel']>.35 and f['e24']<.22:exhaust=-1
        if exhaust==1 and f['r3']<0:reverse=-1
        elif exhaust==-1 and f['r3']>0:reverse=1
    elif cid=='btc_breakout_reversal':
        prev=rp(f['c'],f['i']-12,120)
        if f['longz']>.35 and f['br']>=.50:bias=1
        elif f['longz']<-.35 and f['br']<=.50:bias=-1
        if prev<.78 and f['p96']>.92 and f['fast']>.60 and f['compression']>.78 and f['e24']>.25:init=1
        elif prev>.22 and f['p96']<.08 and f['fast']<-.60 and f['compression']>.78 and f['e24']>.25:init=-1
        if f['p96']>.65 and f['mid']>.25 and f['e72']>.24:cont=1
        elif f['p96']<.35 and f['mid']<-.25 and f['e72']>.24:cont=-1
        if bias==1 and f['p96']>.55 and f['r12']<0 and f['r3']>0:pull=1
        elif bias==-1 and f['p96']<.45 and f['r12']>0 and f['r3']<0:pull=-1
        if f['p96']>.90 and f['r6']<0 and f['volshock']>1.15:exhaust=1
        elif f['p96']<.10 and f['r6']>0 and f['volshock']>1.15:exhaust=-1
        if exhaust==1 and f['fast']<-.45:reverse=-1
        elif exhaust==-1 and f['fast']>.45:reverse=1
    elif cid=='eth_leadership_cycle':
        bi=idx['BTC'].get(ts); btc=candles['BTC']
        if bi is None:return {'bias':0,'init':0,'cont':0,'pull':0,'exhaust':0,'reverse':0}
        rel24=f['r24']-(ret(btc,bi,24) or 0); rel72=f['r72']-(ret(btc,bi,72) or 0); rel168=f['r168']-(ret(btc,bi,168) or 0)
        if rel168>.35 and rel72>0 and f['p240']>.50:bias=1
        elif rel168<-.35 and rel72<0 and f['p240']<.50:bias=-1
        if rel24>.35 and f['fast']>.55 and f['volshock']>.70 and f['e24']>.24:init=1
        elif rel24<-.35 and f['fast']<-.55 and f['volshock']>.70 and f['e24']>.24:init=-1
        if rel72>.30 and f['mid']>.25 and f['sl72']>0:cont=1
        elif rel72<-.30 and f['mid']<-.25 and f['sl72']<0:cont=-1
        if bias==1 and rel72>0 and f['r12']<0 and f['r3']>0 and f['p96']>.45:pull=1
        elif bias==-1 and rel72<0 and f['r12']>0 and f['r3']<0 and f['p96']<.55:pull=-1
        if abs(rel24)<.10 and abs(rel72)>.45 and f['e24']<.20:exhaust=1 if rel72>0 else -1
        if exhaust==1 and rel24<-.20:reverse=-1
        elif exhaust==-1 and rel24>.20:reverse=1
    elif cid=='bnb_regime_release':
        med=medmove(candles,idx,ts,72); rel72=f['r72']-med
        if f['e168']>.22 and abs(rel72)>.45:bias=1 if rel72>0 else -1
        prevcomp=vol(f['c'],f['i']-24,24)/max(vol(f['c'],f['i']-24,96),1e-9)
        if prevcomp<.72 and f['compression']>.90 and f['fast']>.55 and f['p96']>.62:init=1
        elif prevcomp<.72 and f['compression']>.90 and f['fast']<-.55 and f['p96']<.38:init=-1
        if bias==1 and f['mid']>.30 and f['e72']>.25 and f['br']>=.45:cont=1
        elif bias==-1 and f['mid']<-.30 and f['e72']>.25 and f['br']<=.55:cont=-1
        if bias==1 and f['r24']>0 and f['r6']<0 and f['r3']>0:pull=1
        elif bias==-1 and f['r24']<0 and f['r6']>0 and f['r3']<0:pull=-1
        if f['p96']>.90 and f['fast']<0 and f['compression']>1.20:exhaust=1
        elif f['p96']<.10 and f['fast']>0 and f['compression']>1.20:exhaust=-1
        if exhaust==1 and f['r3']<0:reverse=-1
        elif exhaust==-1 and f['r3']>0:reverse=1
    elif cid=='avax_burst_cycle':
        med=medmove(candles,idx,ts,24); rel=f['r24']-med
        if rel>.55 and f['br']>=.50 and f['p240']>.50:bias=1
        elif rel<-.55 and f['br']<=.50 and f['p240']<.50:bias=-1
        if abs(rel)>.70 and abs(f['fast'])>.50 and f['volshock']>.80 and f['e24']>.22:init=1 if rel>0 and f['fast']>0 else -1 if rel<0 and f['fast']<0 else 0
        if abs(rel)>.55 and abs(f['mid'])>.30 and f['e72']>.23:cont=1 if rel>0 and f['mid']>0 else -1 if rel<0 and f['mid']<0 else 0
        if bias==1 and f['r12']<0 and f['r3']>0 and f['p96']>.42:pull=1
        elif bias==-1 and f['r12']>0 and f['r3']<0 and f['p96']<.58:pull=-1
        if f['volshock']>1.45 and f['e24']<.18 and abs(f['fast'])<.20:exhaust=1 if f['p96']>.75 else -1 if f['p96']<.25 else 0
        if exhaust==1 and f['r3']<0:reverse=-1
        elif exhaust==-1 and f['r3']>0:reverse=1
    return {'bias':bias,'init':init,'cont':cont,'pull':pull,'exhaust':exhaust,'reverse':reverse}

def simulate(cid,candles,idx,start,end,cost,delay,records=False):
    s,risk,trail,maxhold=CANDS[cid]; c=candles[s]; state=0; entry=peak=trough=None; ets=None; vals=[]; recs=[]; cooldown=-1; phase='CASH'
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        cyc=cycle(cid,candles,idx,ts); px=float(c[i]['close'])
        if state:
            peak=max(peak,px); trough=min(trough,px); held=(ts-ets)//HOUR
            give=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            aligned=(cyc['cont']==state or cyc['pull']==state or cyc['bias']==state)
            reversal=(cyc['reverse']==-state)
            exhausted=(cyc['exhaust']==state and not aligned)
            exitnow=reversal or exhausted or give<=-trail or (held>=maxhold and not aligned)
            if exitnow:
                xi=min(i+1+delay,len(c)-1); xp=float(c[xi]['open']); pnl=(state*(xp/entry-1)*100-cost/100)*risk; vals.append(pnl)
                recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':pnl,'heldHours':held});state=0;phase='CASH';cooldown=ts+6*HOUR
        if state==0 and ts>=cooldown:
            d=0
            if cyc['init'] and (cyc['bias'] in (0,cyc['init'])): d=cyc['init'];phase='INIT'
            elif cyc['pull'] and cyc['bias']==cyc['pull']: d=cyc['pull'];phase='REENTRY'
            elif cyc['reverse'] and cyc['bias'] in (0,cyc['reverse']): d=cyc['reverse'];phase='REVERSAL'
            if d:
                ei=i+1+delay
                if ei<len(c): state=d;entry=float(c[ei]['open']);peak=trough=entry;ets=ts
    return (vals,recs) if records else vals

def evalm(cid,candles,idx,p,cost,delay): return metric(simulate(cid,candles,idx,*p,cost,delay))
def folds(cid,candles,idx,p):
    a,b=p; step=(b-a)//3; fs=[]
    for k in range(3):
        x=a+k*step; y=b if k==2 else a+(k+1)*step; fs.append(evalm(cid,candles,idx,(x,y),NORMAL_BPS,0))
    return {'folds':fs,'positivePfFolds':sum((m.get('returnPct') or 0)>0 and (m.get('pf') or 0)>1 for m in fs)}

def waves(cid,candles,idx,p):
    s=CANDS[cid][0]; c=candles[s]; start,end=p; _,recs=simulate(cid,candles,idx,start,end,NORMAL_BPS,0,True)
    ws=[]; last=-1
    for row in c:
        ts=int(row['ts']); i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=vol(c,i,168); mv=100*(float(c[i+48]['close'])/float(c[i]['close'])-1); th=max(3.0,2.0*v*math.sqrt(48))
        if abs(mv)<th:continue
        side=1 if mv>0 else -1; hit=next((r for r in recs if ts<=r['entryTs']<=ts+24*HOUR and r['side']==side),None)
        delay=None if hit is None else (hit['entryTs']-ts)/HOUR
        ws.append(delay); last=ts+48*HOUR
    got=[x for x in ws if x is not None]
    return {'majorWaves':len(ws),'captured':len(got),'captureRatePct':100*len(got)/len(ws) if ws else 0,'medianEntryDelayHours':statistics.median(got) if got else None,'missedWaves':len(ws)-len(got)}

def run(cid):
    s=CANDS[cid][0]; candles,idx,_=v109.b.base.load(); ps=v109.b.base.periods(candles)
    dm=evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1); st=folds(cid,candles,idx,ps['development']); wd={'development':waves(cid,candles,idx,ps['development']),'validation':waves(cid,candles,idx,ps['validation'])}
    res={'strategyId':'V112_'+cid.upper(),'pair':s,'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'developmentStability':st,'waveDiagnostics':wd,'productionChanged':False,'realTradingEnabled':False}
    promote=(dm.get('pf') or 0)>=1.05 and (dm.get('returnPct') or 0)>0 and st['positivePfFolds']>=2 and (vm.get('pf') or 0)>=1.05 and (vm.get('returnPct') or 0)>0 and (vs.get('pf') or 0)>1 and wd['validation']['captureRatePct']>=10
    if not promote:res.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
    else:
        cm=evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);res.update(confirmation=cm,confirmationStress=cs)
        if not((cm.get('pf') or 0)>=1.2 and (cm.get('returnPct') or 0)>0 and (cm.get('maxDDPct') or -999)>-20 and (cs.get('pf') or 0)>1):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm=evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ym=evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0);ys=evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1);ok=(hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and (ym.get('maxDDPct') or -999)>-20 and (ys.get('pf') or 0)>1;res.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);txt=json.dumps(res,indent=2);stem='active4-v112-'+cid;(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
