import json, math, os, time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import io, zipfile, csv
from datetime import datetime, timezone
import pandas as pd
import numpy as np

BASE='https://fapi.binance.com'
START='2024-12-17T00:00:00Z'
END='2025-07-18T12:00:00Z'
OUT='research/pengu-v2-current-freeze-binance'
GROSS=.75
FEE=.0006
P={'latr':.0125,'sp24':-.12,'sbtc':-.04,'srsi':30,'svol':3,'target':.02,'floor':.6}

def ms(s): return int(pd.Timestamp(s).timestamp()*1000)
def get_json(path, params, retries=5):
    url=BASE+path+'?'+urlencode(params)
    err=None
    for k in range(retries):
        try:
            req=Request(url,headers={'User-Agent':'Mozilla/5.0 PENGU-V2-Research'})
            with urlopen(req,timeout=30) as r: return json.loads(r.read().decode())
        except Exception as e:
            err=e; time.sleep(1.5*(k+1))
    raise RuntimeError(f'GET failed {url}: {err!r}')

def _months(start,end):
    a=pd.Timestamp(start,unit='ms',tz='UTC').to_period('M')
    z=pd.Timestamp(end-1,unit='ms',tz='UTC').to_period('M')
    out=[]
    while a<=z:
        out.append(str(a)); a+=1
    return out

def _zip_csv(url):
    req=Request(url,headers={'User-Agent':'Mozilla/5.0 PENGU-V2-Research'})
    with urlopen(req,timeout=30) as r: raw=r.read()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names=[n for n in z.namelist() if n.lower().endswith('.csv')]
        if not names: return []
        text=z.read(names[0]).decode('utf-8-sig')
    return list(csv.reader(io.StringIO(text)))

def klines_vision(symbol,start,end):
    rows=[]
    for ym in _months(start,end):
        url=f'https://data.binance.vision/data/futures/um/monthly/klines/{symbol}/1h/{symbol}-1h-{ym}.zip'
        try:
            rr=_zip_csv(url)
            for x in rr:
                if not x: continue
                try: int(float(x[0]))
                except: continue
                rows.append(x[:12])
        except Exception as e:
            print('VISION_KLINE_MISS',url,repr(e))
    if not rows: raise RuntimeError('no Data Vision kline rows')
    df=pd.DataFrame(rows,columns=['t','open','high','low','close','volume','closeTime','quoteVolume','trades','tbBase','tbQuote','ignore'])
    for c in ['open','high','low','close','volume']: df[c]=pd.to_numeric(df[c],errors='coerce')
    tt=pd.to_numeric(df['t'],errors='coerce')
    unit='us' if float(tt.dropna().median())>1e14 else 'ms'
    df['t']=pd.to_datetime(tt,unit=unit,utc=True)
    lo=pd.Timestamp(start,unit='ms',tz='UTC'); hi=pd.Timestamp(end,unit='ms',tz='UTC')
    return df[(df.t>=lo)&(df.t<hi)][['t','open','high','low','close','volume']].drop_duplicates('t').sort_values('t').reset_index(drop=True)

def funding_vision(symbol,start,end):
    rows=[]
    for ym in _months(start,end):
        url=f'https://data.binance.vision/data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip'
        try:
            rr=_zip_csv(url)
            for x in rr:
                if not x: continue
                try:
                    vals=[float(v) if v not in ('','null','None') else float('nan') for v in x]
                except: continue
                ti=None
                for j,v in enumerate(vals):
                    if np.isfinite(v) and v>1e11: ti=j; break
                if ti is None: continue
                ri=None
                for j in range(len(vals)-1,-1,-1):
                    v=vals[j]
                    if j!=ti and np.isfinite(v) and abs(v)<0.1:
                        ri=j; break
                if ri is not None: rows.append((vals[ti],vals[ri]))
        except Exception as e:
            print('VISION_FUND_MISS',url,repr(e))
    if not rows: return pd.DataFrame(columns=['t','rate'])
    df=pd.DataFrame(rows,columns=['ts','rate']); unit='us' if float(df.ts.median())>1e14 else 'ms'
    df['t']=pd.to_datetime(df.ts,unit=unit,utc=True)
    lo=pd.Timestamp(start,unit='ms',tz='UTC'); hi=pd.Timestamp(end,unit='ms',tz='UTC')
    return df[(df.t>=lo)&(df.t<hi)][['t','rate']].drop_duplicates('t').sort_values('t').reset_index(drop=True)

def klines(symbol,start,end):
    try:
        rows=[]; cur=start
        while cur<end:
            x=get_json('/fapi/v1/klines',{'symbol':symbol,'interval':'1h','startTime':cur,'endTime':end-1,'limit':1000})
            if not x: break
            rows.extend(x)
            nxt=int(x[-1][0])+3600000
            if nxt<=cur: break
            cur=nxt
            if len(x)<1000: break
        df=pd.DataFrame(rows,columns=['t','open','high','low','close','volume','closeTime','quoteVolume','trades','tbBase','tbQuote','ignore'])
        for c in ['open','high','low','close','volume']: df[c]=pd.to_numeric(df[c],errors='coerce')
        df['t']=pd.to_datetime(df['t'],unit='ms',utc=True)
        return df[['t','open','high','low','close','volume']].drop_duplicates('t').sort_values('t').reset_index(drop=True)
    except Exception as e:
        print('API_KLINE_FAIL_FALLBACK_VISION',symbol,repr(e))
        return klines_vision(symbol,start,end)

def funding(symbol,start,end):
    try:
        rows=[]; cur=start
        while cur<end:
            x=get_json('/fapi/v1/fundingRate',{'symbol':symbol,'startTime':cur,'endTime':end-1,'limit':1000})
            if not x: break
            rows.extend(x)
            nxt=int(x[-1]['fundingTime'])+1
            if nxt<=cur: break
            cur=nxt
            if len(x)<1000: break
        if not rows: return pd.DataFrame(columns=['t','rate'])
        df=pd.DataFrame(rows)
        df['t']=pd.to_datetime(pd.to_numeric(df['fundingTime']),unit='ms',utc=True)
        df['rate']=pd.to_numeric(df['fundingRate'],errors='coerce').fillna(0.0)
        return df[['t','rate']].drop_duplicates('t').sort_values('t').reset_index(drop=True)
    except Exception as e:
        print('API_FUND_FAIL_FALLBACK_VISION',symbol,repr(e))
        return funding_vision(symbol,start,end)

def rsi_wilder(s,n=14):
    d=s.diff(); up=d.clip(lower=0); dn=(-d.clip(upper=0))
    au=up.ewm(alpha=1/n,adjust=False,min_periods=n).mean()
    ad=dn.ewm(alpha=1/n,adjust=False,min_periods=n).mean()
    rs=au/ad.replace(0,np.nan)
    r=100-100/(1+rs)
    return r.fillna(100)

def prepare(p,b):
    d=p.merge(b[['t','close']].rename(columns={'close':'btc'}),on='t',how='inner')
    d['rsi']=rsi_wilder(d['close'],14)
    d['prev48max']=d['close'].shift(1).rolling(48,min_periods=48).max()
    d['rsiMin24']=d['rsi'].rolling(24,min_periods=24).min()
    d['ret6']=d['close']/d['close'].shift(6)-1
    d['prev6closemax']=d['close'].shift(1).rolling(6,min_periods=6).max()
    d['btc24']=d['btc']/d['btc'].shift(24)-1
    d['p24']=d['close']/d['close'].shift(24)-1
    d['rel24']=d['p24']-d['btc24']
    d['ema72']=d['close'].ewm(span=72,adjust=False,min_periods=72).mean()
    d['ema168']=d['close'].ewm(span=168,adjust=False,min_periods=168).mean()
    d['btcema168']=d['btc']/d['btc'].ewm(span=168,adjust=False,min_periods=168).mean()-1
    prev=d['close'].shift(1); tr=pd.concat([d['high']-d['low'],(d['high']-prev).abs(),(d['low']-prev).abs()],axis=1).max(axis=1)
    d['atr24']=tr.rolling(24,min_periods=24).mean()/d['close']
    recent=d['volume'].rolling(6,min_periods=6).mean()
    prior=d['volume'].shift(6).rolling(36,min_periods=36).mean()
    d['volr']=recent/prior.replace(0,np.nan)
    d['longSig']=(d['close'].shift(1)/d['prev48max']-1<=-.05)&(d['rsiMin24']<=25)&(d['ret6']>=.03)&(d['close']>d['prev6closemax'])&(d['btc24']>=-.06)
    return d.reset_index(drop=True)

def build_short_signals(d):
    sig=np.zeros(len(d),dtype=bool)
    active=False; armed=False; low=None; expiry=-1
    for i,row in d.iterrows():
        if i<80: continue
        if active and i>expiry:
            active=False; armed=False; low=None
        if float(row['p24'])<=-.08:
            if not active:
                active=True; armed=False; low=float(row['low']); expiry=i+30
            else:
                low=min(low,float(row['low']))
                expiry=max(expiry,i+1)
        if active:
            low=min(low,float(row['low']))
            bounce=float(row['close'])/low-1
            if bounce>.07:
                active=False; armed=False; low=None; continue
            if bounce>=.015: armed=True
            if armed:
                cond=(float(row['close'])<float(d.at[i-1,'low']) and float(row['close'])<float(row['ema72']) and float(row['rel24'])<0 and float(row['volr'])>=.5 and float(row['btc24'])<=.04 and float(row['p24'])>=P['sp24'] and float(row['btcema168'])>=P['sbtc'] and float(row['rsi'])>=P['srsi'] and float(row['volr'])<=P['svol'])
                if cond:
                    sig[i]=True; active=False; armed=False; low=None
    return sig

def fund_sum(fund,t0,t1,side,gross):
    x=fund[(fund.t>=t0)&(fund.t<=t1)]
    r=float(x.rate.sum()) if len(x) else 0.0
    return (-gross*r) if side=='L' else (gross*r)

def simulate(d,fund,stress=.0,delay=0):
    ss=build_short_signals(d)
    trades=[]; cooldown_until=-1
    i=250
    while i<len(d)-2:
        if i<=cooldown_until: i+=1; continue
        side=None; sig_i=None
        if ss[i]: side='S'; sig_i=i
        elif bool(d.at[i,'longSig']) and (float(d.at[i,'atr24'])<=P['latr'] or float(d.at[i,'close'])>=float(d.at[i,'ema168'])): side='L'; sig_i=i
        if not side: i+=1; continue
        ei=sig_i+1+delay
        if ei>=len(d): break
        entry=float(d.at[ei,'open']); entry_t=d.at[ei,'t']
        gross=float(np.clip(.75*P['target']/float(d.at[sig_i,'atr24']),P['floor'],.75))
        hold=240 if side=='L' else 96
        hard=entry*(.90 if side=='L' else 1.08)
        best=entry
        exit_px=None; exit_i=None; reason='time'
        last_i=min(len(d)-1,ei+hold-1)
        for j in range(ei,last_i+1):
            hi=float(d.at[j,'high']); lo=float(d.at[j,'low'])
            if side=='L' and lo<=hard:
                exit_px=hard; exit_i=j; reason='hard'; break
            if side=='S' and hi>=hard:
                exit_px=hard; exit_i=j; reason='hard'; break
            fav=(best/entry-1) if side=='L' else (entry/best-1)
            if side=='L' and fav>=.12:
                tr=best*(1-.03)
                if lo<=tr: exit_px=tr; exit_i=j; reason='trail'; break
            if side=='S' and fav>=.10:
                tr=best*(1+.04)
                if hi>=tr: exit_px=tr; exit_i=j; reason='trail'; break
            best=max(best,hi) if side=='L' else min(best,lo)
        if exit_px is None:
            exit_i=last_i; exit_px=float(d.at[exit_i,'close'])
        exit_t=d.at[exit_i,'t']
        raw=(exit_px/entry-1) if side=='L' else (entry/exit_px-1)
        pnl=gross*raw - 2*gross*(FEE+stress) + fund_sum(fund,entry_t,exit_t,side,gross)
        trades.append({'side':side,'signal':str(d.at[sig_i,'t']),'entryTime':str(entry_t),'exitTime':str(exit_t),'entry':entry,'exit':exit_px,'reason':reason,'pnl':pnl,'gross':gross})
        cooldown_until=exit_i+6
        i=exit_i+1
    return trades,metrics(trades)

def metrics(t):
    if not t:return {'trades':0,'ret':0,'pf':0,'dd':0,'win':0,'long':0,'short':0}
    eq=1.; pk=1.; dd=0.; gp=0.; gl=0
    for x in t:
        r=x['pnl']; eq*=1+r; pk=max(pk,eq); dd=min(dd,eq/pk-1)
        if r>0: gp+=r
        else: gl-=r
    return {'trades':len(t),'long':sum(x['side']=='L' for x in t),'short':sum(x['side']=='S' for x in t),'ret':(eq-1)*100,'pf':gp/gl if gl else 999.0,'dd':dd*100,'win':100*sum(x['pnl']>0 for x in t)/len(t)}

def waves(d,trades,start_i=250):
    cand=[]
    for i in range(start_i,len(d)-72,12):
        o=float(d.at[i,'open']); fut=d.iloc[i:i+72]
        up=float(fut.high.max()/o-1); dn=float(1-fut.low.min()/o)
        strength=max(up,dn)
        if strength>=.20: cand.append([i,i+71,'L' if up>=dn else 'S',strength])
    merged=[]
    for c in cand:
        if merged and c[2]==merged[-1][2] and c[0]<=merged[-1][1]:
            merged[-1][1]=max(merged[-1][1],c[1]); merged[-1][3]=max(merged[-1][3],c[3])
        else: merged.append(c)
    details=[]; cap=0; wavep=0.
    for a,b,s,strength in merged:
        wt0=d.at[a,'t']; wt1=d.at[min(b,len(d)-1),'t']
        tt=[x for x in trades if x['side']==s and pd.Timestamp(x['entryTime'])<=wt1 and pd.Timestamp(x['exitTime'])>=wt0]
        pp=sum(x['pnl'] for x in tt)*100
        if tt: cap+=1; wavep+=pp
        details.append({'start':str(wt0),'side':s,'strengthPct':strength*100,'pnlPct':pp,'n':len(tt)})
    return {'waves':len(merged),'captured':cap,'capturePct':100*cap/len(merged) if merged else 0,'wavePnl':wavep,'details':details}

def period_metrics(trades,start,end):
    return metrics([t for t in trades if pd.Timestamp(t['entryTime'])>=start and pd.Timestamp(t['entryTime'])<end])

def main():
    os.makedirs(OUT,exist_ok=True)
    st=ms(START); en=ms(END)
    p=klines('PENGUUSDT',st,en); b=klines('BTCUSDT',st,en); f=funding('PENGUUSDT',st,en)
    print('DATA',len(p),str(p.t.iloc[0]) if len(p) else None,str(p.t.iloc[-1]) if len(p) else None,'FUND',len(f))
    d=prepare(p,b)
    t,m=simulate(d,f,0,0); _,ms35=simulate(d,f,.0035,0); _,md=simulate(d,f,0,1); _,mc=simulate(d,f,.0035,1)
    w=waves(d,t,250)
    first=d.t.iloc[250]; last=d.t.iloc[-1]; span=(last-first)/3
    folds=[]
    for k in range(3):
        a=first+k*span; z=last if k==2 else first+(k+1)*span
        folds.append(period_metrics(t,a,z+pd.Timedelta(hours=1) if k==2 else z))
    result={'source':'Binance USD-M perpetual proxy, frozen current V2, no tuning','params':P,'data':{'rows':len(d),'first':str(d.t.iloc[0]),'last':str(d.t.iloc[-1]),'fundRows':len(f)},'base':m,'stress35bpsSide':ms35,'delay1h':md,'stress35_delay1h':mc,'waves':w,'folds':folds}
    print('RESULT_JSON'); print(json.dumps(result,indent=2))
    with open(os.path.join(OUT,'result.json'),'w') as fh: json.dump(result,fh,indent=2)
    pd.DataFrame(t).to_csv(os.path.join(OUT,'trades.csv'),index=False)
    d.to_csv(os.path.join(OUT,'binance-aligned.csv'),index=False)
if __name__=='__main__': main()
