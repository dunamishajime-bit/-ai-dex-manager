from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS; HOUR=b.HOUR; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS
metric=b.metric; ret=b.ret

# V112 is a new architecture family, frozen prospectively before Validation.
# It is not a parameter sweep of V111: it tests pullback re-entry, compression escape,
# and cross-asset leadership transition lifecycles.
P={
'BTC':dict(risk=.80,trail=5.8,maxh=240,re=6),
'ETH':dict(risk=.76,trail=6.6,maxh=216,re=5),
'BNB':dict(risk=.66,trail=5.2,maxh=192,re=7),
'SOL':dict(risk=.62,trail=7.2,maxh=168,re=5),
'LINK':dict(risk=.58,trail=7.0,maxh=168,re=5),
'AVAX':dict(risk=.58,trail=7.8,maxh=156,re=5)}

def zmove(c,i,n):
    v=b.vol(c,i,168); r=ret(c,i,n)
    return (r or 0)/(v*math.sqrt(n)+1e-9) if v>1e-9 else 0

def feat(s,candles,idx,ts):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<900:return None
    z3,z6,z12,z24,z48,z96=[zmove(c,i,n) for n in (3,6,12,24,48,96)]
    eff24=b.efficiency(c,i,24);eff72=b.efficiency(c,i,72);rp48=b.range_position(c,i,48);rp120=b.range_position(c,i,120)
    v24=b.vol(c,i,24);v168=b.vol(c,i,168);compression=(v24/(v168+1e-9)) if v168>1e-9 else 1
    breadth=b.breadth(candles,idx,ts,12)-.5
    btc=candles['BTC'];bi=idx['BTC'].get(ts);btc12=zmove(btc,bi,12) if bi is not None and bi>=900 else 0
    med=b.median_move(candles,idx,ts,12);v=b.vol(c,i,168);rel=((ret(c,i,12) or 0)-med)/(v*math.sqrt(12)+1e-9) if v>1e-9 else 0
    return dict(i=i,z3=z3,z6=z6,z12=z12,z24=z24,z48=z48,z96=z96,eff24=eff24,eff72=eff72,rp48=rp48,rp120=rp120,compression=compression,breadth=breadth,btc12=btc12,rel=rel)

def signal(kind,s,candles,idx,ts):
    x=feat(s,candles,idx,ts)
    if not x:return 0,x
    z3,z6,z12,z24,z48,z96=x['z3'],x['z6'],x['z12'],x['z24'],x['z48'],x['z96']
    rp48,rp120=x['rp48'],x['rp120'];eff24,eff72=x['eff24'],x['eff72'];comp=x['compression'];bread=x['breadth'];rel=x['rel'];btc=x['btc12']
    d=0
    if kind=='pullback_reentry':
        # Mature regime + temporary counter-move + resumption. Designed to capture the middle of large waves repeatedly.
        long_reg=z96>.18 and z48>.12 and rp120>.52
        short_reg=z96<-.18 and z48<-.12 and rp120<.48
        long_pull=z12<.10 and z6>-.42 and z3>.05 and eff72>.10
        short_pull=z12>-.10 and z6<.42 and z3<-.05 and eff72>.10
        if s=='ETH': long_pull=long_pull and rel>-.25; short_pull=short_pull and rel<.25
        if long_reg and long_pull:d=1
        elif short_reg and short_pull:d=-1
    elif kind=='compression_escape':
        # Low realized-volatility state followed by abrupt range escape; no mature-trend prerequisite.
        quiet=comp<.78 and eff24<.28
        up=quiet and z3>.28 and z6>.34 and rp48>.68 and z24>-.10
        dn=quiet and z3<-.28 and z6<-.34 and rp48<.32 and z24<.10
        if s in ('SOL','LINK','AVAX'): up=up and bread>-.08; dn=dn and bread<.08
        if up:d=1
        elif dn:d=-1
    else: # leadership_transition
        # Direction follows a fresh shift in leadership, not absolute trend level.
        if s=='BTC':
            up=z6>.20 and z24>0 and bread<.10 and rp48>.58
            dn=z6<-.20 and z24<0 and bread>-.10 and rp48<.42
        elif s=='ETH':
            up=rel>.25 and z6>.10 and btc>-.15 and rp48>.55
            dn=rel<-.25 and z6<-.10 and btc<.15 and rp48<.45
        else:
            up=rel>.30 and bread>.02 and z6>.12 and rp48>.56
            dn=rel<-.30 and bread<-.02 and z6<-.12 and rp48<.44
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
            z6,z24,z48=x['z6'],x['z24'],x['z48']
            momentum_break=(state>0 and z6<-.35 and z24<0) or (state<0 and z6>.35 and z24>0)
            structural_break=(state>0 and z48<-.12) or (state<0 and z48>.12)
            if give<=-q['trail'] or momentum_break or structural_break or held>=q['maxh']:
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
    d=[x for x in waves if x is not None]
    return {'majorWaves':len(waves),'captured':len(d),'captureRatePct':100*len(d)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median(d) if d else None,'missedWaves':len(waves)-len(d)}

def run(kind):
    candles,idx,_=b.base.load();ps=b.base.periods(candles)
    dm,dp,dc=portfolio(kind,candles,idx,*ps['development'],NORMAL_BPS,0);vm,vp,vc=portfolio(kind,candles,idx,*ps['validation'],NORMAL_BPS,0);vs,_,_=portfolio(kind,candles,idx,*ps['validation'],STRESS_BPS,1)
    res={'strategyId':f'PAIR_SPECIFIC_V112_{kind.upper()}','periods':ps,'development':dm,'developmentPair':dp,'developmentContribution':dc,'validation':vm,'validationPair':vp,'validationContribution':vc,'validationStress':vs,'moveCaptureDiagnostics':{'development':{s:wave_diag(kind,s,candles,idx,*ps['development']) for s in ('BTC','ETH')},'validation':{s:wave_diag(kind,s,candles,idx,*ps['validation']) for s in ('BTC','ETH')}},'productionChanged':False,'realTradingEnabled':False}
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
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem=f'pair-specific-v112-{kind}';txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n');print(txt)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--kind',choices=['pullback_reentry','compression_escape','leadership_transition'],required=True);run(ap.parse_args().kind)
