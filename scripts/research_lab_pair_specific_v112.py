from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS; HOUR=b.HOUR; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS
metric=b.metric; ret=b.ret

# V113 is prospectively frozen before Validation.  The three families are
# structurally distinct from V110-V112 and focus on earlier wave occupancy.
P={
'BTC':dict(risk=.82,trail=7.2,maxh=288,re=4,fast=6,mid=24,slow=120),
'ETH':dict(risk=.78,trail=7.8,maxh=240,re=3,fast=4,mid=18,slow=96),
'BNB':dict(risk=.66,trail=6.2,maxh=216,re=5,fast=8,mid=30,slow=120),
'SOL':dict(risk=.62,trail=8.2,maxh=192,re=3,fast=4,mid=16,slow=72),
'LINK':dict(risk=.56,trail=8.0,maxh=180,re=4,fast=5,mid=20,slow=84),
'AVAX':dict(risk=.56,trail=8.8,maxh=168,re=3,fast=4,mid=16,slow=72)}

NAMES={'pullback_reentry':'dual_speed_occupancy','compression_escape':'asymmetric_channel','leadership_transition':'relative_lead'}

def zmove(c,i,n):
    v=b.vol(c,i,168); r=ret(c,i,n)
    return (r or 0)/(v*math.sqrt(n)+1e-9) if v>1e-9 else 0

def feat(s,candles,idx,ts):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    q=P[s]; f=q['fast'];m=q['mid'];sl=q['slow']
    zf=zmove(c,i,f);zm=zmove(c,i,m);zs=zmove(c,i,sl);z2m=zmove(c,i,min(2*m,168))
    effm=b.efficiency(c,i,m);effs=b.efficiency(c,i,sl)
    rp24=b.range_position(c,i,24);rp72=b.range_position(c,i,72);rps=b.range_position(c,i,sl)
    v24=b.vol(c,i,24);v168=b.vol(c,i,168);vr=v24/(v168+1e-9) if v168>1e-9 else 1
    breadth=b.breadth(candles,idx,ts,12)-.5
    med=b.median_move(candles,idx,ts,m);v=b.vol(c,i,168);rel=((ret(c,i,m) or 0)-med)/(v*math.sqrt(m)+1e-9) if v>1e-9 else 0
    btc=candles['BTC'];bi=idx['BTC'].get(ts);btcf=zmove(btc,bi,6) if bi is not None and bi>=900 else 0;btcm=zmove(btc,bi,24) if bi is not None and bi>=900 else 0
    eth=candles['ETH'];ei=idx['ETH'].get(ts);ethm=zmove(eth,ei,18) if ei is not None and ei>=900 else 0
    return dict(i=i,zf=zf,zm=zm,zs=zs,z2m=z2m,effm=effm,effs=effs,rp24=rp24,rp72=rp72,rps=rps,vr=vr,breadth=breadth,rel=rel,btcf=btcf,btcm=btcm,ethm=ethm)

def signal(kind,s,candles,idx,ts):
    x=feat(s,candles,idx,ts)
    if not x:return 0,x
    zf,zm,zs,z2=x['zf'],x['zm'],x['zs'],x['z2m'];em,es=x['effm'],x['effs'];r24,r72,rs=x['rp24'],x['rp72'],x['rps'];vr=x['vr'];bread=x['breadth'];rel=x['rel'];btcf=x['btcf'];btcm=x['btcm'];ethm=x['ethm']
    d=0
    if kind=='pullback_reentry':
        # Dual-speed directional occupancy: enter when fast direction establishes
        # while medium state is only beginning, then hold through the slow wave.
        if s=='BTC': up=zf>.16 and zm>-.02 and r24>.58 and (es>.08 or zs>.05); dn=zf<-.16 and zm<.02 and r24<.42 and (es>.08 or zs<-.05)
        elif s=='ETH': up=zf>.14 and zm>-.06 and r24>.56 and rel>-.18; dn=zf<-.14 and zm<.06 and r24<.44 and rel<.18
        elif s=='BNB': up=zf>.18 and zm>.02 and r72>.54 and em>.08; dn=zf<-.18 and zm<-.02 and r72<.46 and em>.08
        elif s=='SOL': up=zf>.16 and zm>-.08 and r24>.56 and bread>-.10; dn=zf<-.16 and zm<.08 and r24<.44 and bread<.10
        elif s=='LINK': up=zf>.18 and zm>-.05 and r24>.57 and rel>-.22; dn=zf<-.18 and zm<.05 and r24<.43 and rel<.22
        else: up=zf>.18 and zm>-.08 and r24>.57 and vr>.62; dn=zf<-.18 and zm<.08 and r24<.43 and vr>.62
    elif kind=='compression_escape':
        # Asymmetric fast-entry/slow-exit channel architecture.  Entry uses a
        # fresh 24/72h location break without requiring a mature slow trend.
        if s=='BTC': up=r24>.82 and zf>.12 and zm>-.05; dn=r24<.18 and zf<-.12 and zm<.05
        elif s=='ETH': up=r24>.80 and zf>.12 and rel>-.12; dn=r24<.20 and zf<-.12 and rel<.12
        elif s=='BNB': up=r72>.76 and zf>.15 and em>.06; dn=r72<.24 and zf<-.15 and em>.06
        elif s=='SOL': up=r24>.84 and zf>.15 and bread>-.12; dn=r24<.16 and zf<-.15 and bread<.12
        elif s=='LINK': up=r24>.82 and zf>.14 and rel>-.20; dn=r24<.18 and zf<-.14 and rel<.20
        else: up=r24>.84 and zf>.16 and vr>.58; dn=r24<.16 and zf<-.16 and vr>.58
    else:
        # Relative-lead transition. BTC trades its own leadership impulse; ETH
        # trades beta/relative acceleration; alts use pair-specific market-relative states.
        if s=='BTC': up=zf>.14 and btcm>-.04 and bread<.16 and r24>.56; dn=zf<-.14 and btcm<.04 and bread>-.16 and r24<.44
        elif s=='ETH': up=rel>.16 and zf>.08 and btcf>-.18 and r24>.54; dn=rel<-.16 and zf<-.08 and btcf<.18 and r24<.46
        elif s=='BNB': up=rel>.20 and zm>.02 and btcm>-.14 and r72>.55; dn=rel<-.20 and zm<-.02 and btcm<.14 and r72<.45
        elif s=='SOL': up=rel>.18 and zf>.12 and ethm>-.16 and bread>-.10; dn=rel<-.18 and zf<-.12 and ethm<.16 and bread<.10
        elif s=='LINK': up=rel>.22 and zf>.10 and bread>-.08; dn=rel<-.22 and zf<-.10 and bread<.08
        else: up=rel>.20 and zf>.12 and vr>.60 and bread>-.12; dn=rel<-.20 and zf<-.12 and vr>.60 and bread<.12
    if up:d=1
    elif dn:d=-1
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
            # Exit is deliberately slower than entry and independent of entry trigger.
            slow_break=(state>0 and x['zs']<-.10 and x['zm']<-.16) or (state<0 and x['zs']>.10 and x['zm']>.16)
            hard_flip=(state>0 and x['zf']<-.48 and x['rp24']<.38) or (state<0 and x['zf']>.48 and x['rp24']>.62)
            if give<=-q['trail'] or slow_break or hard_flip or held>=q['maxh']:
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=(state*(xp/entry-1)*100-cost/100)*q['risk'];vals.append(pnl);recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':pnl});state=0;cool=q['re']
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
    ds=[x for x in waves if x is not None]
    return {'majorWaves':len(waves),'captured':len(ds),'captureRatePct':100*len(ds)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median(ds) if ds else None,'missedWaves':len(waves)-len(ds)}

def run(kind):
    candles,idx,_=b.base.load();ps=b.base.periods(candles);name=NAMES[kind]
    dm,dp,dc=portfolio(kind,candles,idx,*ps['development'],NORMAL_BPS,0);vm,vp,vc=portfolio(kind,candles,idx,*ps['validation'],NORMAL_BPS,0);vs,_,_=portfolio(kind,candles,idx,*ps['validation'],STRESS_BPS,1)
    res={'strategyId':f'PAIR_SPECIFIC_V113_{name.upper()}','periods':ps,'development':dm,'developmentPair':dp,'developmentContribution':dc,'validation':vm,'validationPair':vp,'validationContribution':vc,'validationStress':vs,'moveCaptureDiagnostics':{'development':{s:wave_diag(kind,s,candles,idx,*ps['development']) for s in ('BTC','ETH')},'validation':{s:wave_diag(kind,s,candles,idx,*ps['validation']) for s in ('BTC','ETH')}},'productionChanged':False,'realTradingEnabled':False}
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
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem=f'pair-specific-v113-{name}';txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--kind',choices=['pullback_reentry','compression_escape','leadership_transition'],required=True);run(ap.parse_args().kind)
