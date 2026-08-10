import json, os, time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import pandas as pd
import numpy as np

BASE='https://www.okx.com'
START=pd.Timestamp('2024-12-17T00:00:00Z')
END=pd.Timestamp('2026-08-10T00:00:00Z')
OUT='research/pengu-v2-okx-frozen'
FEE=.0006
P={'latr':.0125,'sp24':-.12,'sbtc':-.04,'srsi':30,'svol':3,'target':.02,'floor':.6}

def get(path,params,retries=4):
    url=BASE+path+'?'+urlencode(params); err=None
    for k in range(retries):
        try:
            req=Request(url,headers={'User-Agent':'Mozilla/5.0 PENGU-V2-FrozenResearch'})
            with urlopen(req,timeout=30) as r: x=json.loads(r.read().decode())
            if x.get('code')!='0': raise RuntimeError(x)
            return x.get('data',[])
        except Exception as e:
            err=e; time.sleep(1+k)
    raise RuntimeError(f'GET failed {url}: {err!r}')

def candles(inst):
    rows=[]; cursor=str(int(END.timestamp()*1000)); seen=set()
    for _ in range(200):
        x=get('/api/v5/market/history-candles',{'instId':inst,'bar':'1H','after':cursor,'limit':'100'})
        if not x: break
        for r in x:
            ts=int(r[0])
            if ts in seen: continue
            seen.add(ts); rows.append(r)
        oldest=min(int(r[0]) for r in x)
        if pd.Timestamp(oldest,unit='ms',tz='UTC')<=START: break
        if oldest>=int(cursor): break
        cursor=str(oldest)
        time.sleep(.06)
    if not rows: raise RuntimeError(f'no candles for {inst}')
    df=pd.DataFrame(rows,columns=['ts','open','high','low','close','vol','volCcy','volQuote','confirm'])
    df['t']=pd.to_datetime(pd.to_numeric(df.ts),unit='ms',utc=True)
    for c in ['open','high','low','close','vol']: df[c]=pd.to_numeric(df[c],errors='coerce')
    df=df[(df.t>=START)&(df.t<END)&(df.confirm.astype(str)=='1')]
    return df[['t','open','high','low','close','vol']].rename(columns={'vol':'volume'}).drop_duplicates('t').sort_values('t').reset_index(drop=True)

def rsi(s,n=14):
    d=s.diff(); up=d.clip(lower=0); dn=-d.clip(upper=0)
    au=up.ewm(alpha=1/n,adjust=False,min_periods=n).mean(); ad=dn.ewm(alpha=1/n,adjust=False,min_periods=n).mean()
    return (100-100/(1+au/ad.replace(0,np.nan))).fillna(100)

def prep(p,b):
    d=p.merge(b[['t','close']].rename(columns={'close':'btc'}),on='t',how='inner'); c=d.close
    d['rsi']=rsi(c); d['prev48max']=c.shift(1).rolling(48,min_periods=48).max(); d['rsiMin24']=d.rsi.rolling(24,min_periods=24).min(); d['ret6']=c/c.shift(6)-1; d['prev6closemax']=c.shift(1).rolling(6,min_periods=6).max(); d['btc24']=d.btc/d.btc.shift(24)-1; d['p24']=c/c.shift(24)-1; d['rel24']=d.p24-d.btc24; d['ema72']=c.ewm(span=72,adjust=False,min_periods=72).mean(); d['ema168']=c.ewm(span=168,adjust=False,min_periods=168).mean(); d['btcema168']=d.btc/d.btc.ewm(span=168,adjust=False,min_periods=168).mean()-1
    prev=c.shift(1); tr=pd.concat([d.high-d.low,(d.high-prev).abs(),(d.low-prev).abs()],axis=1).max(axis=1); d['atr24']=tr.rolling(24,min_periods=24).mean()/c
    recent=d.volume.rolling(6,min_periods=6).mean(); prior=d.volume.shift(6).rolling(36,min_periods=36).mean(); d['volr']=recent/prior.replace(0,np.nan)
    d['longSig']=(c.shift(1)/d.prev48max-1<=-.05)&(d.rsiMin24<=25)&(d.ret6>=.03)&(c>d.prev6closemax)&(d.btc24>=-.06)
    return d.reset_index(drop=True)

def short_sigs(d):
    sig=np.zeros(len(d),bool); active=False; armed=False; low=None; expiry=-1
    for i,r in d.iterrows():
        if i<180: continue
        if active and i>expiry: active=False; armed=False; low=None
        if float(r.p24)<=-.08:
            if not active: active=True; armed=False; low=float(r.low); expiry=i+30
            else: low=min(low,float(r.low)); expiry=max(expiry,i+1)
        if active:
            low=min(low,float(r.low)); bounce=float(r.close)/low-1
            if bounce>.07: active=False; armed=False; low=None; continue
            if bounce>=.015: armed=True
            if armed:
                ok=(float(r.close)<float(d.at[i-1,'low']) and float(r.close)<float(r.ema72) and float(r.rel24)<0 and .5<=float(r.volr)<=P['svol'] and float(r.btc24)<=.04 and float(r.p24)>=P['sp24'] and float(r.btcema168)>=P['sbtc'] and float(r.rsi)>=P['srsi'])
                if ok: sig[i]=True; active=False; armed=False; low=None
    return sig

def metrics(t):
    if not t:return {'trades':0,'ret':0,'pf':0,'dd':0,'win':0,'long':0,'short':0}
    eq=1.; pk=1.; dd=0.; gp=0.; gl=0
    for x in t:
        z=x['pnl']; eq*=1+z; pk=max(pk,eq); dd=min(dd,eq/pk-1); gp+=max(z,0); gl+=max(-z,0)
    return {'trades':len(t),'long':sum(x['side']=='L' for x in t),'short':sum(x['side']=='S' for x in t),'ret':(eq-1)*100,'pf':gp/gl if gl else 999.,'dd':dd*100,'win':100*sum(x['pnl']>0 for x in t)/len(t)}

def sim(d,stress=0,delay=0):
    ss=short_sigs(d); t=[]; cd=-1; i=250
    while i<len(d)-2:
        if i<=cd: i+=1; continue
        side='S' if ss[i] else ('L' if bool(d.at[i,'longSig']) and (float(d.at[i,'atr24'])<=P['latr'] or float(d.at[i,'close'])>=float(d.at[i,'ema168'])) else None)
        if not side: i+=1; continue
        ei=i+1+delay
        if ei>=len(d): break
        gross=float(np.clip(.75*P['target']/float(d.at[i,'atr24']),P['floor'],.75)); entry=float(d.at[ei,'open']); hold=240 if side=='L' else 96; hard=entry*(.90 if side=='L' else 1.08); best=entry; ex=None; px=None; reason='time'; last=min(len(d)-1,ei+hold-1)
        for j in range(ei,last+1):
            hi=float(d.at[j,'high']); lo=float(d.at[j,'low'])
            if side=='L' and lo<=hard: ex=j; px=hard; reason='hard'; break
            if side=='S' and hi>=hard: ex=j; px=hard; reason='hard'; break
            fav=(best/entry-1) if side=='L' else (entry/best-1)
            if side=='L' and fav>=.12 and lo<=best*.97: ex=j; px=best*.97; reason='trail'; break
            if side=='S' and fav>=.10 and hi>=best*1.04: ex=j; px=best*1.04; reason='trail'; break
            best=max(best,hi) if side=='L' else min(best,lo)
        if px is None: ex=last; px=float(d.at[ex,'close'])
        raw=px/entry-1 if side=='L' else entry/px-1; pnl=gross*raw-2*gross*(FEE+stress)
        t.append({'side':side,'entryTime':str(d.at[ei,'t']),'exitTime':str(d.at[ex,'t']),'pnl':pnl,'gross':gross,'reason':reason}); cd=ex+6; i=ex+1
    return t

def waves(d,t):
    cand=[]
    for i in range(250,len(d)-72,12):
        o=float(d.at[i,'open']); f=d.iloc[i:i+72]; up=float(f.high.max()/o-1); dn=float(1-f.low.min()/o)
        if max(up,dn)>=.20: cand.append([i,i+71,'L' if up>=dn else 'S',max(up,dn)])
    merged=[]
    for c in cand:
        if merged and c[2]==merged[-1][2] and c[0]<=merged[-1][1]: merged[-1][1]=max(merged[-1][1],c[1]); merged[-1][3]=max(merged[-1][3],c[3])
        else: merged.append(c)
    cap=0; pnl=0
    for a,b,s,_ in merged:
        a=d.at[a,'t']; b=d.at[min(b,len(d)-1),'t']; z=[x for x in t if x['side']==s and pd.Timestamp(x['entryTime'])<=b and pd.Timestamp(x['exitTime'])>=a]
        if z: cap+=1; pnl+=sum(x['pnl'] for x in z)*100
    return {'waves':len(merged),'captured':cap,'capturePct':100*cap/len(merged) if merged else 0,'wavePnl':pnl}

def folds(d,t,n=5):
    lo=d.t.iloc[250]; hi=d.t.iloc[-1]+pd.Timedelta(hours=1); span=(hi-lo)/n; out=[]
    for k in range(n):
        a=lo+k*span; b=hi if k==n-1 else lo+(k+1)*span; out.append(metrics([x for x in t if pd.Timestamp(x['entryTime'])>=a and pd.Timestamp(x['entryTime'])<b]))
    return out

def main():
    os.makedirs(OUT,exist_ok=True)
    p=candles('PENGU-USDT-SWAP'); b=candles('BTC-USDT-SWAP'); d=prep(p,b)
    t=sim(d); s=sim(d,.0035); dl=sim(d,0,1); sd=sim(d,.0035,1)
    r={'source':'OKX USDT perpetual, frozen current V2, no tuning','params':P,'data':{'rows':len(d),'first':str(d.t.iloc[0]),'last':str(d.t.iloc[-1])},'base':metrics(t),'stress35bpsSide':metrics(s),'delay1h':metrics(dl),'stress35_delay1h':metrics(sd),'waves':waves(d,t),'folds':folds(d,t,5)}
    print('RESULT_JSON'); print(json.dumps(r,indent=2)); json.dump(r,open(os.path.join(OUT,'result.json'),'w'),indent=2); pd.DataFrame(t).to_csv(os.path.join(OUT,'trades.csv'),index=False)
if __name__=='__main__': main()
