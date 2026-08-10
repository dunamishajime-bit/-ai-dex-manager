import json,time,os
from urllib.request import Request,urlopen
from urllib.parse import urlencode
import pandas as pd,numpy as np

BASE='https://api.gateio.ws/api/v4'
WARM=pd.Timestamp('2025-07-20T00:00:00Z');EVAL_START=pd.Timestamp('2025-08-10T00:00:00Z');EVAL_END=pd.Timestamp('2026-08-10T00:00:00Z')
OUT='research/pengu-v2-final-gate-frozen';FEE=.0006
SHORT=dict(impulse=-.07,expiry=24,bounce_min=.0125,bounce_max=.06,p24_floor=-.12,btcema_floor=-.04,rsi_min=30,vol_min=.25,vol_max=3,rel_max=-.02,btc24_max=.04)
LONG=dict(look=18,p24_min=.10,rel_min=.01,btc24_min=0.,rsi_min=48,rsi_max=78,vol_min=.25,vol_max=3,atr_max=.05)
EXIT=dict(short_hold=72,short_hard=.08,short_trig=.15,short_trail=.04,long_hold=120,long_hard=.08,long_trig=.10,long_trail=.03,cooldown=6)
RISK=dict(target=.02,gross_floor=.60,gross_cap=.75)

def get(path,params,retries=5):
    u=BASE+path+'?'+urlencode(params);err=None
    for k in range(retries):
        try:
            with urlopen(Request(u,headers={'Accept':'application/json','User-Agent':'PENGU-V2-FinalFrozen'}),timeout=30) as r:return json.loads(r.read().decode())
        except Exception as e:err=e;time.sleep(1+k)
    raise RuntimeError(f'{u} {err!r}')

def klines(contract,start,end):
    rows=[];cur=int(start.timestamp());end_s=int(end.timestamp());step=1900*3600
    while cur<end_s:
        to=min(end_s-1,cur+step-1)
        x=get('/futures/usdt/candlesticks',{'contract':contract,'from':cur,'to':to,'interval':'1h','timezone':'utc0'})
        if isinstance(x,dict) and x.get('label'): raise RuntimeError(x)
        rows.extend(x or []);cur=to+1;time.sleep(.04)
    if not rows:return pd.DataFrame()
    d=pd.DataFrame(rows);d['t']=pd.to_datetime(pd.to_numeric(d['t']),unit='s',utc=True)
    for c,k in [('open','o'),('high','h'),('low','l'),('close','c'),('volume','v')]: d[c]=pd.to_numeric(d[k],errors='coerce')
    return d[(d.t>=start)&(d.t<end)][['t','open','high','low','close','volume']].drop_duplicates('t').sort_values('t').reset_index(drop=True)

def rsi(s,n=14):
    d=s.diff();up=d.clip(lower=0);dn=-d.clip(upper=0);au=up.ewm(alpha=1/n,adjust=False,min_periods=n).mean();ad=dn.ewm(alpha=1/n,adjust=False,min_periods=n).mean();return (100-100/(1+au/ad.replace(0,np.nan))).fillna(100)
def prep(p,b):
    d=p.merge(b[['t','close']].rename(columns={'close':'btc'}),on='t',how='inner');c=d.close
    d['rsi']=rsi(c);d['btc24']=d.btc/d.btc.shift(24)-1;d['p24']=c/c.shift(24)-1;d['rel24']=d.p24-d.btc24
    d['ema72']=c.ewm(span=72,adjust=False,min_periods=72).mean();d['ema168']=c.ewm(span=168,adjust=False,min_periods=168).mean();d['btcema168']=d.btc/d.btc.ewm(span=168,adjust=False,min_periods=168).mean()-1
    d['volr']=d.volume.rolling(6,min_periods=6).mean()/d.volume.shift(6).rolling(36,min_periods=36).mean().replace(0,np.nan)
    prev=c.shift(1);tr=pd.concat([d.high-d.low,(d.high-prev).abs(),(d.low-prev).abs()],axis=1).max(axis=1);d['atr24']=tr.rolling(24,min_periods=24).mean()/c
    d['hi18']=d.high.shift(1).rolling(18,min_periods=18).max();return d.reset_index(drop=True)
def short_sig(d):
    s=SHORT;sig=np.zeros(len(d),bool);active=False;armed=False;lowv=0.;expiry=-1
    for i in range(180,len(d)):
        if active and i>expiry:active=False;armed=False;lowv=0.
        if np.isfinite(d.p24.iat[i]) and d.p24.iat[i]<=s['impulse']:
            if not active:active=True;armed=False;lowv=float(d.low.iat[i]);expiry=i+s['expiry']
            else:lowv=min(lowv,float(d.low.iat[i]));expiry=max(expiry,i+1)
        if active:
            lowv=min(lowv,float(d.low.iat[i]));bounce=float(d.close.iat[i])/lowv-1
            if bounce>s['bounce_max']:active=False;armed=False;lowv=0.;continue
            if bounce>=s['bounce_min']:armed=True
            if armed:
                ok=(d.close.iat[i]<d.low.iat[i-1] and d.close.iat[i]<d.ema72.iat[i] and d.ema72.iat[i]<d.ema168.iat[i] and d.rel24.iat[i]<=s['rel_max'] and s['vol_min']<=d.volr.iat[i]<=s['vol_max'] and d.btc24.iat[i]<=s['btc24_max'] and d.p24.iat[i]>=s['p24_floor'] and d.btcema168.iat[i]>=s['btcema_floor'] and d.rsi.iat[i]>=s['rsi_min'])
                if ok:sig[i]=True;active=False;armed=False;lowv=0.
    return sig
def long_sig(d):
    s=LONG;x=(d.close>d.hi18)&(d.p24>=s['p24_min'])&(d.rel24>=s['rel_min'])&(d.btc24>=s['btc24_min'])&(d.rsi>=s['rsi_min'])&(d.rsi<=s['rsi_max'])&(d.volr>=s['vol_min'])&(d.volr<=s['vol_max'])&(d.atr24<=s['atr_max'])&(d.close>d.ema168)
    return (x&~x.shift(1,fill_value=False)).to_numpy(bool)
def sim(d,stress=0.,delay=0):
    ss=short_sig(d);ls=long_sig(d);tr=[];i=250;cd=-1
    while i<len(d)-2:
        if i<=cd:i+=1;continue
        side='S' if ss[i] else ('L' if ls[i] else None)
        if not side:i+=1;continue
        ei=i+1+delay
        if ei>=len(d):break
        et=d.t.iat[ei];entry=float(d.open.iat[ei]);gross=float(np.clip(.75*RISK['target']/float(d.atr24.iat[i]),RISK['gross_floor'],RISK['gross_cap']))
        if side=='S':hold=EXIT['short_hold'];hard=entry*(1+EXIT['short_hard']);trig=EXIT['short_trig'];trail=EXIT['short_trail']
        else:hold=EXIT['long_hold'];hard=entry*(1-EXIT['long_hard']);trig=EXIT['long_trig'];trail=EXIT['long_trail']
        best=entry;last=min(len(d)-1,ei+hold-1);px=None;ex=None;reason='time'
        for j in range(ei,last+1):
            hi=float(d.high.iat[j]);lo=float(d.low.iat[j])
            if side=='L' and lo<=hard:px=hard;ex=j;reason='hard';break
            if side=='S' and hi>=hard:px=hard;ex=j;reason='hard';break
            fav=best/entry-1 if side=='L' else entry/best-1
            if side=='L' and fav>=trig and lo<=best*(1-trail):px=best*(1-trail);ex=j;reason='trail';break
            if side=='S' and fav>=trig and hi>=best*(1+trail):px=best*(1+trail);ex=j;reason='trail';break
            best=max(best,hi) if side=='L' else min(best,lo)
        if px is None:ex=last;px=float(d.close.iat[ex])
        raw=px/entry-1 if side=='L' else entry/px-1;pnl=gross*raw-2*gross*(FEE+stress)
        if EVAL_START<=et<EVAL_END:tr.append({'side':side,'entryTime':str(et),'exitTime':str(d.t.iat[ex]),'pnl':pnl,'gross':gross,'reason':reason})
        cd=ex+EXIT['cooldown'];i=ex+1
    return tr
def met(t):
    if not t:return dict(trades=0,ret=0,pf=0,dd=0,win=0,long=0,short=0)
    v=np.array([x['pnl'] for x in t]);e=np.cumprod(1+v);pk=np.maximum.accumulate(e);gp=v[v>0].sum();gl=-v[v<0].sum();return dict(trades=len(v),long=sum(x['side']=='L' for x in t),short=sum(x['side']=='S' for x in t),ret=float((e[-1]-1)*100),pf=float(gp/gl if gl else 999),dd=float(np.min(e/pk-1)*100),win=float((v>0).mean()*100))
def waves(d,t):
    cand=[]
    for i in range(250,len(d)-72,12):
        if not(EVAL_START<=d.t.iat[i]<EVAL_END):continue
        o=float(d.open.iat[i]);f=d.iloc[i:i+72];up=float(f.high.max()/o-1);dn=float(1-f.low.min()/o)
        if max(up,dn)>=.20:cand.append([d.t.iat[i],d.t.iat[i+71],'L' if up>=dn else 'S',max(up,dn)])
    m=[]
    for c in cand:
        if m and c[2]==m[-1][2] and c[0]<=m[-1][1]:m[-1][1]=max(m[-1][1],c[1]);m[-1][3]=max(m[-1][3],c[3])
        else:m.append(c)
    cap=0;pn=0.
    for a,b,s,_ in m:
        z=[x for x in t if x['side']==s and pd.Timestamp(x['entryTime'])<=b and pd.Timestamp(x['exitTime'])>=a]
        if z:cap+=1;pn+=sum(x['pnl'] for x in z)*100
    return dict(waves=len(m),captured=cap,capturePct=100*cap/len(m) if m else 0,wavePnl=pn)
def folds(t,n=4):
    span=(EVAL_END-EVAL_START)/n;out=[]
    for k in range(n):
        a=EVAL_START+k*span;b=EVAL_END if k==n-1 else EVAL_START+(k+1)*span;out.append({'start':str(a),'end':str(b),**met([x for x in t if a<=pd.Timestamp(x['entryTime'])<b])})
    return out
def main():
    os.makedirs(OUT,exist_ok=True);p=klines('PENGU_USDT',WARM,EVAL_END);b=klines('BTC_USDT',WARM,EVAL_END)
    if len(p)==0 or len(b)==0:raise RuntimeError('Gate returned no candles')
    d=prep(p,b);base=sim(d);res={'strategy':'PENGU_DUAL_LS_V2_FINAL_FROZEN','source':'Gate USDT perpetual untouched external validation','eval':{'start':str(EVAL_START),'endExclusive':str(EVAL_END)},'short':SHORT,'long':LONG,'exit':EXIT,'risk':RISK,'data':{'rows':len(d),'first':str(d.t.iloc[0]),'last':str(d.t.iloc[-1])},'base':met(base),'stress35bpsSide':met(sim(d,.0035)),'delay1h':met(sim(d,0,1)),'stress35_delay1h':met(sim(d,.0035,1)),'waves':waves(d,base),'folds':folds(base,4)};print('RESULT_JSON');print(json.dumps(res,indent=2));json.dump(res,open(OUT+'/result.json','w'),indent=2);pd.DataFrame(base).to_csv(OUT+'/trades.csv',index=False)
if __name__=='__main__':main()
