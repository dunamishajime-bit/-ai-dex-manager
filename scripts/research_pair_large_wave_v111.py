from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109

HOUR=v109.HOUR
NORMAL_BPS=v109.NORMAL_BPS
STRESS_BPS=v109.STRESS_BPS
ret=v109.ret
metric=v109.metric
base=v109.b

CANDIDATES={
 'btc_macro_impulse':{'s':'BTC','risk':.82,'fast':6,'mid':24,'slow':168,'hold':240,'trail':6.0,'cool':6,'mode':'macro'},
 'btc_breakout_reentry':{'s':'BTC','risk':.78,'fast':4,'mid':18,'slow':120,'hold':192,'trail':5.0,'cool':4,'mode':'breakout'},
 'eth_relative_leadership':{'s':'ETH','risk':.76,'fast':6,'mid':24,'slow':144,'hold':216,'trail':6.0,'cool':5,'mode':'relative'},
 'bnb_range_release':{'s':'BNB','risk':.72,'fast':6,'mid':24,'slow':168,'hold':168,'trail':5.5,'cool':8,'mode':'range'},
 'avax_burst_continuation':{'s':'AVAX','risk':.64,'fast':3,'mid':18,'slow':96,'hold':144,'trail':8.0,'cool':4,'mode':'burst'},
}

def mean(x): return statistics.fmean(x) if x else 0.0
def sd(x): return statistics.pstdev(x) if len(x)>1 else 0.0

def vol(c,i,n):
    if i<n:return 0.0
    xs=[ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]
    return sd(xs)

def eff(c,i,n):
    if i<n:return 0.0
    p=[float(c[j]['close']) for j in range(i-n,i+1)]
    path=sum(abs(p[j]-p[j-1]) for j in range(1,len(p)))
    return abs(p[-1]-p[0])/path if path>1e-12 else 0.0

def rp(c,i,n):
    if i<n:return .5
    hi=max(float(c[j]['high']) for j in range(i-n+1,i+1));lo=min(float(c[j]['low']) for j in range(i-n+1,i+1));px=float(c[i]['close'])
    return (px-lo)/(hi-lo) if hi>lo else .5

def medmove(candles,idx,ts,n):
    xs=[]
    for s in ('BTC','ETH','BNB','SOL','LINK','AVAX'):
        i=idx[s].get(ts)
        if i is not None:
            x=ret(candles[s],i,n)
            if x is not None: xs.append(x)
    return statistics.median(xs) if xs else 0.0

def features(cfg,candles,idx,ts):
    s=cfg['s'];c=candles[s];i=idx[s].get(ts)
    if i is None or i<900:return None
    f,m,l=cfg['fast'],cfg['mid'],cfg['slow']
    rf=ret(c,i,f);rm=ret(c,i,m);rl=ret(c,i,l)
    if None in (rf,rm,rl):return None
    v24=vol(c,i,24);v96=vol(c,i,96);v336=vol(c,i,336)
    if v336<=1e-9:return None
    vr=v24/max(v96,1e-9);e=eff(c,i,72);pos=rp(c,i,96)
    market=medmove(candles,idx,ts,24)
    rel=(rm-market)/(v96*math.sqrt(max(m,1))+1e-9)
    btc_i=idx['BTC'].get(ts);ethbtc=0.0
    if s=='ETH' and btc_i is not None:
        br=ret(candles['BTC'],btc_i,m)
        ethbtc=(rm-(br or 0))/(v96*math.sqrt(max(m,1))+1e-9)
    return {'i':i,'px':float(c[i]['close']),'rf':rf,'rm':rm,'rl':rl,'v24':v24,'v96':v96,'v336':v336,'vr':vr,'e':e,'pos':pos,'rel':rel,'ethbtc':ethbtc}

def classify(cfg,f):
    mode=cfg['mode'];rf,rm,rl=f['rf'],f['rm'],f['rl'];vr,e,pos,rel=f['vr'],f['e'],f['pos'],f['rel']
    if mode=='macro':
        bias=1 if rl>1.0 and e>.18 else -1 if rl<-1.0 and e>.18 else 0
        initiation=1 if rf>.45 and rm>.9 and vr>.9 else -1 if rf<-.45 and rm<-.9 and vr>.9 else 0
        continuation=1 if rm>1.0 and e>.22 and pos>.62 else -1 if rm<-1.0 and e>.22 and pos<.38 else 0
    elif mode=='breakout':
        bias=1 if rl>.4 else -1 if rl<-.4 else 0
        initiation=1 if pos>.88 and rf>.35 and vr>.85 else -1 if pos<.12 and rf<-.35 and vr>.85 else 0
        continuation=1 if rm>.7 and e>.20 else -1 if rm<-.7 and e>.20 else 0
    elif mode=='relative':
        bias=1 if f['ethbtc']>.10 or rel>.10 else -1 if f['ethbtc']<-.10 or rel<-.10 else 0
        initiation=1 if rf>.45 and rm>.8 and f['ethbtc']>.15 and vr>.85 else -1 if rf<-.45 and rm<-.8 and f['ethbtc']<-.15 and vr>.85 else 0
        continuation=1 if rm>.8 and rel>.10 and e>.18 else -1 if rm<-.8 and rel<-.10 and e>.18 else 0
    elif mode=='range':
        bias=1 if rl>.5 else -1 if rl<-.5 else 0
        initiation=1 if pos>.90 and rf>.35 and .8<vr<2.6 else -1 if pos<.10 and rf<-.35 and .8<vr<2.6 else 0
        continuation=1 if rm>.9 and e>.24 else -1 if rm<-.9 and e>.24 else 0
    else:
        bias=1 if rl>.3 else -1 if rl<-.3 else 0
        initiation=1 if rf>.60 and rm>.85 and vr>1.0 else -1 if rf<-.60 and rm<-.85 and vr>1.0 else 0
        continuation=1 if rm>.9 and e>.18 else -1 if rm<-.9 and e>.18 else 0
    return bias,initiation,continuation

def run_trades(cfg,candles,idx,start,end,cost_bps,delay):
    s=cfg['s'];c=candles[s];state=0;entry=peak=trough=None;ets=None;last_exit=-10**30;vals=[];recs=[]
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        f=features(cfg,candles,idx,ts)
        if f is None:continue
        i=f['i'];px=f['px'];bias,initiation,continuation=classify(cfg,f)
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//HOUR
            trail=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            opposite=(state>0 and initiation<0) or (state<0 and initiation>0)
            exhausted=(state>0 and f['rf']<-.35 and f['vr']<.95) or (state<0 and f['rf']>.35 and f['vr']<.95)
            regime_lost=(state>0 and bias<0) or (state<0 and bias>0)
            exitnow=trail<=-cfg['trail'] or held>=cfg['hold'] or opposite or (exhausted and regime_lost)
            if exitnow:
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=(state*(xp/entry-1)*100-cost_bps/100)*cfg['risk'];vals.append(pnl);recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':pnl,'holdHours':held});state=0;last_exit=ts
        if state==0 and ts-last_exit>=cfg['cool']*HOUR:
            d=0
            if initiation and (bias==0 or initiation==bias): d=initiation
            elif continuation and continuation==bias and ((continuation>0 and f['rf']>-0.45) or (continuation<0 and f['rf']<0.45)): d=continuation
            if d:
                ei=i+1+delay
                if ei<len(c): state=d;entry=float(c[ei]['open']);peak=entry;trough=entry;ets=ts
    if state and ets is not None:
        candidates=[r for r in c if start<=int(r['ts'])<end]
        if candidates:
            r=candidates[-1];i=idx[s][int(r['ts'])];xp=float(c[i]['close']);pnl=(state*(xp/entry-1)*100-cost_bps/100)*cfg['risk'];vals.append(pnl);recs.append({'entryTs':ets,'exitTs':int(r['ts']),'side':state,'pnl':pnl,'holdHours':(int(r['ts'])-ets)//HOUR})
    return vals,recs

def wave_diag(cfg,candles,idx,start,end,recs):
    s=cfg['s'];c=candles[s];waves=[];last=-1
    for row in c:
        ts=int(row['ts']);i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=vol(c,i,168);p0=float(c[i]['close']);future=[float(c[j]['close']) for j in range(i+1,min(i+49,len(c)))]
        if not future or v<=1e-9:continue
        up=100*(max(future)/p0-1);dn=100*(min(future)/p0-1);th=max(3.0,1.8*v*math.sqrt(48))
        side=1 if up>=th and up>=abs(dn) else -1 if dn<=-th else 0
        if not side:continue
        hit=next((r for r in recs if ts<=r['entryTs']<=ts+18*HOUR and r['side']==side),None)
        mfe=up if side>0 else -dn
        if hit:
            ei=idx[s].get(hit['entryTs']);xi=idx[s].get(hit['exitTs']);capt=0.0;give=0.0
            if ei is not None and xi is not None and xi>ei:
                ep=float(c[ei]['close']);seg=[float(c[j]['close']) for j in range(ei,min(xi+1,len(c)))];best=100*((max(seg)/ep-1) if side>0 else (ep/min(seg)-1));real=max(hit['pnl']/cfg['risk'],0);capt=100*real/max(mfe,1e-9);give=max(best-real,0)
            waves.append({'hit':1,'delay':(hit['entryTs']-ts)/HOUR,'capture':capt,'giveback':give})
        else:waves.append({'hit':0})
        last=ts+48*HOUR
    hits=[w for w in waves if w['hit']]
    avg_hold=mean([r['holdHours'] for r in recs])
    top5=sum(sorted([r['pnl'] for r in recs],reverse=True)[:5]);total=sum(r['pnl'] for r in recs)
    false=sum(1 for r in recs if r['pnl']<=0)
    return {'majorWaves':len(waves),'captureRatePct':100*len(hits)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median([w['delay'] for w in hits]) if hits else None,'mfeCapturePct':mean([w['capture'] for w in hits]),'exitGivebackPct':mean([w['giveback'] for w in hits]),'missedWaves':len(waves)-len(hits),'falseStartRatePct':100*false/len(recs) if recs else 0,'avgHoldHours':avg_hold,'top5ContributionPct':100*top5/total if total>0 else None}

def section(cfg,candles,idx,p):
    vals,recs=run_trades(cfg,candles,idx,*p,NORMAL_BPS,0);sv,_=run_trades(cfg,candles,idx,*p,STRESS_BPS,1)
    return {'normal':metric(vals),'stress':metric(sv),'wave':wave_diag(cfg,candles,idx,*p,recs)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=CANDIDATES,required=True);a=ap.parse_args();cfg=CANDIDATES[a.candidate]
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles)
    d=section(cfg,candles,idx,ps['development']);v=section(cfg,candles,idx,ps['validation'])
    res={'strategyId':'PAIR_LARGE_WAVE_V111_'+a.candidate.upper(),'pair':cfg['s'],'candidate':a.candidate,'periods':ps,'development':d,'validation':v,'productionChanged':False,'realTradingEnabled':False}
    dm=d['normal'];vm=v['normal'];vs=v['stress'];promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1.0 and v['wave']['captureRatePct']>=20
    if promote:
        csec=section(cfg,candles,idx,ps['confirmation']);res['confirmation']=csec;cm=csec['normal'];cs=csec['stress'];cg=(cm.get('pf') or 0)>=1.20 and cm.get('returnPct',0)>0 and (cs.get('pf') or 0)>1.0
        if cg:
            hsec=section(cfg,candles,idx,ps['holdout']);res['holdout']=hsec;hm=hsec['normal'];hs=hsec['stress'];ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1;res['status']='PASS' if ok else 'FAIL';res['reason']='PASS' if ok else 'HOLDOUT'
        else:res.update(status='FAIL',reason='CONFIRMATION')
    else:res.update(status='FAIL',reason='DEVELOPMENT_VALIDATION')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);txt=json.dumps(res,indent=2);stem='pair-large-wave-v111-'+a.candidate;(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':main()
