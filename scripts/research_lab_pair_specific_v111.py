from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS; HOUR=b.HOUR; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS
metric=b.metric; ret=b.ret

# Pair-specific frozen settings. These are prospective for V111 and are not tuned on
# Confirmation/Holdout. BTC/ETH use faster wave ignition than V110; alts remain independent.
P={
'BTC':dict(risk=.82,f1=.26,f2=.34,m=.24,s=.12,eff=.16,rp=.54,trail=5.0,maxh=216,re=12),
'ETH':dict(risk=.78,f1=.22,f2=.28,m=.18,s=.08,eff=.14,rp=.53,trail=6.2,maxh=192,re=10),
'BNB':dict(risk=.68,f1=.30,f2=.40,m=.26,s=.14,eff=.18,rp=.56,trail=4.8,maxh=168,re=14),
'SOL':dict(risk=.64,f1=.24,f2=.32,m=.18,s=.08,eff=.14,rp=.54,trail=7.0,maxh=156,re=8),
'LINK':dict(risk=.62,f1=.24,f2=.34,m=.20,s=.10,eff=.15,rp=.55,trail=6.5,maxh=156,re=8),
'AVAX':dict(risk=.60,f1=.22,f2=.30,m=.18,s=.08,eff=.13,rp=.54,trail=7.5,maxh=144,re=8)}

def zmove(c,i,n):
    v=b.vol(c,i,168)
    r=ret(c,i,n)
    return (r or 0)/(v*math.sqrt(n)+1e-9) if v>1e-9 else 0

def feat(s,candles,idx,ts):
    c=candles[s];i=idx[s].get(ts)
    if i is None or i<900:return None
    f3=zmove(c,i,3);f6=zmove(c,i,6);f12=zmove(c,i,12);m24=zmove(c,i,24);m48=zmove(c,i,48);s96=zmove(c,i,96)
    eff=b.efficiency(c,i,48);rp=b.range_position(c,i,72);bread=b.breadth(candles,idx,ts,12)-.5
    med=b.median_move(candles,idx,ts,12)
    v=b.vol(c,i,168);rel=((ret(c,i,12) or 0)-med)/(v*math.sqrt(12)+1e-9) if v>1e-9 else 0
    return dict(i=i,f3=f3,f6=f6,f12=f12,m24=m24,m48=m48,s96=s96,eff=eff,rp=rp,bread=bread,rel=rel)

def signal(kind,s,candles,idx,ts):
    q=P[s];x=feat(s,candles,idx,ts)
    if not x:return 0,{}
    f3=x['f3'];f6=x['f6'];f12=x['f12'];m=x['m24'];m48=x['m48'];sl=x['s96'];rp=x['rp'];eff=x['eff'];rel=x['rel'];bread=x['bread']
    d=0
    if kind=='impulse_ignition':
        # Early acceleration: 3h/6h impulse leads 24h/96h confirmation instead of waiting for mature trend.
        lead=f6 if s=='BTC' else rel if s=='ETH' else .55*f6+.45*bread
        up=f3>q['f1'] and f6>q['f2'] and m>q['m'] and sl>q['s'] and rp>q['rp'] and eff>q['eff'] and lead>0
        dn=f3<-q['f1'] and f6<-q['f2'] and m<-q['m'] and sl<-q['s'] and rp<1-q['rp'] and eff>q['eff'] and lead<0
        if up:d=1
        elif dn:d=-1
    elif kind=='persistent_wave':
        # Enter/re-enter sustained waves on shallow deceleration instead of fresh breakout only.
        up=m48>q['m'] and sl>q['s'] and f12>0 and f3>-q['f1'] and rp>.48 and eff>q['eff']
        dn=m48<-q['m'] and sl<-q['s'] and f12<0 and f3<q['f1'] and rp<.52 and eff>q['eff']
        if s=='ETH':
            up=up and rel>-.10;dn=dn and rel<.10
        if up:d=1
        elif dn:d=-1
    else: # failure_flip
        # Failed extension: detect loss of prior wave and fast opposite impulse.
        upfail=sl>q['s'] and m48>0 and f6<-q['f2'] and f3<-q['f1'] and rp<.62
        dnfail=sl<-q['s'] and m48<0 and f6>q['f2'] and f3>q['f1'] and rp>.38
        if s=='BTC':
            upfail=upfail and bread<.10;dnfail=dnfail and bread>-.10
        if s=='ETH':
            upfail=upfail and rel<.15;dnfail=dnfail and rel>-.15
        if upfail:d=-1
        elif dnfail:d=1
    return d,x

def pair_trades(kind,s,candles,idx,start,end,cost,delay):
    c=candles[s];q=P[s];state=0;entry=peak=trough=None;ets=None;vals=[];recs=[];cool=0
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        d,x=signal(kind,s,candles,idx,ts);px=float(c[i]['close'])
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//HOUR
            give=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            f6=x.get('f6',0);m=x.get('m24',0);sl=x.get('s96',0)
            break_wave=(state>0 and f6<-.18 and m<0) or (state<0 and f6>.18 and m>0)
            regime_flip=(state>0 and sl<-.08) or (state<0 and sl>.08)
            if give<=-q['trail'] or break_wave or regime_flip or held>=q['maxh']:
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=(state*(xp/entry-1)*100-cost/100)*q['risk']
                vals.append(pnl);recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':pnl});state=0;cool=q['re']
        if cool>0:cool-=1
        if state==0 and cool==0 and d:
            ei=i+1+delay
            if ei<len(c):state=d;entry=float(c[ei]['open']);peak=entry;trough=entry;ets=ts
    if state and ets is not None:
        last=max((idx[s].get(int(r['ts'])) for r in c if start<=int(r['ts'])<end),default=None)
        if last is not None:
            xp=float(c[last]['close']);pnl=(state*(xp/entry-1)*100-cost/100)*q['risk'];vals.append(pnl);recs.append({'entryTs':ets,'exitTs':int(c[last]['ts']),'side':state,'pnl':pnl})
    return vals,recs

def portfolio(kind,candles,idx,start,end,cost,delay):
    vals=[];pair={};contrib={}
    for s in SYMS:
        x,_=pair_trades(kind,s,candles,idx,start,end,cost,delay);pair[s]=metric(x);contrib[s]=sum(x);vals+=x
    return metric(vals),pair,contrib

def wave_diag(kind,s,candles,idx,start,end):
    _,recs=pair_trades(kind,s,candles,idx,start,end,NORMAL_BPS,0);c=candles[s];waves=[];last=-1
    for row in c:
        ts=int(row['ts']);i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=b.vol(c,i,168);mv=100*(float(c[i+48]['close'])/float(c[i]['close'])-1);th=max(3,2*v*math.sqrt(48))
        if abs(mv)<th:continue
        side=1 if mv>0 else -1;hit=next((r for r in recs if ts<=r['entryTs']<=ts+18*HOUR and r['side']==side),None)
        waves.append(None if hit is None else (hit['entryTs']-ts)/HOUR);last=ts+48*HOUR
    d=[x for x in waves if x is not None]
    return {'majorWaves':len(waves),'captured':len(d),'captureRatePct':100*len(d)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median(d) if d else None,'missedWaves':len(waves)-len(d)}

def run(kind):
    candles,idx,_=b.base.load();ps=b.base.periods(candles)
    dm,dp,dc=portfolio(kind,candles,idx,*ps['development'],NORMAL_BPS,0);vm,vp,vc=portfolio(kind,candles,idx,*ps['validation'],NORMAL_BPS,0);vs,_,_=portfolio(kind,candles,idx,*ps['validation'],STRESS_BPS,1)
    res={'strategyId':f'PAIR_SPECIFIC_V111_{kind.upper()}','periods':ps,'development':dm,'developmentPair':dp,'developmentContribution':dc,'validation':vm,'validationPair':vp,'validationContribution':vc,'validationStress':vs,'moveCaptureDiagnostics':{'development':{s:wave_diag(kind,s,candles,idx,*ps['development']) for s in ('BTC','ETH')},'validation':{s:wave_diag(kind,s,candles,idx,*ps['validation']) for s in ('BTC','ETH')}},'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or dm.get('returnPct',0)<=0 or (vm.get('pf') or 0)<1.05 or vm.get('returnPct',0)<=0:
        res.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,cp,cc=portfolio(kind,candles,idx,*ps['confirmation'],NORMAL_BPS,0);cs,_,_=portfolio(kind,candles,idx,*ps['confirmation'],STRESS_BPS,1);res.update(confirmation=cm,confirmationPair=cp,confirmationContribution=cc,confirmationStress=cs)
        if not b.gate(cm,cs):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=portfolio(kind,candles,idx,*ps['holdout'],NORMAL_BPS,0);hs,_,_=portfolio(kind,candles,idx,*ps['holdout'],STRESS_BPS,1);ym,yp,yc=portfolio(kind,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0);ys,_,_=portfolio(kind,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1)
            pos=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS);sh=[abs(x) for x in yc.values()];conc=max(sh)/sum(sh) if sum(sh)>1e-9 else 1
            ok=b.gate(ym,ys) and (hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and ym.get('returnPct',0)>=60 and pos>=4 and conc<.45
            res.update(holdout=hm,holdoutPair=hp,holdoutContribution=hc,holdoutStress=hs,year=ym,yearPair=yp,yearContribution=yc,yearStress=ys,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem=f'pair-specific-v111-{kind}';txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--kind',choices=['impulse_ignition','persistent_wave','failure_flip'],required=True);run(ap.parse_args().kind)
