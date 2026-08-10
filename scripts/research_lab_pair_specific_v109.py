from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v101 as b

SYMS=b.SYMS; HOUR=b.HOUR; NORMAL_BPS=b.NORMAL_BPS; STRESS_BPS=b.STRESS_BPS
ret=b.ret; metric=b.metric
HORIZON=48
RISK={'BTC':.78,'ETH':.74,'BNB':.72,'SOL':.66,'LINK':.66,'AVAX':.62}
TRAIL={'BTC':4.5,'ETH':5.5,'BNB':5.0,'SOL':7.0,'LINK':6.5,'AVAX':7.5}

def mean(x):return statistics.fmean(x) if x else 0.0
def sd(x):return statistics.pstdev(x) if len(x)>1 else 1.0

def slope(c,i,n):
    if i<n:return 0.0
    y=[math.log(float(c[j]['close'])) for j in range(i-n+1,i+1)];m=(n-1)/2;ym=mean(y);den=sum((k-m)**2 for k in range(n))
    return 100*sum((k-m)*(v-ym) for k,v in enumerate(y))/den if den else 0.0

def residual_feature(s,candles,idx,ts,n=168):
    i=idx[s].get(ts);bi=idx['BTC'].get(ts);ei=idx['ETH'].get(ts)
    if i is None or bi is None or i<n or bi<n:return (0.0,0.0)
    sr=b.rseries(candles[s],i,n);br=b.rseries(candles['BTC'],bi,n)
    if s=='BTC':return (0.0,0.0)
    if s=='ETH':
        vb=sum(x*x for x in br);beta=sum(x*y for x,y in zip(br,sr))/vb if vb>1e-12 else 1;rr=[y-beta*x for x,y in zip(br,sr)]
    else:
        if ei is None or ei<n:return (0.0,0.0)
        er=b.rseries(candles['ETH'],ei,n);rr=[x-.55*y-.45*z for x,y,z in zip(sr,br,er)]
    s0=sd(rr[:-24]);return (sum(rr[-12:])/(s0*math.sqrt(12)+1e-9),sum(rr[-48:])/(s0*math.sqrt(48)+1e-9))

def features(kind,s,candles,idx,ts):
    c=candles[s];i=idx[s].get(ts)
    if i is None or i<900:return None
    v168=b.vol(c,i,168);v24=b.vol(c,i,24);v96=b.vol(c,i,96)
    if v168<=1e-9 or v96<=1e-9:return None
    scale=lambda r,n:(r or 0)/(v168*math.sqrt(n)+1e-9)
    r3=ret(c,i,3);r6=ret(c,i,6);r12=ret(c,i,12);r24=ret(c,i,24);r72=ret(c,i,72)
    base=[scale(r3,3),scale(r6,6),scale(r12,12),scale(r24,24),scale(r72,72),slope(c,i,12)*12/(v168*math.sqrt(12)+1e-9),slope(c,i,72)*72/(v168*math.sqrt(72)+1e-9)]
    regime=[v24/v96-1,b.efficiency(c,i,72)-.25,b.range_position(c,i,96)-.5,b.breadth(candles,idx,ts,24)-.5]
    rel24=(r24 or 0)-b.median_move(candles,idx,ts,24);rr12,rr48=residual_feature(s,candles,idx,ts);relative=[rel24/(v168*math.sqrt(24)+1e-9),rr12,rr48]
    if kind=='price_wave':return base+regime
    if kind=='relative_wave':return base[:4]+relative+regime[1:]
    # limited predeclared interactions, no high-dimensional search
    return base[:5]+regime+relative+[base[3]*regime[0],relative[0]*regime[3]]

def target(s,candles,idx,ts):
    c=candles[s];i=idx[s].get(ts)
    if i is None or i+HORIZON>=len(c):return None
    v=b.vol(c,i,168)
    if v<=1e-9:return None
    p0=float(c[i]['close']);p1=float(c[i+HORIZON]['close']);r=100*(p1/p0-1)/(v*math.sqrt(HORIZON)+1e-9)
    return max(-3,min(3,r))

def solve(a,y,lam=2.0):
    n=len(a[0]);M=[[0.0]*(n+1) for _ in range(n)]
    for i in range(n):
        for j in range(n):M[i][j]=sum(row[i]*row[j] for row in a)+(lam if i==j else 0)
        M[i][n]=sum(row[i]*v for row,v in zip(a,y))
    for col in range(n):
        piv=max(range(col,n),key=lambda r:abs(M[r][col]));M[col],M[piv]=M[piv],M[col];d=M[col][col]
        if abs(d)<1e-10:continue
        M[col]=[x/d for x in M[col]]
        for r in range(n):
            if r==col:continue
            q=M[r][col]
            if abs(q)>1e-12:M[r]=[x-q*z for x,z in zip(M[r],M[col])]
    return [M[i][n] for i in range(n)]

def train(kind,s,candles,idx,start,end):
    split=start+int((end-start)*.65);X=[];Y=[]
    for row in candles[s][::6]:
        ts=int(row['ts'])
        if not(start<=ts<split-HORIZON*HOUR):continue
        f=features(kind,s,candles,idx,ts);y=target(s,candles,idx,ts)
        if f is not None and y is not None:X.append(f);Y.append(y)
    if len(X)<100:raise RuntimeError(f'INSUFFICIENT_TRAIN:{s}:{len(X)}')
    mu=[mean([r[j] for r in X]) for j in range(len(X[0]))];ss=[max(sd([r[j] for r in X]),1e-6) for j in range(len(X[0]))]
    Z=[[1.0]+[(r[j]-mu[j])/ss[j] for j in range(len(mu))] for r in X];w=solve(Z,Y)
    model={'mu':mu,'sd':ss,'w':w,'trainStart':start,'trainEnd':split}
    best=None
    for th in [.35,.50,.65,.80]:
        vals,_=pair_trades(kind,s,candles,idx,split,end,NORMAL_BPS,0,model,th)
        m=metric(vals);score=1.8*m.get('returnPct',0)+10*((m.get('pf') or 0)-1)-.25*abs(m.get('maxDDPct',0))+.08*min(m.get('trades',0),40)
        if best is None or score>best[0]:best=(score,th,m)
    model['threshold']=best[1];model['calibration']=best[2];return model

def predict(kind,s,candles,idx,ts,m):
    f=features(kind,s,candles,idx,ts)
    if f is None:return 0.0
    z=[1.0]+[(f[j]-m['mu'][j])/m['sd'][j] for j in range(len(f))];return sum(a*c for a,c in zip(m['w'],z))

def pair_trades(kind,s,candles,idx,start,end,cost,delay,model,threshold=None):
    th=model.get('threshold',threshold) if threshold is None else threshold;c=candles[s];state=0;entry=peak=trough=None;ets=None;vals=[];recs=[]
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        i=idx[s].get(ts)
        if i is None or i<900:continue
        pr=predict(kind,s,candles,idx,ts,model);px=float(c[i]['close']);v24=b.vol(c,i,24);v336=b.vol(c,i,336)
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//HOUR;adverse=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            exitnow=(state>0 and pr<.10*th) or (state<0 and pr>-.10*th) or adverse<=-TRAIL[s] or held>=144
            if exitnow:
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=state*((xp/entry-1)*100)-cost/100;v=pnl*RISK[s];vals.append(v);recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':v});state=0
        if state==0 and v336>1e-9 and v24<3.2*v336:
            d=1 if pr>=th else -1 if pr<=-th else 0
            if d:
                ei=i+1+delay
                if ei<len(c):state=d;entry=float(c[ei]['open']);peak=entry;trough=entry;ets=ts
    if state and ets is not None:
        i=idx[s].get(max(int(r['ts']) for r in c if start<=int(r['ts'])<end));xp=float(c[i]['close']);v=(state*((xp/entry-1)*100)-cost/100)*RISK[s];vals.append(v);recs.append({'entryTs':ets,'exitTs':int(c[i]['ts']),'side':state,'pnl':v})
    return vals,recs

def portfolio(kind,models,candles,idx,start,end,cost,delay):
    vals=[];pair={};contrib={}
    for s in SYMS:
        x,_=pair_trades(kind,s,candles,idx,start,end,cost,delay,models[s]);pair[s]=metric(x);contrib[s]=sum(x);vals.extend(x)
    return metric(vals),pair,contrib

def wave_diag(kind,s,m,candles,idx,start,end):
    _,recs=pair_trades(kind,s,candles,idx,start,end,NORMAL_BPS,0,m);c=candles[s];waves=[];last=-1
    for row in c:
        ts=int(row['ts']);i=idx[s].get(ts)
        if not(start<=ts<end) or ts<=last or i is None or i<336 or i+48>=len(c):continue
        v=b.vol(c,i,168);mv=100*(float(c[i+48]['close'])/float(c[i]['close'])-1);th=max(3,2*v*math.sqrt(48))
        if abs(mv)<th:continue
        side=1 if mv>0 else -1;hit=next((r for r in recs if ts<=r['entryTs']<=ts+18*HOUR and r['side']==side),None);waves.append(None if hit is None else (hit['entryTs']-ts)/HOUR);last=ts+48*HOUR
    d=[x for x in waves if x is not None];return {'majorWaves':len(waves),'captured':len(d),'captureRatePct':100*len(d)/len(waves) if waves else 0,'medianEntryDelayHours':statistics.median(d) if d else None,'missedWaves':len(waves)-len(d)}

def run(kind):
    candles,idx,_=b.base.load();ps=b.base.periods(candles);models={s:train(kind,s,candles,idx,*ps['development']) for s in SYMS}
    dm,dp,dc=portfolio(kind,models,candles,idx,*ps['development'],NORMAL_BPS,0);vm,vp,vc=portfolio(kind,models,candles,idx,*ps['validation'],NORMAL_BPS,0);vs,_,_=portfolio(kind,models,candles,idx,*ps['validation'],STRESS_BPS,1)
    res={'strategyId':f'PAIR_SPECIFIC_V109_{kind.upper()}','periods':ps,'models':{s:{'threshold':models[s]['threshold'],'calibration':models[s]['calibration']} for s in SYMS},'development':dm,'developmentPair':dp,'developmentContribution':dc,'validation':vm,'validationPair':vp,'validationContribution':vc,'validationStress':vs,'moveCaptureDiagnostics':{'development':{s:wave_diag(kind,s,models[s],candles,idx,*ps['development']) for s in ('BTC','ETH')},'validation':{s:wave_diag(kind,s,models[s],candles,idx,*ps['validation']) for s in ('BTC','ETH')}},'productionChanged':False,'realTradingEnabled':False}
    if (dm.get('pf') or 0)<1.05 or dm.get('returnPct',0)<=0 or (vm.get('pf') or 0)<1.05 or vm.get('returnPct',0)<=0:res.update(status='FAIL',reason='FAST_FUNNEL')
    else:
        cm,cp,cc=portfolio(kind,models,candles,idx,*ps['confirmation'],NORMAL_BPS,0);cs,_,_=portfolio(kind,models,candles,idx,*ps['confirmation'],STRESS_BPS,1);res.update(confirmation=cm,confirmationPair=cp,confirmationContribution=cc,confirmationStress=cs)
        if not b.gate(cm,cs):res.update(status='FAIL',reason='CONFIRMATION')
        else:
            hm,hp,hc=portfolio(kind,models,candles,idx,*ps['holdout'],NORMAL_BPS,0);hs,_,_=portfolio(kind,models,candles,idx,*ps['holdout'],STRESS_BPS,1);ym,yp,yc=portfolio(kind,models,candles,idx,ps['development'][0],ps['holdout'][1],NORMAL_BPS,0);ys,_,_=portfolio(kind,models,candles,idx,ps['development'][0],ps['holdout'][1],STRESS_BPS,1);pos=sum((yp[s].get('returnPct') or 0)>0 for s in SYMS);sh=[abs(x) for x in yc.values()];conc=max(sh)/sum(sh) if sum(sh)>1e-9 else 1;ok=b.gate(ym,ys) and (hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and ym.get('returnPct',0)>=60 and pos>=4 and conc<.45;res.update(holdout=hm,holdoutPair=hp,holdoutContribution=hc,holdoutStress=hs,year=ym,yearPair=yp,yearContribution=yc,yearStress=ys,pairConcentration=conc,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL_TARGET')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem=f'pair-specific-v109-{kind}';txt=json.dumps(res,indent=2);(out/f'{stem}.json').write_text(txt,encoding='utf-8');(out/f'{stem}.md').write_text(f'# {res["strategyId"]}\n\n```json\n{txt}\n```\n',encoding='utf-8');print(txt)
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--kind',choices=['price_wave','relative_wave','regime_wave'],required=True);run(ap.parse_args().kind)
