from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109

HOUR=v109.HOUR; NORMAL_BPS=v109.NORMAL_BPS; STRESS_BPS=v109.STRESS_BPS
ret=v109.ret; metric=v109.metric
CANDS={
 'btc_persistent_trend':('BTC',.72,6.5,360),
 'btc_vol_release':('BTC',.68,5.8,300),
 'eth_relative_persistence':('ETH',.70,6.5,336),
 'bnb_selective_release':('BNB',.64,6.0,264),
 'avax_burst_persistence':('AVAX',.56,8.0,240),
}

def vol(c,i,n): return v109.b.vol(c,i,n)
def eff(c,i,n): return v109.b.efficiency(c,i,n)
def rp(c,i,n): return v109.b.range_position(c,i,n)
def breadth(candles,idx,ts,n=24): return v109.b.breadth(candles,idx,ts,n)
def medmove(candles,idx,ts,n=24): return v109.b.median_move(candles,idx,ts,n)
def zret(c,i,n,base=168):
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
    rs={n:(ret(c,i,n) or 0.0) for n in (3,6,12,24,48,72,120,168,240)}
    vv={n:vol(c,i,n) for n in (12,24,48,96,168,336)}
    if vv[336]<=1e-9 or vv[168]<=1e-9:return None
    return {'s':s,'c':c,'i':i,'r':rs,'v':vv,
      'fast':zret(c,i,6),'mid':zret(c,i,24),'med':zret(c,i,72),'slow':zret(c,i,168),
      'rp72':rp(c,i,72),'rp168':rp(c,i,168),'rp336':rp(c,i,336),
      'e24':eff(c,i,24),'e72':eff(c,i,72),'e168':eff(c,i,168),
      'br':breadth(candles,idx,ts,24),'sl24':slope(c,i,24),'sl96':slope(c,i,96),
      'vr':vv[24]/max(vv[168],1e-9),'shock':vv[12]/max(vv[96],1e-9)}

def state(cid,candles,idx,ts):
    f=feat(cid,candles,idx,ts)
    if not f:return {'bias':0,'onset':0,'continue':0,'reentry':0,'fail':0,'exhaust':0}
    r=f['r']; bias=onset=cont=reentry=fail=exhaust=0
    if cid=='btc_persistent_trend':
        if f['slow']>.20 and f['sl96']>0 and f['rp336']>.48:bias=1
        elif f['slow']<-.20 and f['sl96']<0 and f['rp336']<.52:bias=-1
        if f['fast']>.40 and r[24]>0 and f['shock']>.65 and f['e24']>.18:onset=1
        elif f['fast']<-.40 and r[24]<0 and f['shock']>.65 and f['e24']>.18:onset=-1
        if f['med']>.12 and f['sl96']>0 and f['rp168']>.46:cont=1
        elif f['med']<-.12 and f['sl96']<0 and f['rp168']<.54:cont=-1
        if bias==1 and r[72]>0 and r[12]<0 and r[3]>0 and f['rp72']>.30:reentry=1
        elif bias==-1 and r[72]<0 and r[12]>0 and r[3]<0 and f['rp72']<.70:reentry=-1
        if bias==1 and f['fast']<-.45 and f['rp168']<.42:fail=-1
        elif bias==-1 and f['fast']>.45 and f['rp168']>.58:fail=1
        if abs(f['fast'])<.10 and f['shock']>1.35 and f['e24']<.16:exhaust=bias
    elif cid=='btc_vol_release':
        prevv=vol(f['c'],f['i']-24,24)/max(vol(f['c'],f['i']-24,168),1e-9)
        if f['slow']>.10 and f['br']>=.5:bias=1
        elif f['slow']<-.10 and f['br']<=.5:bias=-1
        if prevv<.70 and f['vr']>.82 and abs(f['fast'])>.35 and f['e24']>.18:onset=1 if f['fast']>0 else -1
        if abs(f['med'])>.12 and f['e72']>.20:cont=1 if f['med']>0 else -1
        if bias==1 and r[48]>0 and r[6]<0 and r[3]>0:reentry=1
        elif bias==-1 and r[48]<0 and r[6]>0 and r[3]<0:reentry=-1
        if f['rp168']>.90 and f['fast']<-.25:fail=-1
        elif f['rp168']<.10 and f['fast']>.25:fail=1
        if f['shock']>1.5 and f['e24']<.14:exhaust=1 if f['rp72']>.70 else -1 if f['rp72']<.30 else 0
    elif cid=='eth_relative_persistence':
        bi=idx['BTC'].get(ts); btc=candles['BTC']
        if bi is None:return {'bias':0,'onset':0,'continue':0,'reentry':0,'fail':0,'exhaust':0}
        rel24=r[24]-(ret(btc,bi,24) or 0); rel72=r[72]-(ret(btc,bi,72) or 0); rel168=r[168]-(ret(btc,bi,168) or 0)
        if rel168>.10 and rel72>0:bias=1
        elif rel168<-.10 and rel72<0:bias=-1
        if abs(rel24)>.18 and abs(f['fast'])>.32 and f['shock']>.62:onset=1 if rel24>0 and f['fast']>0 else -1 if rel24<0 and f['fast']<0 else 0
        if abs(rel72)>.12 and abs(f['med'])>.10:cont=1 if rel72>0 and f['med']>0 else -1 if rel72<0 and f['med']<0 else 0
        if bias==1 and rel72>0 and r[12]<0 and r[3]>0:reentry=1
        elif bias==-1 and rel72<0 and r[12]>0 and r[3]<0:reentry=-1
        if bias==1 and rel24<-.25 and f['fast']<-.30:fail=-1
        elif bias==-1 and rel24>.25 and f['fast']>.30:fail=1
        if abs(rel24)<.08 and abs(rel72)>.25 and f['e24']<.15:exhaust=bias
    elif cid=='bnb_selective_release':
        med72=medmove(candles,idx,ts,72); rel72=r[72]-med72
        active=f['e168']>.18 and abs(rel72)>.20 and .55<f['vr']<2.2
        if active:bias=1 if rel72>0 else -1
        prevv=vol(f['c'],f['i']-24,24)/max(vol(f['c'],f['i']-24,168),1e-9)
        if active and prevv<.78 and f['vr']>.80 and abs(f['fast'])>.30:onset=1 if f['fast']>0 else -1
        if active and abs(f['med'])>.10 and f['e72']>.18:cont=1 if f['med']>0 else -1
        if bias==1 and r[48]>0 and r[12]<0 and r[3]>0:reentry=1
        elif bias==-1 and r[48]<0 and r[12]>0 and r[3]<0:reentry=-1
        if bias==1 and rel72<0 and f['fast']<-.28:fail=-1
        elif bias==-1 and rel72>0 and f['fast']>.28:fail=1
        if f['shock']>1.45 and f['e24']<.14:exhaust=bias
    elif cid=='avax_burst_persistence':
        med24=medmove(candles,idx,ts,24); rel24=r[24]-med24
        if rel24>.20 and f['rp336']>.45:bias=1
        elif rel24<-.20 and f['rp336']<.55:bias=-1
        if abs(rel24)>.28 and abs(f['fast'])>.28 and f['shock']>.68 and f['e24']>.16:onset=1 if rel24>0 and f['fast']>0 else -1 if rel24<0 and f['fast']<0 else 0
        if abs(f['med'])>.10 and f['e72']>.16 and abs(rel24)>.16:cont=1 if f['med']>0 else -1
        if bias==1 and r[48]>0 and r[12]<0 and r[3]>0 and f['rp72']>.25:reentry=1
        elif bias==-1 and r[48]<0 and r[12]>0 and r[3]<0 and f['rp72']<.75:reentry=-1
        if bias==1 and f['fast']<-.35 and rel24<0:fail=-1
        elif bias==-1 and f['fast']>.35 and rel24>0:fail=1
        if f['shock']>1.55 and f['e24']<.13:exhaust=bias
    return {'bias':bias,'onset':onset,'continue':cont,'reentry':reentry,'fail':fail,'exhaust':exhaust}

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
            aligned=(st['continue']==pos or st['reentry']==pos or st['bias']==pos)
            hardfail=(st['fail']==-pos)
            exhaust=(st['exhaust']==pos and not aligned)
            exitnow=hardfail or exhaust or give<=-trail or (held>=maxhold and not aligned)
            if exitnow:
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=(pos*(xp/entry-1)*100-cost/100)*risk
                vals.append(pnl);recs.append({'entryTs':ets,'exitTs':ts,'side':pos,'pnl':pnl,'entry':entry,'exit':xp,'heldHours':held});pos=0;cool=ts+4*HOUR
        if pos==0 and ts>=cool:
            d=0
            if st['onset'] and st['bias'] in (0,st['onset']):d=st['onset']
            elif st['reentry'] and st['bias']==st['reentry']:d=st['reentry']
            elif st['continue'] and st['bias']==st['continue'] and abs((ret(c,i,12) or 0))<3.0:d=st['continue']
            elif st['fail'] and st['bias'] in (0,st['fail']):d=st['fail']
            if d:
                ei=i+1+delay
                if ei<len(c):pos=d;entry=float(c[ei]['open']);peak=trough=entry;ets=ts
    return (vals,recs) if records else vals

def evalm(cid,candles,idx,p,cost,delay):return metric(simulate(cid,candles,idx,*p,cost,delay))
def folds(cid,candles,idx,p):
    a,b=p; step=(b-a)//3; fs=[]
    for k in range(3):
        x=a+k*step;y=b if k==2 else a+(k+1)*step;fs.append(evalm(cid,candles,idx,(x,y),NORMAL_BPS,0))
    return {'folds':fs,'positivePfFolds':sum((m.get('returnPct') or 0)>0 and (m.get('pf') or 0)>1 for m in fs)}

def wave_diag(cid,candles,idx,p):
    s=CANDS[cid][0];c=candles[s];start,end=p;_,recs=simulate(cid,candles,idx,start,end,NORMAL_BPS,0,True)
    waves=[];last=-1
    for row in c:
        ts=int(row['ts']);i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=vol(c,i,168);p0=float(c[i]['close']);future=[float(c[j]['close']) for j in range(i+1,min(i+49,len(c)))]
        if not future:continue
        up=100*(max(future)/p0-1);dn=100*(min(future)/p0-1);th=max(3.0,2.0*v*math.sqrt(48))
        if max(up,-dn)<th:continue
        side=1 if up>=-dn else -1;mfe=up if side>0 else -dn
        hit=next((r for r in recs if ts<=r['entryTs']<=ts+24*HOUR and r['side']==side),None)
        if hit:
            delayh=(hit['entryTs']-ts)/HOUR; captured=max(0.0,side*(hit['exit']/hit['entry']-1)*100);cap=100*captured/max(mfe,1e-9)
            waves.append((delayh,cap))
        else:waves.append((None,0.0))
        last=ts+48*HOUR
    got=[x for x in waves if x[0] is not None]
    return {'majorWaves':len(waves),'captured':len(got),'captureRatePct':100*len(got)/len(waves) if waves else 0,
      'medianEntryDelayHours':statistics.median([x[0] for x in got]) if got else None,
      'medianWaveMfeCapturedPct':statistics.median([x[1] for x in got]) if got else None,
      'missedWaves':len(waves)-len(got)}

def run(cid):
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
    dm=evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1)
    dwd=wave_diag(cid,candles,idx,ps['development']);vwd=wave_diag(cid,candles,idx,ps['validation']);df=folds(cid,candles,idx,ps['development']);vf=folds(cid,candles,idx,ps['validation'])
    result={'strategyId':'V113_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'developmentFolds':df,'validationFolds':vf,'waveDiagnostics':{'development':dwd,'validation':vwd},'productionChanged':False,'realTradingEnabled':False}
    promote=(dm.get('pf') or 0)>=1.15 and (vm.get('pf') or 0)>=1.10 and (vm.get('returnPct') or 0)>0 and (vs.get('pf') or 0)>1 and dwd['captureRatePct']>=15 and vwd['captureRatePct']>=15 and df['positivePfFolds']>=2 and vf['positivePfFolds']>=2
    if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
    else:
        cm=evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);result.update(confirmation=cm,confirmationStress=cs)
        if not ((cm.get('pf') or 0)>1 and (cm.get('returnPct') or 0)>0 and (cs.get('pf') or 0)>1):result.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm=evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ym=evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0)
            result.update(holdout=hm,holdoutStress=hs,year=ym,status='PASS' if (hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 else 'FAIL',reason='PASS' if (hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 else 'HOLDOUT')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v113-'+cid;txt=json.dumps(result,indent=2)
    (out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=list(CANDS),required=True);run(ap.parse_args().candidate)
