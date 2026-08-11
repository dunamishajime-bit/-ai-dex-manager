from __future__ import annotations
import argparse, json, math, os, statistics
from pathlib import Path
import research_active4_v114 as b

HOUR=b.HOUR; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS
metric=b.metric; ret=b.ret; p=b.p
CANDS={
 'btc_phase_accel':('BTC',.68,5.8,504),
 'btc_drawdown_reclaim':('BTC',.66,5.5,432),
 'eth_beta_expansion':('ETH',.64,6.2,420),
 'bnb_breakout_persistence':('BNB',.58,5.8,360),
 'avax_volatility_burst':('AVAX',.50,7.2,312),
}

def mean(xs): return statistics.fmean(xs) if xs else 0.0

def feat(cid,candles,idx,ts):
    s=CANDS[cid][0]; c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    rs={n:(ret(c,i,n) or 0.0) for n in (3,6,12,24,48,72,120,168,240,336)}
    vs={n:p.vol(c,i,n) for n in (12,24,48,96,168,336)}
    if vs[168]<=1e-9 or vs[336]<=1e-9:return None
    z=lambda n:rs[n]/(vs[168]*math.sqrt(n)+1e-9)
    px=float(c[i]['close'])
    hi120=max(float(c[j]['high']) for j in range(i-120,i)); lo120=min(float(c[j]['low']) for j in range(i-120,i))
    hi240=max(float(c[j]['high']) for j in range(i-240,i)); lo240=min(float(c[j]['low']) for j in range(i-240,i))
    qv=[float(c[j].get('volume',0) or 0) for j in range(i-168,i+1)]
    vratio=(mean(qv[-12:])+1e-9)/(mean(qv[-168:])+1e-9)
    return {'s':s,'c':c,'i':i,'r':rs,'v':vs,'z3':z(3),'z6':z(6),'z12':z(12),'z24':z(24),'z48':z(48),'z72':z(72),'z168':z(168),'z240':z(240),
            'e24':p.eff(c,i,24),'e72':p.eff(c,i,72),'e168':p.eff(c,i,168),'rp72':p.rp(c,i,72),'rp168':p.rp(c,i,168),'rp336':p.rp(c,i,336),
            'br':p.breadth(candles,idx,ts,24),'vr':vs[24]/vs[168],'shock':vs[12]/vs[96],'sl48':p.slope(c,i,48),'sl168':p.slope(c,i,168),
            'px':px,'hi120':hi120,'lo120':lo120,'hi240':hi240,'lo240':lo240,'volumeRatio':vratio}

def state(cid,candles,idx,ts):
    x=feat(cid,candles,idx,ts)
    z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
    if not x:return z
    r=x['r']; c=x['c']; i=x['i']
    if cid=='btc_phase_accel':
        if x['z240']>.05 and x['sl168']>=0:z['bias']=1
        elif x['z240']<-.05 and x['sl168']<=0:z['bias']=-1
        compress=x['v'][48] < .88*x['v'][168] and x['e72']<.30
        if compress:z['prewave']=1
        accel=(x['z6']-.45*x['z24'])
        if accel>.20 and r[12]>0 and x['e24']>.14 and x['vr']>.62:z['onset']=1
        elif accel<-.20 and r[12]<0 and x['e24']>.14 and x['vr']>.62:z['onset']=-1
        if x['z48']>.07 and x['sl48']>0 and x['e72']>.18:z['continue']=1
        elif x['z48']<-.07 and x['sl48']<0 and x['e72']>.18:z['continue']=-1
        if z['bias']==1 and r[72]>0 and r[12]<0 and x['z3']>.08 and x['rp72']>.30:z['reentry']=1
        elif z['bias']==-1 and r[72]<0 and r[12]>0 and x['z3']<-.08 and x['rp72']<.70:z['reentry']=-1
        if r[48]<0 and x['sl48']<0 and x['rp168']<.42:z['reverse']=-1
        elif r[48]>0 and x['sl48']>0 and x['rp168']>.58:z['reverse']=1
        z['strength']=abs(x['z48'])+.6*x['e72']+.25*abs(x['z168'])
        if x['shock']>1.85 and x['e24']<.10:z['exhaust']=1 if r[24]>0 else -1
    elif cid=='btc_drawdown_reclaim':
        if x['z168']>.04 and x['rp336']>.46:z['bias']=1
        elif x['z168']<-.04 and x['rp336']<.54:z['bias']=-1
        dd_from_hi=100*(x['px']/x['hi120']-1); bounce_from_lo=100*(x['px']/x['lo120']-1)
        if z['bias']==1 and dd_from_hi<-1.0 and x['v'][24]<1.15*x['v'][168]:z['prewave']=1
        elif z['bias']==-1 and bounce_from_lo>1.0 and x['v'][24]<1.15*x['v'][168]:z['prewave']=-1
        if z['bias']==1 and r[24]<0 and r[6]>0 and x['z3']>.10 and x['rp168']>.38:z['onset']=1
        elif z['bias']==-1 and r[24]>0 and r[6]<0 and x['z3']<-.10 and x['rp168']<.62:z['onset']=-1
        if z['bias']==1 and r[72]>0 and x['sl48']>0 and x['e72']>.16:z['continue']=1
        elif z['bias']==-1 and r[72]<0 and x['sl48']<0 and x['e72']>.16:z['continue']=-1
        if z['continue']==1 and r[12]<0 and r[3]>0:z['reentry']=1
        elif z['continue']==-1 and r[12]>0 and r[3]<0:z['reentry']=-1
        if z['bias']==1 and x['px']<x['lo120'] and x['z12']<-.18:z['reverse']=-1
        elif z['bias']==-1 and x['px']>x['hi120'] and x['z12']>.18:z['reverse']=1
        z['strength']=abs(x['z72'])+.5*x['e72']
    elif cid=='eth_beta_expansion':
        bi=idx['BTC'].get(ts); btc=candles['BTC']
        if bi is None or bi<240:return z
        rb={n:(ret(btc,bi,n) or 0.0) for n in (6,24,72,168,240)}
        rel={n:r[n]-rb[n] for n in (6,24,72,168,240)}
        if rel[168]>.08 or (r[168]>0 and rel[72]>.04):z['bias']=1
        elif rel[168]<-.08 or (r[168]<0 and rel[72]<-.04):z['bias']=-1
        if x['v'][48]<.9*x['v'][168] and abs(rel[72])<.35:z['prewave']=1
        resacc=rel[6]-.35*rel[24]
        if resacc>.16 and r[6]>0 and x['vr']>.68 and x['e24']>.13:z['onset']=1
        elif resacc<-.16 and r[6]<0 and x['vr']>.68 and x['e24']>.13:z['onset']=-1
        if rel[72]>.10 and r[72]>0 and x['sl48']>0:z['continue']=1
        elif rel[72]<-.10 and r[72]<0 and x['sl48']<0:z['continue']=-1
        if z['bias']==1 and rel[72]>0 and r[12]<0 and rel[6]>0:z['reentry']=1
        elif z['bias']==-1 and rel[72]<0 and r[12]>0 and rel[6]<0:z['reentry']=-1
        if rel[24]<-.18 and r[24]<0 and x['sl48']<0:z['reverse']=-1
        elif rel[24]>.18 and r[24]>0 and x['sl48']>0:z['reverse']=1
        z['strength']=abs(rel[72])/(x['v'][168]*math.sqrt(72)+1e-9)+.45*x['e72']
        if abs(rel[6])<.04 and abs(rel[72])>.30 and x['shock']>1.6:z['exhaust']=1 if rel[72]>0 else -1
    elif cid=='bnb_breakout_persistence':
        market=p.medmove(candles,idx,ts,72); rel72=r[72]-market
        comp=x['v'][48] < .82*x['v'][168] and x['e72']<.26
        if comp:z['prewave']=1
        if rel72>.06 and x['rp336']>.45:z['bias']=1
        elif rel72<-.06 and x['rp336']<.55:z['bias']=-1
        px1=float(c[i-1]['close']); px3=float(c[i-3]['close'])
        broke_up=x['px']>x['hi120'] and px1>px3 and r[6]>0
        broke_dn=x['px']<x['lo120'] and px1<px3 and r[6]<0
        if z['bias']==1 and broke_up and x['vr']>.70 and x['volumeRatio']>.80:z['onset']=1
        elif z['bias']==-1 and broke_dn and x['vr']>.70 and x['volumeRatio']>.80:z['onset']=-1
        if z['bias']==1 and r[48]>0 and x['rp168']>.58 and x['e72']>.16:z['continue']=1
        elif z['bias']==-1 and r[48]<0 and x['rp168']<.42 and x['e72']>.16:z['continue']=-1
        if z['continue']==1 and x['rp72']<.62 and r[6]>0:z['reentry']=1
        elif z['continue']==-1 and x['rp72']>.38 and r[6]<0:z['reentry']=-1
        if x['px']<x['hi120'] and r[24]<0 and x['rp168']<.45:z['reverse']=-1
        elif x['px']>x['lo120'] and r[24]>0 and x['rp168']>.55:z['reverse']=1
        z['strength']=abs(rel72)/(x['v'][168]*math.sqrt(72)+1e-9)+.4*x['e72']
    else:
        market=p.medmove(candles,idx,ts,24); rel24=r[24]-market; rel72=r[72]-p.medmove(candles,idx,ts,72)
        if rel72>.08 and r[72]>0:z['bias']=1
        elif rel72<-.08 and r[72]<0:z['bias']=-1
        if x['v'][48]<.86*x['v'][168] and x['e72']<.28:z['prewave']=1
        burst=x['v'][12]/max(x['v'][168],1e-9)
        if rel24>.10 and x['z6']>.14 and burst>.72 and x['e24']>.12:z['onset']=1
        elif rel24<-.10 and x['z6']<-.14 and burst>.72 and x['e24']>.12:z['onset']=-1
        if rel72>.08 and x['z48']>.05 and x['e72']>.15:z['continue']=1
        elif rel72<-.08 and x['z48']<-.05 and x['e72']>.15:z['continue']=-1
        if z['bias']==1 and r[48]>0 and r[12]<0 and x['z3']>.06:z['reentry']=1
        elif z['bias']==-1 and r[48]<0 and r[12]>0 and x['z3']<-.06:z['reentry']=-1
        if rel24<-.16 and x['z24']<-.12 and x['sl48']<0:z['reverse']=-1
        elif rel24>.16 and x['z24']>.12 and x['sl48']>0:z['reverse']=1
        z['strength']=abs(rel72)/(x['v'][168]*math.sqrt(72)+1e-9)+.35*x['e72']
        if x['shock']>1.9 and x['e24']<.09:z['exhaust']=1 if r[24]>0 else -1
    return z

def simulate(cid,candles,idx,start,end,cost,delay,records=False):
    s,risk,base_trail,maxhold=CANDS[cid]; c=candles[s]
    pos=0; entry=peak=trough=None; ets=None; vals=[]; recs=[]; cool=-1; entry_i=None
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        st=state(cid,candles,idx,ts); px=float(c[i]['close'])
        if pos:
            peak=max(peak,px); trough=min(trough,px); held=(ts-ets)//HOUR
            give=(px/peak-1)*100 if pos>0 else (trough/px-1)*100
            structural=(st['continue']==pos or st['bias']==pos) and st['reverse']!=-pos
            trail=base_trail*(1.18 if structural and st['strength']>.45 else 1.0)
            hard_reverse=st['reverse']==-pos and st['continue']!=pos
            exhausted=st['exhaust']==pos and st['continue']!=pos
            exitnow=hard_reverse or exhausted or give<=-trail or (held>=maxhold and not structural)
            if exitnow:
                xi=min(i+1+delay,len(c)-1); xp=float(c[xi]['open']); pnl=(pos*(xp/entry-1)*100-cost/100)*risk
                seg=c[entry_i:xi+1] if entry_i is not None else []
                mfe=max([pos*(float(q['high'])/entry-1)*100 if pos>0 else pos*(float(q['low'])/entry-1)*100 for q in seg],default=0.0)
                realized=pos*(xp/entry-1)*100
                vals.append(pnl); recs.append({'entryTs':ets,'exitTs':ts,'side':pos,'pnl':pnl,'entry':entry,'exit':xp,'heldHours':held,'mfePct':max(0,mfe),'givebackPct':max(0,max(0,mfe)-realized)})
                pos=0; cool=ts+4*HOUR; entry_i=None
        if pos==0 and ts>=cool:
            d=0
            if st['onset'] and st['bias'] in (0,st['onset']):d=st['onset']
            elif st['reentry'] and st['bias']==st['reentry']:d=st['reentry']
            elif st['continue'] and st['bias']==st['continue'] and st['strength']>.18:d=st['continue']
            elif st['reverse'] and st['bias'] in (0,st['reverse']):d=st['reverse']
            if d:
                ei=i+1+delay
                if ei<len(c):pos=d; entry=float(c[ei]['open']); peak=trough=entry; ets=ts; entry_i=ei
    if pos and entry is not None:
        i=max((idx[s][int(r['ts'])] for r in c if start<=int(r['ts'])<end),default=None)
        if i is not None:
            xp=float(c[i]['close']); pnl=(pos*(xp/entry-1)*100-cost/100)*risk; held=(int(c[i]['ts'])-ets)//HOUR
            vals.append(pnl); recs.append({'entryTs':ets,'exitTs':int(c[i]['ts']),'side':pos,'pnl':pnl,'entry':entry,'exit':xp,'heldHours':held,'mfePct':0.0,'givebackPct':0.0})
    return (vals,recs) if records else vals

def evalm(cid,candles,idx,per,cost,delay):return metric(simulate(cid,candles,idx,*per,cost,delay))

def wave_diag(cid,candles,idx,per):
    s=CANDS[cid][0]; c=candles[s]; start,end=per; _,recs=simulate(cid,candles,idx,start,end,NORMAL_BPS,0,True)
    waves=[]; last=-1
    for row in c:
        ts=int(row['ts']); i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=p.vol(c,i,168); p0=float(c[i]['close']); fut=c[i+1:i+49]
        up=100*(max(float(q['high']) for q in fut)/p0-1); dn=100*(p0/min(float(q['low']) for q in fut)-1); th=max(3.0,2*v*math.sqrt(48))
        if max(up,dn)<th:continue
        side=1 if up>=dn else -1; mfe=max(up,dn)
        hit=next((r for r in recs if ts<=r['entryTs']<=ts+24*HOUR and r['side']==side),None)
        if hit:
            cap=max(0,side*(hit['exit']/hit['entry']-1)*100); waves.append({'delay':(hit['entryTs']-ts)/HOUR,'capture':100*cap/max(mfe,1e-9)})
        else:waves.append({'delay':None,'capture':0})
        last=ts+48*HOUR
    got=[w for w in waves if w['delay'] is not None]
    false=sum(1 for r in recs if r['pnl']<0 and r['heldHours']<=24)
    top=sorted((r['pnl'] for r in recs),reverse=True)[:5]; total=sum(r['pnl'] for r in recs)
    return {'majorWaves':len(waves),'captured':len(got),'captureRatePct':100*len(got)/len(waves) if waves else 0,
            'medianEntryDelayHours':statistics.median([w['delay'] for w in got]) if got else None,
            'medianWaveMfeCapturedPct':statistics.median([w['capture'] for w in got]) if got else None,
            'missedWaves':len(waves)-len(got),'falseStartRatePct':100*false/len(recs) if recs else 0,
            'avgHoldHours':mean([r['heldHours'] for r in recs]),'avgExitGivebackPct':mean([r['givebackPct'] for r in recs]),
            'top5TradeContributionPct':100*sum(top)/total if total>0 else None}

def folds(cid,candles,idx,per):
    a,z=per; step=(z-a)//3; ms=[]
    for k in range(3):ms.append(evalm(cid,candles,idx,(a+k*step,z if k==2 else a+(k+1)*step),NORMAL_BPS,0))
    return {'folds':ms,'positivePfFolds':sum((m.get('returnPct') or 0)>0 and (m.get('pf') or 0)>1 for m in ms)}

def run(cid):
    candles,idx,_=b.p.v109.b.base.load(); ps=b.p.v109.b.base.periods(candles)
    dm=evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0); vm=evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0); vs=evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
    dw=wave_diag(cid,candles,idx,ps['development']); vw=wave_diag(cid,candles,idx,ps['validation']); df=folds(cid,candles,idx,ps['development']); vf=folds(cid,candles,idx,ps['validation'])
    result={'strategyId':'V115_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'walkForward':{'development':df,'validation':vf},'productionChanged':False,'realTradingEnabled':False}
    promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
    if not promote: result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
    else:
        cm=evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0); cs=evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1); result.update(confirmation=cm,confirmationStress=cs)
        if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1: result.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm=evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0); hs=evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1); ym=evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0); ys=evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1)
            ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1
            result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True); stem='active4-v115-'+cid; txt=json.dumps(result,indent=2)
    (out/f'{stem}.json').write_text(txt,encoding='utf-8'); (out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n',encoding='utf-8'); print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--candidate',choices=sorted(CANDS),required=True); run(ap.parse_args().candidate)
