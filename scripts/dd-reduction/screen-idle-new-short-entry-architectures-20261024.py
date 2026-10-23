#!/usr/bin/env python3
"""Research separate new SHORT entrances for RENDER/DOT/JUP from confirmed M5 candles.
Do NOT confuse independent route metrics with the native dynamic all8 portfolio.
Candidate signal uses only data <= previous HH:55 candle, entry on next HH:00 open;
stop FIRST on mixed-touch M5; no optimizer over cost-specific outcomes.
"""
from __future__ import annotations
import bisect,datetime,importlib.util,json,math,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
M5=300000;H=3600000
START=int(datetime.datetime(2025,8,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
END=int(datetime.datetime(2026,8,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
SPLIT=int(datetime.datetime(2026,2,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
HOLDS={'RENDERUSDT':12,'DOTUSDT':24,'JUPUSDT':12}
COOLDOWN=12
def load(n,path):
 spec=importlib.util.spec_from_file_location(n,path)
 x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x);return x
mod=load('new_idle_entry_native_source',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
def ema(v,n):
 factor=2/(n+1); x=v[0]
 for y in v[1:]:x=factor*y+(1-factor)*x
 return x
def features(bars,barsbtc,i,ib):
 p=float(bars[i][4]);pb=float(barsbtc[ib][4])
 def ret(data,j,k):
  cur=float(data[j][4]);past=float(data[j-k][4])
  return 100*(cur/past-1)
 v1=ret(bars,i,12);v3=ret(bars,i,36);v6=ret(bars,i,72);v12=ret(bars,i,144)
 btc1=ret(barsbtc,ib,12);btc3=ret(barsbtc,ib,36);btc6=ret(barsbtc,ib,72)
 last12=bars[i-11:i+1];last36=bars[i-35:i+1]
 hi=max(float(z[2]) for z in last12);lo=min(float(z[3]) for z in last12)
 vfirst=100*(float(bars[i-6][4])/float(bars[i-12][4])-1)
 vlast=100*(float(bars[i][4])/float(bars[i-6][4])-1)
 v15=100*(float(bars[i][4])/float(bars[i-3][4])-1)
 vol0=sum(float(z[5]) for z in last12)/12
 volp=sum(float(z[5]) for z in bars[i-83:i-11])/72
 atr=sum(100*(float(z[2])-float(z[3]))/float(z[4]) for z in last36)/36
 prices=[float(z[4]) for z in bars[i-96:i+1]]
 return dict(ret1=v1,ret3=v3,ret6=v6,ret12=v12,rel1=v1-btc1,rel3=v3-btc3,
   rel6=v6-btc6,btc1=btc1,btc3=btc3,btc6=btc6,first30=vfirst,last30=vlast,last15=v15,
   volRatio=vol0/volp if volp else None,atr3=atr,rangePos=(p-lo)/(hi-lo) if hi>lo else .5,
   ema12=ema(prices[-48:],12),ema36=ema(prices,36),close=p)
def policies(z):
 a=z['ret1'];b=z['ret3'];c=z['ret6'];d=z['rel3'];e=z['rel6'];btc=z['btc3'];vol=z['volRatio']
 if vol is None:return []
 arr=[]
 if -6<=c<=-0.5 and a>.3 and z['last30']<-.1 and btc>=-1.5:arr.append('BOUNCE_FADE_1')
 if c<=-.5 and z['rangePos']<.45 and z['first30']>.3 and z['last30']<-.15:arr.append('BOUNCE_RANGE_REJECT')
 if -1.5<=btc<=1.5 and d<-.75 and a<-.3 and c>-6 and vol>.85:arr.append('BTC_STABLE_RELWEAK')
 if e<-1.25 and b<-.8 and a<-.2 and btc>=-1.5:arr.append('RELWEAK_DOWNTREND')
 if -5<=c<0 and a<-.6 and vol>1.2 and z['rangePos']<.30 and btc>=-1.5:arr.append('VOLUME_BREAKDOWN_LOW')
 if c<-1 and a<-.2 and z['close']<z['ema12']<z['ema36'] and vol>.95 and btc>=-2:arr.append('EMA_RETEST_FAIL')
 if c<-.7 and d<-.3 and z['last30']<-.2 and z['first30']>0 and .8<vol<1.5:arr.append('LOWVOL_BOUNCE_REJECT')
 if z['btc6']>=-1 and e<=-1 and a<=-.3 and c>=-5:arr.append('BTC_STABLE_REL6_NEG')
 if btc>=-1.5 and b>=-4 and a<=-.2 and c>-5 and z['atr3']<=.7:arr.append('BTC_HEADWIND_AVOID')
 if a>.3 and z['last15']<-.2 and e<-1 and btc>=-1:arr.append('RELATIVE_REJECTION_LAST15')
 if -1<=a<=0 and -4<=c<=0 and z['rangePos']<.3 and btc>=-1:arr.append('LOW_RANGE_CONTINUATION')
 if z['atr3']<.6 and e<0 and z['last30']<-.25 and vol>=1:arr.append('LOW_ATR_RELATIVE_FAIL')
 return arr
def simulate(e,i,hold,cost):
 entryIdx=i+1
 entryPrice=float(e[entryIdx][1])
 assert entryPrice>0
 stop=entryPrice*1.10;target=entryPrice*.75
 finalIdx=min(entryIdx+hold*12,len(e)-1)
 price=float(e[finalIdx][1]);ts=int(e[finalIdx][0])
 reason='TIME_EXIT'
 for j in range(entryIdx,finalIdx):
  op=float(e[j][1]);high=float(e[j][2]);low=float(e[j][3])
  if high>=stop:
   price=max(op,stop);ts=int(e[j][0]);reason='HARD_STOP';break
  if low<=target:
   price=target;ts=int(e[j][0]);reason='TAKE_PROFIT';break
 ret=100*(entryPrice-price)/entryPrice-cost/100
 return {'entryTsMs':int(e[entryIdx][0]),'exitTsMs':ts,'netReturnPct':ret,'exitReason':reason,'entryPrice':entryPrice,'exitPrice':price}
def performance(a):
 if not a:return dict(n=0,wins=0,wrPct=None,pf=None,netReturnSumPct=0)
 wins=[x['netReturnPct'] for x in a if x['netReturnPct']>0]
 losses=[x['netReturnPct'] for x in a if x['netReturnPct']<=0]
 return {'n':len(a),'wins':len(wins),'wrPct':round(100*len(wins)/len(a),2),
  'pf':round(sum(wins)/-sum(losses),4) if sum(losses)<0 else None,
  'netReturnSumPct':round(sum(x['netReturnPct'] for x in a),3)}
def main():
 source,_=mod.native.m.m.core.task8.legacy.bootstrap()
 btc,btct=source.getdata('BTCUSDT')
 out={'status':'INDEPENDENT_ROUTE_SCREEN_ONLY_NO_SHARED_WALLET_NO_LIVE',
   'window':['2025-08-10','2026-08-10'],'signalTemplates':12,
   'cooldownAfterExitHours':COOLDOWN,'costResults':{},'notes':[
    'This compares new entry architectures from all confirmed M5 hourly candles, NOT the 8-strategy dynamic portfolio.',
    'Historical period has been researched repeatedly; later half is a contaminated temporal validation, not untouched OOS.',
    'Uses linear perpetual SHORT PnL (entry-exit)/entry - roundtrip bps; STOP before TP same bar; funding/margin/venue/slippage omitted.']}
 for cost in (10,30):
  allres={}
  for sym,hold in HOLDS.items():
   bars,times=source.getdata(sym)
   candidates={name:[] for name in ('BOUNCE_FADE_1','BOUNCE_RANGE_REJECT','BTC_STABLE_RELWEAK',
    'RELWEAK_DOWNTREND','VOLUME_BREAKDOWN_LOW','EMA_RETEST_FAIL','LOWVOL_BOUNCE_REJECT',
    'BTC_STABLE_REL6_NEG','BTC_HEADWIND_AVOID','RELATIVE_REJECTION_LAST15',
    'LOW_RANGE_CONTINUATION','LOW_ATR_RELATIVE_FAIL')}
   for i in range(301,len(bars)-hold*12-1):
    when=int(times[i])+M5
    if when<START or when>=END or when%H!=0:continue
    if int(times[i+1])!=when or int(times[i-288])!=int(times[i])-288*M5:continue
    ib=bisect.bisect_left(btct,int(times[i]))
    if ib>=len(btct) or int(btct[ib])!=int(times[i]) or ib<288:continue
    if int(btct[ib-288])!=int(btct[ib])-288*M5:continue
    feat=features(bars,btc,i,ib)
    for name in policies(feat):candidates[name].append(i)
   strategies={}
   for name,indices in candidates.items():
    closed=[];occupiedUntil=-1
    for i in indices:
     ts=int(times[i])+M5
     if ts<occupiedUntil:continue
     r=simulate(bars,i,hold,cost)
     closed.append(r)
     occupiedUntil=r['exitTsMs']+COOLDOWN*H
    early=[z for z in closed if z['entryTsMs']<SPLIT]
    late=[z for z in closed if z['entryTsMs']>=SPLIT]
    strategies[name]={'signals':len(indices),'overall':performance(closed),'earlier':performance(early),
                      'later':performance(late),'exitReasons':{k:sum(z['exitReason']==k for z in closed)
                        for k in ('TIME_EXIT','HARD_STOP','TAKE_PROFIT')}}
   allres[sym]={'holdHours':hold,'strategies':strategies}
   ranked=sorted(strategies.items(),key=lambda kv:(kv[1]['earlier']['pf'] or 0,
     kv[1]['overall']['n']),reverse=True)
   print('COST',cost,'SYMBOL',sym,'ARCHITECTURES',len(strategies),flush=True)
   for name,x in ranked[:7]:
    print('  NEW',name,'N',x['overall']['n'],'WR',x['overall']['wrPct'],
      'PF',x['overall']['pf'],'EARLY',x['earlier']['n'],x['earlier']['pf'],
      'LATER',x['later']['n'],x['later']['pf'],flush=True)
  out['costResults'][str(cost)]=allres
 target=REPO/'docs/research/results/idle-entry-three-20261024/IDLE_NEW_SHORT_ENTRY_ARCHITECTURES_M5_SCREEN_20261024.json'
 target.parent.mkdir(parents=True,exist_ok=True)
 target.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('SCREEN_CREATED',target,target.stat().st_size,flush=True)
if __name__=='__main__':main()
