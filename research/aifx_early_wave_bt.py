from __future__ import annotations

import json, math, urllib.request
from pathlib import Path
import numpy as np
import pandas as pd

PAIRS = ["EURUSD","GBPUSD","USDJPY","EURJPY","GBPJPY"]
BASE = "https://raw.githubusercontent.com/ejtraderLabs/historical-data/main"
COST_PIPS = {
    "EURUSD": (0.4,0.1), "GBPUSD": (0.0,0.25), "USDJPY": (0.2,0.1),
    "EURJPY": (0.5,0.15), "GBPJPY": (0.0,0.4),
}
DIRECTIONS=("LONG","SHORT")
FAMILIES={
    "IMPULSE_START":{"stop_atr":1.0,"trail_atr":2.2},
    "CONTINUATION":{"stop_atr":1.1,"trail_atr":2.0},
    "REVERSAL":{"stop_atr":1.2,"trail_atr":2.0},
}
BASE_FAMILIES={
    "breakout":{"stop_atr":1.2,"reward_r":2.2,"hold":20},
    "momentum":{"stop_atr":1.2,"reward_r":2.2,"hold":24},
    "pullback":{"stop_atr":1.4,"reward_r":2.0,"hold":16},
}

def pip_size(pair): return 0.01 if pair.endswith('JPY') else 0.0001
def scale(pair): return 1000.0 if pair.endswith('JPY') else 100000.0

def download(pair: str, cache: Path) -> pd.DataFrame:
    cache.mkdir(parents=True, exist_ok=True)
    p=cache/f"{pair}m15.csv"
    if not p.exists():
        url=f"{BASE}/{pair}/{pair}m15.csv"
        req=urllib.request.Request(url,headers={'User-Agent':'AIFX-Early-Wave-Proxy/1.0'})
        with urllib.request.urlopen(req,timeout=180) as r: p.write_bytes(r.read())
    df=pd.read_csv(p)
    df['Date']=pd.to_datetime(df['Date'],errors='coerce',utc=True)
    df=df.dropna(subset=['Date']).set_index('Date').sort_index()
    s=scale(pair)
    for c in ['open','high','low','close']:
        df[c]=pd.to_numeric(df[c],errors='coerce')/s
    df=df.dropna(subset=['open','high','low','close'])
    df=df[~df.index.duplicated(keep='last')]
    return df[['open','high','low','close']]

def complete_years(df):
    out=[]
    for y in sorted(set(df.index.year)):
        z=df[df.index.year==y]
        if len(z)<20000: continue
        if z.index.to_series().diff().max()<=pd.Timedelta(hours=96): out.append(int(y))
    return out

def add_execution(df,pair):
    z=df.copy()
    pip=pip_size(pair); floor,buf=COST_PIPS[pair]
    spread=2.0*(floor+buf)*pip
    for c in ['open','high','low','close']:
        z[f'mid_{c}']=z[c]
        z[f'bid_{c}']=z[c]-spread/2
        z[f'ask_{c}']=z[c]+spread/2
    return z

def to_m30(m15):
    agg={'open':'first','high':'max','low':'min','close':'last'}
    o=m15.resample('30min',label='left',closed='left').agg(agg)
    cnt=m15['close'].resample('30min',label='left',closed='left').count()
    o=o[cnt==2].dropna()
    return o

def tr(high,low,close):
    prev=close.shift(1)
    return pd.concat([high-low,(high-prev).abs(),(low-prev).abs()],axis=1).max(axis=1)

def adx(high,low,close,n=14):
    atr=tr(high,low,close).ewm(alpha=1/n,adjust=False).mean().replace(0,np.nan)
    up=high.diff(); down=-low.diff()
    pdm=up.where((up>down)&(up>0),0.0); mdm=down.where((down>up)&(down>0),0.0)
    pdi=100*pdm.ewm(alpha=1/n,adjust=False).mean()/atr
    mdi=100*mdm.ewm(alpha=1/n,adjust=False).mean()/atr
    dx=100*(pdi-mdi).abs()/(pdi+mdi).replace(0,np.nan)
    return dx.ewm(alpha=1/n,adjust=False).mean()

def h1_prior(m15_exec):
    g=m15_exec.resample('1h',label='left',closed='left').agg({'mid_open':'first','mid_high':'max','mid_low':'min','mid_close':'last'})
    cnt=m15_exec.mid_close.resample('1h',label='left',closed='left').count()
    g=g[cnt==4].dropna()
    c=g.mid_close
    e24=c.ewm(span=24,adjust=False).mean(); e96=c.ewm(span=96,adjust=False).mean(); a=adx(g.mid_high,g.mid_low,c,14)
    prior=pd.Series(0,index=g.index,dtype='int8')
    prior[(e24>e96)&(a>=14)]=1; prior[(e24<e96)&(a>=14)]=-1
    src=pd.DataFrame({'prior':prior.shift(1),'source_time':g.index.to_series().shift(1)},index=g.index)
    return src

def h1_full_regime(m15_exec):
    g=m15_exec.resample('1h',label='left',closed='left').agg({'mid_open':'first','mid_high':'max','mid_low':'min','mid_close':'last'})
    cnt=m15_exec.mid_close.resample('1h',label='left',closed='left').count()
    g=g[cnt==4].dropna(); c=g.mid_close
    atr=tr(g.mid_high,g.mid_low,c).ewm(alpha=1/14,adjust=False).mean()
    ar=atr/atr.rolling(120,min_periods=60).median()
    e24=c.ewm(span=24,adjust=False).mean(); e96=c.ewm(span=96,adjust=False).mean(); e192=c.ewm(span=192,adjust=False).mean(); a=adx(g.mid_high,g.mid_low,c,14)
    q=ar.between(.6,2.0); up=(e24>e96)&(e96>e192)&(a>=17); dn=(e24<e96)&(e96<e192)&(a>=17)
    src=pd.DataFrame({'up':up,'down':dn,'quality':q,'source_time':g.index.to_series()},index=g.index).shift(1)
    return src

def align_state(state, idx, cols):
    a=state.reindex(idx,method='ffill')
    if 'source_time' in a:
        age=pd.Series(idx,index=idx)-pd.to_datetime(a.source_time,utc=True)
        stale=age>pd.Timedelta(hours=2)
        for c in cols:
            if c=='prior': a.loc[stale,c]=0
            else: a.loc[stale,c]=False
    return a

def features(execdf, tf, prior_state):
    x=execdf.copy(); scale2=1 if tf=='M15' else 2
    atrn=max(2,14//scale2); medn=192//scale2; fast=max(2,4//scale2); slow=max(4,8//scale2); near=max(6,12//scale2); cont=max(12,24//scale2); struct=max(4,8//scale2); bodyw=3 if tf=='M15' else 2
    c=x.mid_close; h=x.mid_high; l=x.mid_low
    x['atr']=tr(h,l,c).ewm(alpha=1/atrn,adjust=False).mean()
    x['atr_ratio']=x.atr/x.atr.rolling(medn,min_periods=medn//2).median()
    x['prior_hi_near']=h.shift(1).rolling(near).max(); x['prior_lo_near']=l.shift(1).rolling(near).min()
    x['prior_hi_fast']=h.shift(1).rolling(fast).max(); x['prior_lo_fast']=l.shift(1).rolling(fast).min()
    x['prior_hi_cont']=h.shift(1).rolling(cont).max(); x['prior_lo_cont']=l.shift(1).rolling(cont).min()
    x['mom_fast']=(c-c.shift(fast))/x.atr; x['mom_slow']=(c-c.shift(slow))/x.atr
    prior_vel=(c.shift(fast)-c.shift(2*fast))/x.atr
    x['accel']=x.mom_fast-prior_vel
    x['body_atr']=(c-x.mid_open)/x.atr
    pos=(x.body_atr>0).astype(int); neg=(x.body_atr<0).astype(int)
    x['pos_bodies']=pos.rolling(bodyw).sum(); x['neg_bodies']=neg.rolling(bodyw).sum(); x['body_need']=math.ceil(bodyw*2/3)
    x['atr_rising']=x.atr>x.atr.shift(fast)*1.02
    x['ema12']=c.ewm(span=max(2,12//scale2),adjust=False).mean(); x['ema36']=c.ewm(span=max(3,36//scale2),adjust=False).mean()
    delta=c.diff(); gain=delta.clip(lower=0).ewm(alpha=1/atrn,adjust=False).mean(); loss=(-delta.clip(upper=0)).ewm(alpha=1/atrn,adjust=False).mean(); x['rsi']=100-100/(1+gain/loss.replace(0,np.nan))
    x['rh16']=h.shift(1).rolling(max(8,16//scale2)).max(); x['rl16']=l.shift(1).rolling(max(8,16//scale2)).min(); x['rh32']=h.shift(1).rolling(max(16,32//scale2)).max(); x['rl32']=l.shift(1).rolling(max(16,32//scale2)).min()
    aligned=align_state(prior_state,x.index,['prior']); x['h1_prior']=aligned.prior.fillna(0).astype(int)
    x.attrs.update({'fast':fast,'slow':slow,'near':near,'cont':cont,'struct':struct,'scale2':scale2})
    return x

def early_signals(x,direction):
    side=1 if direction=='LONG' else -1; fast=x.attrs['fast']; slow=x.attrs['slow']
    if side==1:
        proximity=x.mid_close>=x.prior_hi_near-0.10*x.atr; bodies=x.pos_bodies>=x.body_need
    else:
        proximity=x.mid_close<=x.prior_lo_near+0.10*x.atr; bodies=x.neg_bodies>=x.body_need
    displacement=side*x.mom_fast>=0.75; body=side*x.body_atr>=0.25; atr_ok=x.atr_ratio>=0.80; accel=side*x.accel>=0.15; h1=(x.h1_prior==side)
    score=body.astype(int)+bodies.astype(int)+atr_ok.astype(int)+x.atr_rising.astype(int)+accel.astype(int)+h1.astype(int)
    impulse=(proximity&displacement&(score>=4)).fillna(False)
    if side==1:
        peak=x.mid_high.shift(1).rolling(slow).max(); trough_recent=x.mid_low.shift(1).rolling(fast).min(); shallow=(peak-trough_recent)<=1.10*x.atr; rebreak=x.mid_close>x.prior_hi_fast
    else:
        trough=x.mid_low.shift(1).rolling(slow).min(); peak_recent=x.mid_high.shift(1).rolling(fast).max(); shallow=(peak_recent-trough)<=1.10*x.atr; rebreak=x.mid_close<x.prior_lo_fast
    cont_score=bodies.astype(int)+atr_ok.astype(int)+(side*x.mom_fast>=0.20).astype(int)+x.atr_rising.astype(int)+h1.astype(int)
    continuation=((side*x.mom_slow>=0.80)&shallow&rebreak&(cont_score>=3)).fillna(False)
    prior_adverse=side*((x.mid_close.shift(fast)-x.mid_close.shift(2*slow))/x.atr)<=-0.80
    micro=(x.mid_close>x.prior_hi_fast) if side==1 else (x.mid_close<x.prior_lo_fast)
    rev_score=bodies.astype(int)+atr_ok.astype(int)+(side*x.accel>=0.20).astype(int)+x.atr_rising.astype(int)+h1.astype(int)
    reversal=(prior_adverse&(side*x.mom_fast>=0.55)&micro&(rev_score>=3)).fillna(False)
    return {'IMPULSE_START':impulse,'CONTINUATION':continuation,'REVERSAL':reversal}

def structure_breaks(x):
    n=x.attrs['struct']; lo=x.mid_low.shift(1).rolling(n).min(); hi=x.mid_high.shift(1).rolling(n).max()
    return {'LONG':(x.mid_close<lo).fillna(False),'SHORT':(x.mid_close>hi).fillna(False)}

def simulate_early(x, sig, impulse_opp, struct_break, pair, family, direction, start, end):
    cfg=FAMILIES[family]; side=1 if direction=='LONG' else -1; idx=x.index
    mask=(idx>=pd.Timestamp(start,tz='UTC'))&(idx<pd.Timestamp(end,tz='UTC'))
    cand=np.flatnonzero(mask & sig.to_numpy())
    atr=x.atr.to_numpy(); ao=x.ask_open.to_numpy(); bo=x.bid_open.to_numpy(); bh=x.bid_high.to_numpy(); bl=x.bid_low.to_numpy(); ah=x.ask_high.to_numpy(); ac=x.ask_close.to_numpy(); bc=x.bid_close.to_numpy(); mh=x.mid_high.to_numpy(); ml=x.mid_low.to_numpy()
    opp=impulse_opp.to_numpy(); sb=struct_break.to_numpy(); maxbars=960 if x.attrs['scale2']==1 else 480; pip=pip_size(pair)
    rows=[]; last_exit=-1
    for i in cand:
        ei=i+1
        if i<=last_exit or ei>=len(x) or idx[ei]>=pd.Timestamp(end,tz='UTC') or not np.isfinite(atr[i]) or atr[i]<=0: continue
        entry=ao[ei] if side==1 else bo[ei]; risk=float(atr[i])*cfg['stop_atr']; stop=entry-side*risk; best=entry; xi=min(ei+maxbars,len(x)-1); reason='FAILSAFE'; exitp=None
        for j in range(ei,xi+1):
            op=bo[j] if side==1 else ao[j]
            if j>ei and ((op<=stop) if side==1 else (op>=stop)):
                xi=j; exitp=float(op); reason='STOP_GAP'; break
            hit=(bl[j]<=stop) if side==1 else (ah[j]>=stop)
            if hit:
                xi=j; exitp=float(stop); reason='TRAIL_STOP'; break
            if j>ei and (opp[j-1] or sb[j-1]):
                xi=j; exitp=float(op); reason='OPPOSITE_SEED' if opp[j-1] else 'STRUCTURE_BREAK'; break
            if j==xi:
                exitp=float(bc[j] if side==1 else ac[j]); break
            best=max(best,mh[j]) if side==1 else min(best,ml[j])
            if np.isfinite(atr[j]):
                chand=best-side*cfg['trail_atr']*float(atr[j])
                stop=max(stop,chand) if side==1 else min(stop,chand)
        r=side*(exitp-entry)/risk
        rows.append({'pair':pair,'family':family,'direction':direction,'timeframe':'M15' if x.attrs['scale2']==1 else 'M30','entry_time':idx[ei].isoformat(),'exit_time':idx[xi].isoformat(),'entry_price':float(entry),'exit_price':float(exitp),'risk_distance':risk,'net_r':float(r),'net_pips':float(side*(exitp-entry)/pip),'reason':reason})
        last_exit=xi
    return rows

def metrics(rows):
    if not rows: return {'trades':0,'net_r':0.0,'pf':0.0,'max_dd_r':0.0,'net_pips':0.0,'win_rate':0.0}
    a=np.array([r['net_r'] for r in sorted(rows,key=lambda q:q['exit_time'])],float); gains=a[a>0].sum(); losses=-a[a<0].sum(); cur=np.r_[0,np.cumsum(a)]; dd=cur-np.maximum.accumulate(cur)
    return {'trades':len(rows),'net_r':float(a.sum()),'pf':float(gains/losses) if losses>0 else (99.0 if gains>0 else 0.0),'max_dd_r':float(dd.min()),'net_pips':float(sum(r['net_pips'] for r in rows)),'win_rate':float((a>0).mean())}

def yrange(y): return f'{y}-01-01',f'{y+1}-01-01'

def select_early_for_tf(x,pair,direction,dev,val):
    sigs=early_signals(x,direction); opp=early_signals(x,'SHORT' if direction=='LONG' else 'LONG')['IMPULSE_START']; sb=structure_breaks(x)[direction]
    cands=[]
    for fam,sig in sigs.items():
        by={}; allr=[]
        for y in dev:
            s,e=yrange(y); r=simulate_early(x,sig,opp,sb,pair,fam,direction,s,e); by[str(y)]=metrics(r); allr+=r
        m=metrics(allr); pos=sum(by[str(y)]['net_r']>0 for y in dev); worst=min(by[str(y)]['net_r'] for y in dev)
        cands.append({'family':fam,'signal':sig,'opp':opp,'sb':sb,'development':m,'development_by_year':by,'positive_dev_years':pos,'worst_dev_year_r':worst})
    cands.sort(key=lambda z:(z['positive_dev_years'],z['worst_dev_year_r'],z['development']['net_r'],z['development']['pf']),reverse=True); ch=cands[0]
    req=max(2,math.ceil(len(dev)*.67)); dg=ch['positive_dev_years']>=req and ch['development']['net_r']>0 and ch['development']['trades']>=80 and ch['development']['pf']>=1.02
    vb={}; vr=[]
    if dg:
        for y in val:
            s,e=yrange(y); r=simulate_early(x,ch['signal'],ch['opp'],ch['sb'],pair,ch['family'],direction,s,e); vb[str(y)]=metrics(r); vr+=r
    vm=metrics(vr); vg=dg and all(vb[str(y)]['net_r']>0 for y in val) and vm['trades']>=40 and vm['pf']>=1.05
    return ch, dg, vb, vm, vg

def choose_tf(tfres,val):
    passed=[tf for tf,z in tfres.items() if z['validation_gate']]
    if not passed:return None
    if len(passed)==1:return passed[0]
    a,b=passed; ar=tfres[a]['validation']['net_r']/len(val); br=tfres[b]['validation']['net_r']/len(val)
    if abs(ar-br)>5:return a if ar>br else b
    ad=abs(tfres[a]['validation']['max_dd_r']); bd=abs(tfres[b]['validation']['max_dd_r'])
    if abs(ad-bd)>1e-12:return a if ad<bd else b
    ap=tfres[a]['validation']['pf']; bp=tfres[b]['validation']['pf']
    if abs(ap-bp)>1e-12:return a if ap>bp else b
    return 'M30'

def baseline_features(execdf, fullstate):
    x=execdf.copy(); c=x.mid_close; h=x.mid_high; l=x.mid_low
    x['atr']=tr(h,l,c).ewm(alpha=1/14,adjust=False).mean(); x['atr_ratio']=x.atr/x.atr.rolling(192,min_periods=96).median(); x['ema12']=c.ewm(span=12,adjust=False).mean(); x['ema36']=c.ewm(span=36,adjust=False).mean()
    d=c.diff(); g=d.clip(lower=0).ewm(alpha=1/14,adjust=False).mean(); ls=(-d.clip(upper=0)).ewm(alpha=1/14,adjust=False).mean(); x['rsi']=100-100/(1+g/ls.replace(0,np.nan)); x['rh16']=h.shift(1).rolling(16).max(); x['rl16']=l.shift(1).rolling(16).min(); x['rh32']=h.shift(1).rolling(32).max(); x['rl32']=l.shift(1).rolling(32).min()
    st=align_state(fullstate,x.index,['up','down','quality']); x[['hup','hdown','hqual']]=st[['up','down','quality']].fillna(False).astype(bool)
    return x

def baseline_signal(x,fam,direction):
    side=1 if direction=='LONG' else -1; allowed=x.atr_ratio.between(.65,1.9)&x.hqual&(x.hup if side==1 else x.hdown)
    if fam=='breakout':
        raw=(x.mid_close>x.rh16+.05*x.atr) if side==1 else (x.mid_close<x.rl16-.05*x.atr); raw&=(x.rsi>54) if side==1 else (x.rsi<46)
    elif fam=='momentum':
        raw=(x.mid_close>x.rh32) if side==1 else (x.mid_close<x.rl32); raw&=(x.rsi>57) if side==1 else (x.rsi<43); raw&=x.atr_ratio>=.8
    else:
        raw=((x.ema12>x.ema36)&(x.mid_low<=x.ema12)&(x.mid_close>x.ema12)&x.rsi.between(45,68)) if side==1 else ((x.ema12<x.ema36)&(x.mid_high>=x.ema12)&(x.mid_close<x.ema12)&x.rsi.between(32,55))
    return (allowed&raw).fillna(False)

def simulate_baseline(x,sig,pair,fam,direction,start,end):
    cfg=BASE_FAMILIES[fam]; side=1 if direction=='LONG' else -1; idx=x.index; mask=(idx>=pd.Timestamp(start,tz='UTC'))&(idx<pd.Timestamp(end,tz='UTC')); cand=np.flatnonzero(mask&sig.to_numpy()); atr=x.atr.to_numpy(); ao=x.ask_open.to_numpy(); bo=x.bid_open.to_numpy(); bh=x.bid_high.to_numpy(); bl=x.bid_low.to_numpy(); ah=x.ask_high.to_numpy(); al=x.ask_low.to_numpy(); bc=x.bid_close.to_numpy(); ac=x.ask_close.to_numpy(); pip=pip_size(pair); rows=[]; last=-1
    for i in cand:
        ei=i+1
        if i<=last or ei>=len(x) or idx[ei]>=pd.Timestamp(end,tz='UTC') or not np.isfinite(atr[i]):continue
        entry=ao[ei] if side==1 else bo[ei]; risk=float(atr[i])*cfg['stop_atr']; stop=entry-side*risk; tgt=entry+side*risk*cfg['reward_r']; xi=min(ei+cfg['hold'],len(x)-1); exitp=None
        for j in range(ei,xi+1):
            op=bo[j] if side==1 else ao[j]
            if j>ei and ((op<=stop) if side==1 else (op>=stop)): xi=j; exitp=float(op); break
            if j>ei and ((op>=tgt) if side==1 else (op<=tgt)): xi=j; exitp=float(tgt); break
            sh=(bl[j]<=stop) if side==1 else (ah[j]>=stop); th=(bh[j]>=tgt) if side==1 else (al[j]<=tgt)
            if sh: xi=j; exitp=float(stop); break
            if th: xi=j; exitp=float(tgt); break
        if exitp is None: exitp=float(bc[xi] if side==1 else ac[xi])
        rows.append({'net_r':float(side*(exitp-entry)/risk),'net_pips':float(side*(exitp-entry)/pip),'entry_time':idx[ei].isoformat(),'exit_time':idx[xi].isoformat()}); last=xi
    return rows

def select_baseline(x,pair,direction,dev):
    c=[]
    for fam in BASE_FAMILIES:
        sig=baseline_signal(x,fam,direction); by={}; rows=[]
        for y in dev:
            s,e=yrange(y); r=simulate_baseline(x,sig,pair,fam,direction,s,e); by[str(y)]=metrics(r); rows+=r
        m=metrics(rows); pos=sum(by[str(y)]['net_r']>0 for y in dev); worst=min(by[str(y)]['net_r'] for y in dev)
        c.append((pos,worst,m['net_r'],m['pf'],fam,sig,m,by))
    c.sort(key=lambda q:q[:4],reverse=True); return c[0]

def zigzag_legs(execdf,start,end,pair,mult=6.0):
    m=execdf[(execdf.index>=pd.Timestamp(start,tz='UTC'))&(execdf.index<pd.Timestamp(end,tz='UTC'))]
    h=m.resample('1h',label='left',closed='left').agg({'mid_high':'max','mid_low':'min','mid_close':'last'}).dropna()
    if len(h)<10:return []
    a=tr(h.mid_high,h.mid_low,h.mid_close).ewm(alpha=1/14,adjust=False).mean(); thr=float(a.median())*mult
    vals=h.mid_close.to_numpy(); times=h.index; piv=[]; hi=lo=float(vals[0]); hii=loi=0; d=0
    for i in range(1,len(vals)):
        v=float(vals[i])
        if d==0:
            if v>hi:hi,hii=v,i
            if v<lo:lo,loi=v,i
            if hi-lo>=thr:
                if hii>loi:piv.append((loi,lo));d=1;hi,hii=v,i
                else:piv.append((hii,hi));d=-1;lo,loi=v,i
        elif d==1:
            if v>hi:hi,hii=v,i
            elif hi-v>=thr:piv.append((hii,hi));d=-1;lo,loi=v,i
        else:
            if v<lo:lo,loi=v,i
            elif v-lo>=thr:piv.append((loi,lo));d=1;hi,hii=v,i
    if d==1:piv.append((hii,hi))
    elif d==-1:piv.append((loi,lo))
    legs=[]; pip=pip_size(pair)
    for a0,b0 in zip(piv[:-1],piv[1:]):
        move=b0[1]-a0[1]
        legs.append({'start_time':times[a0[0]],'end_time':times[b0[0]],'start_price':a0[1],'end_price':b0[1],'direction':'LONG' if move>0 else 'SHORT','pips':abs(move)/pip})
    return legs

def lag_stats(legs, signal_series, x, direction):
    rel=[q for q in legs if q['direction']==direction]; lags=[]; tlags=[]; detected=0; sig_times=signal_series[signal_series].index
    for q in rel:
        cand=sig_times[(sig_times>=q['start_time'])&(sig_times<q['end_time'])]
        if len(cand)==0:continue
        t=cand[0]; px=float(x.loc[t,'mid_close']); side=1 if direction=='LONG' else -1; den=abs(q['end_price']-q['start_price'])
        if den<=0:continue
        lag=max(0.0,min(1.0,side*(px-q['start_price'])/den)); dur=(q['end_time']-q['start_time']).total_seconds(); tlag=max(0.0,min(1.0,(t-q['start_time']).total_seconds()/dur)) if dur>0 else 0
        lags.append(lag);tlags.append(tlag);detected+=1
    return {'legs':len(rel),'detected':detected,'coverage':detected/len(rel) if rel else 0.0,'median_price_lag':float(np.median(lags)) if lags else None,'mean_price_lag':float(np.mean(lags)) if lags else None,'median_time_lag':float(np.median(tlags)) if tlags else None}

def apply_portfolio_policy(trades):
    active=[]; accepted=[]; rej_pair=rej_pos=rej_cur=0
    def exposure(t):
        b,q=t['pair'][:3],t['pair'][3:]; s=1 if t['direction']=='LONG' else -1; return {b:s,q:-s}
    for t in sorted(trades,key=lambda z:(z['entry_time'],z['pair'],z['direction'])):
        et=pd.Timestamp(t['entry_time']); active=[a for a in active if pd.Timestamp(a['exit_time'])>et]
        if any(a['pair']==t['pair'] for a in active):rej_pair+=1;continue
        if len(active)>=5:rej_pos+=1;continue
        ex={}
        for a in active:
            for c,v in exposure(a).items():ex[c]=ex.get(c,0)+v
        pr=dict(ex)
        for c,v in exposure(t).items():pr[c]=pr.get(c,0)+v
        if any(abs(v)>2 for v in pr.values()):rej_cur+=1;continue
        accepted.append(t);active.append(t)
    return accepted,{'rejected_same_pair':rej_pair,'rejected_position_limit':rej_pos,'rejected_currency_limit':rej_cur}

def mtm_dd(trades,m15frames,start,end):
    if not trades:return 0.0
    union=pd.DatetimeIndex(sorted(set().union(*[set(df[(df.index>=pd.Timestamp(start,tz='UTC'))&(df.index<pd.Timestamp(end,tz='UTC'))].index) for df in m15frames.values()])))
    px={p:df[['bid_close','ask_close']].reindex(union,method='ffill',tolerance=pd.Timedelta(hours=2)) for p,df in m15frames.items()}
    entries={};exits={}
    for t in trades:
        entries.setdefault(pd.Timestamp(t['entry_time']),[]).append(t);exits.setdefault(pd.Timestamp(t['exit_time']),[]).append(t)
    active={};real=0.;peak=0.;worst=0.
    for ts in union:
        for t in entries.get(ts,[]):active[(t['pair'],t['entry_time'])]=t
        for t in exits.get(ts,[]):real+=t['net_r'];active.pop((t['pair'],t['entry_time']),None)
        op=0.
        for t in active.values():
            r=px[t['pair']].loc[ts]
            if r.isna().any():continue
            val=float(r.bid_close if t['direction']=='LONG' else r.ask_close); side=1 if t['direction']=='LONG' else -1; op+=side*(val-t['entry_price'])/t['risk_distance']
        eq=real+op;peak=max(peak,eq);worst=min(worst,eq-peak)
    return float(worst)

def main():
    root=Path(__file__).resolve().parents[1]; cache=root/'research/.aifx_proxy_cache'; out=root/'research/aifx_early_wave_results.json'; summary=root/'research/aifx_early_wave_summary.md'
    raw={p:download(p,cache) for p in PAIRS}
    common=None; cy={p:complete_years(df) for p,df in raw.items()}
    for p in PAIRS: common=set(cy[p]) if common is None else common&set(cy[p])
    years=sorted(common or []); assert len(years)>=7,years; oos=years[-2:]; val=years[-4:-2]; dev=years[:-4]
    m15={p:add_execution(df,p) for p,df in raw.items()}; m30={p:add_execution(to_m30(df),p) for p,df in raw.items()}
    result={'status':'PROXY_ONLY','precommit':'AIFX_EARLY_WAVE_PRECOMMIT_20260811.md','source':'ejtraderLabs/historical-data','source_timezone_verified':False,'session_rules_used':False,'cost_stress':'2x floor+buffer','complete_years_by_pair':cy,'development_years':dev,'validation_years':val,'oos_years':oos,'pairs':{},'portfolio':{}}
    selected_trades=[]
    for pair in PAIRS:
        pstate=h1_prior(m15[pair]); full=h1_full_regime(m15[pair]); bfeat=baseline_features(m15[pair],full); pr={'directions':{},'oos_swing_opportunity':{}}
        for direction in DIRECTIONS:
            tfres={}; stored={}
            for tf,df in [('M15',m15[pair]),('M30',m30[pair])]:
                x=features(df,tf,pstate); ch,dg,vb,vm,vg=select_early_for_tf(x,pair,direction,dev,val)
                tfres[tf]={'chosen_family':ch['family'],'development':ch['development'],'development_by_year':ch['development_by_year'],'positive_dev_years':ch['positive_dev_years'],'worst_dev_year_r':ch['worst_dev_year_r'],'development_gate':dg,'validation':vm,'validation_by_year':vb,'validation_gate':vg}
                stored[tf]=(x,ch)
            sel=choose_tf(tfres,val); oos_by={}; orows=[]; opass=False; early_sig=None; selected_family=None
            if sel:
                x,ch=stored[sel]; selected_family=ch['family']; opp=ch['opp']; sb=ch['sb']
                for y in oos:
                    s,e=yrange(y); rr=simulate_early(x,ch['signal'],opp,sb,pair,ch['family'],direction,s,e); oos_by[str(y)]=metrics(rr);orows+=rr
                om=metrics(orows);opass=all(oos_by[str(y)]['net_r']>0 for y in oos) and om['pf']>=1.05; early_sig=ch['signal']; selected_trades+=orows
            else:om=metrics([])
            bp=select_baseline(bfeat,pair,direction,dev); bfam,bsig=bp[4],bp[5]; b_oos={};brows=[]
            for y in oos:
                s,e=yrange(y); rr=simulate_baseline(bfeat,bsig,pair,bfam,direction,s,e);b_oos[str(y)]=metrics(rr);brows+=rr
            bmet=metrics(brows)
            pr['directions'][direction]={'timeframes':tfres,'selected_timeframe':sel,'selected_family':selected_family,'oos':om,'oos_by_year':oos_by,'oos_pass':opass,'baseline_dev_selected_family':bfam,'baseline_oos':bmet,'baseline_oos_by_year':b_oos,'lag_by_year':{}}
            for y in oos:
                s,e=yrange(y);legs=zigzag_legs(m15[pair],s,e,pair)
                early_lag=lag_stats(legs,early_sig,stored[sel][0],direction) if sel else {'legs':sum(q['direction']==direction for q in legs),'detected':0,'coverage':0.0,'median_price_lag':None,'mean_price_lag':None,'median_time_lag':None}
                base_lag=lag_stats(legs,bsig,bfeat,direction)
                pr['directions'][direction]['lag_by_year'][str(y)]={'early':early_lag,'baseline':base_lag}
        for y in oos:
            s,e=yrange(y);legs=zigzag_legs(m15[pair],s,e,pair); total=sum(q['pips'] for q in legs); lp=sum(q['pips'] for q in legs if q['direction']=='LONG');sp=sum(q['pips'] for q in legs if q['direction']=='SHORT'); net=sum(pr['directions'][d]['oos_by_year'].get(str(y),{}).get('net_pips',0.0) for d in DIRECTIONS)
            pr['oos_swing_opportunity'][str(y)]={'major_swing_pips':total,'long_pips':lp,'short_pips':sp,'legs':len(legs),'selected_net_pips':net,'net_capture_ratio':net/total if total else 0.0}
        result['pairs'][pair]=pr
    accepted,policy=apply_portfolio_policy(selected_trades); pm=metrics(accepted); start=f'{oos[0]}-01-01';end=f'{oos[-1]+1}-01-01'; pm['mtm_max_dd_r']=mtm_dd(accepted,m15,start,end); pm['policy']=policy
    by={}
    for y in oos: by[str(y)]=metrics([t for t in accepted if pd.Timestamp(t['entry_time']).year==y])
    pm['by_year']=by; result['portfolio']=pm
    result['oos_passed_directions']=[f'{p}:{d}' for p,v in result['pairs'].items() for d,z in v['directions'].items() if z['oos_pass']]
    result['status']='PROXY_PROMISING' if result['oos_passed_directions'] else 'PROXY_REJECT'
    out.write_text(json.dumps(result,indent=2,ensure_ascii=False,allow_nan=False))
    lines=["# AIFX Early Wave Proxy Result","",f"Status: **{result['status']}**",f"Dev: {dev}  Validation: {val}  OOS: {oos}",f"OOS passed: {', '.join(result['oos_passed_directions']) or 'none'}","",f"Portfolio OOS: {pm['net_r']:.2f}R, PF {pm['pf']:.3f}, realized DD {pm['max_dd_r']:.2f}R, MTM DD {pm['mtm_max_dd_r']:.2f}R, trades {pm['trades']}","",'|Pair|Dir|TF|Family|OOS R|PF|DD R|Trades|Pass|','|---|---|---|---|---:|---:|---:|---:|---|']
    for p in PAIRS:
        for d in DIRECTIONS:
            z=result['pairs'][p]['directions'][d]; m=z['oos']; lines.append(f"|{p}|{d}|{z['selected_timeframe'] or '-'}|{z['selected_family'] or '-'}|{m['net_r']:.2f}|{m['pf']:.3f}|{m['max_dd_r']:.2f}|{m['trades']}|{'PASS' if z['oos_pass'] else 'FAIL'}|")
    summary.write_text('\n'.join(lines))
    print(json.dumps({'status':result['status'],'dev':dev,'validation':val,'oos':oos,'passed':result['oos_passed_directions'],'portfolio':pm},indent=2))
if __name__=='__main__':main()
