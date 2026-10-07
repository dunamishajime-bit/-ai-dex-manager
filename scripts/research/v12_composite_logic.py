"""Research-only composite V12 router. Fixed thresholds, completed bars only."""
import math
def classify(f):
 if not all(math.isfinite(x) for x in f.values()) or f['atr']<=0:return []
 sg=f['trend'];out=[]
 aligned=sg*f['btc_trend']>0 and sg*f['btc_ret6']>=0 and sg*f['ret12']>0 and sg*f['rel24']>=0 and f['er24']>=.3
 if aligned:
  broken=f['close']>=f['breakout_high']+.1*f['atr'] if sg==1 else f['close']<=f['breakout_low']-.1*f['atr']
  if broken and abs(f['distance'])<=2 and f['volume_ratio']>=1.1:out.append({'route':'BREAKOUT','sg':sg,'strength':abs(f['rel24'])+.01*f['er24']})
  touch=sg*(f['previous_touch']-f['previous_ema12'])<=.25*f['atr']
  shallow=sg*(f['previous_close']-f['previous_ema12'])<=.5*f['atr'] and sg*(f['previous_close']-f['previous_ema48'])>=0
  rebound=f['close']>=f['previous_high']+.05*f['atr'] if sg==1 else f['close']<=f['previous_low']-.05*f['atr']
  if touch and shallow and rebound and abs(f['distance'])<=1.25 and f['volume_ratio']>=.8:out.append({'route':'PULLBACK','sg':sg,'strength':abs(f['rel24'])+.015*f['er24']})
 over=1 if f['previous_distance']>=1.5 and f['previous_rsi']>=65 and f['ret90']>=.0227 else -1 if f['previous_distance']<=-1.5 and f['previous_rsi']<=35 and f['ret90']<=-.0227 else 0
 reverse=-over
 broken=f['close']<=f['previous_low']-.05*f['atr'] if over==1 else f['close']>=f['previous_high']+.05*f['atr']
 if over and broken and f['previous_volume_ratio']>=1.2 and (reverse*f['btc_ret6']>=0 or f['btc_er24']<=.25):
  out.append({'route':'REVERSAL','sg':reverse,'strength':abs(f['previous_distance'])*.01})
 return out
def ema(a,n):
 x=a[0];alpha=2/(n+1)
 for p in a[1:]:x+=alpha*(p-x)
 return x
def er(a,n):
 p=a[-n-1:];return abs(p[-1]-p[0])/max(sum(abs(x-y) for x,y in zip(p,p[1:])),1e-20)
def rsi(a,n=14):
 changes=[x-y for x,y in zip(a[-n:],a[-n-1:-1])];up=sum(max(x,0) for x in changes);down=-sum(min(x,0) for x in changes)
 return 100*up/(up+down) if up+down else 50
def features(bars,btc):
 if len(bars)<121 or len(btc)<121:return None
 ps=[b['close'] for b in bars];bs=[b['close'] for b in btc];cur=bars[-1];prev=bars[-2]
 atr=sum(max(b['high']-b['low'],abs(b['high']-p['close']),abs(b['low']-p['close'])) for b,p in zip(bars[-31:],bars[-32:-1]))/31
 if atr<=0:return None
 e12=ema(ps,12);e48=ema(ps,48);pe12=ema(ps[:-1],12);pe48=ema(ps[:-1],48);sg=1 if e12>e48 else -1
 avg=sum(b['volume'] for b in bars[-21:-1])/20;pavg=sum(b['volume'] for b in bars[-22:-2])/20
 if avg<=0 or pavg<=0:return None
 return dict(trend=sg,btc_trend=1 if ema(bs,12)>ema(bs,48) else -1,btc_ret6=bs[-1]/bs[-4]-1,btc_er24=er(bs,12),ret12=ps[-1]/ps[-7]-1,ret90=ps[-1]/ps[-46]-1,rel24=(ps[-1]/ps[-13]-1)-(bs[-1]/bs[-13]-1),er24=er(ps,12),volume_ratio=cur['volume']/avg,previous_volume_ratio=prev['volume']/pavg,distance=(cur['close']-e12)/atr,previous_distance=(prev['close']-pe12)/atr,previous_rsi=rsi(ps[:-1]),close=cur['close'],previous_high=prev['high'],previous_low=prev['low'],previous_close=prev['close'],previous_ema12=pe12,previous_ema48=pe48,previous_touch=prev['low'] if sg==1 else prev['high'],breakout_high=max(b['high'] for b in bars[-13:-1]),breakout_low=min(b['low'] for b in bars[-13:-1]),atr=atr)
def exit_trade(c,series,no_trail=False,no_momentum=False):
 H=3600000;e=c['entry_price'];atr=c['atr'];sg=1 if c['side']=='LONG' else -1;rev=c['route']=='REVERSAL'
 stop=e-sg*max(atr*(1 if rev else 1.2),e*.005);tp=e+sg*atr*(1.5 if rev else 2.5);arm=1 if rev else 1.5;width=.75 if rev else 1.;peak=e
 start=c['entry_ts_ms'];end=start+c['maxHoldHours']*H
 for t in range(start,end,H):
  b=series.get(t)
  if b is None:return None
  px=None;reason=None
  if (sg==1 and b['low']<=stop) or (sg==-1 and b['high']>=stop):px=min(stop,b['open']) if sg==1 else max(stop,b['open']);reason='COMPOSITE_STOP'
  if px is None and ((sg==1 and b['high']>=tp) or (sg==-1 and b['low']<=tp)):px=tp;reason='COMPOSITE_TAKE_PROFIT'
  if px is None and (t+H)%(2*H)==0:
   nxt=series.get(t+H);prev=series.get(t-H,b);peak=max(peak,b['high'],prev['high']) if sg==1 else min(peak,b['low'],prev['low'])
   if not no_trail and sg*(peak-e)>=arm*atr:
    proposed=max(stop,peak-width*atr,e+.1*atr) if sg==1 else min(stop,peak+width*atr,e-.1*atr)
    if nxt and sg*(nxt['open']-proposed)<=0:px=nxt['open'];reason='COMPOSITE_TRAIL_CROSSED_QUOTE'
    stop=proposed
   prior=series.get(t-4*H)
   if px is None and not no_momentum and t+H-start>=6*H and prior and sg*(b['close']-prior['close'])<=-.5*atr and sg*(b['close']-e)<.25*atr and nxt:px=nxt['open'];reason='COMPOSITE_MOMENTUM_FAILURE'
  if px is not None:return dict(c,exit_ts_ms=t+H,exit_price=px,reason=reason,unit_gross_return=sg*(px/e-1))
 b=series.get(end)
 return dict(c,exit_ts_ms=end,exit_price=b['open'],reason='COMPOSITE_TIME',unit_gross_return=sg*(b['open']/e-1)) if b else None
