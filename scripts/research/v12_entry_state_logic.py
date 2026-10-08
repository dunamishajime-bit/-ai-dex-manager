"""Causal completed-H2 state transitions. Research only."""
import math
H=3600000
def step(state,f,btc_guard=True):
 if not all(math.isfinite(x) for x in f.values()) or f['atr']<=0:return [],None
 now=f['now'];out=[];st=dict(state) if state else None
 if st and (now<=st['armed_at'] or now-st['armed_at']>8*H):st=None
 def allowed(sg):return not btc_guard or sg*f['btc6']>=-.005
 def clv(sg):return f['clv_long'] if sg==1 else f['clv_short']
 def emit(route,sg,stop,setup=None):
  if allowed(sg):out.append(dict(route=route,sg=sg,structural_stop=stop,setup_ts_ms=setup if setup is not None else now,decision_ts_ms=now))
 # Existing setup can resolve only on a LATER completed bar.
 if st:
  sg=st['sg'];level=st['level'];atr=st['atr']
  failure=sg*(f['close']-level)<=-.25*atr and (f['close']<=f['prev_low']-.05*atr if sg==1 else f['close']>=f['prev_high']+.05*atr)
  touch=f['low']<=level+.25*atr if sg==1 else f['high']>=level-.25*atr
  retest=touch and sg*(f['close']-level)>=.1*atr and sg*(f['close']-f['prev_close'])>=.1*atr and clv(sg)>=.6
  if failure and clv(-sg)>=.65:
   stop=max(st['extreme'],f['high'])+.2*atr if sg==1 else min(st['extreme'],f['low'])-.2*atr
   emit('FAILED_BREAK',-sg,stop,st['armed_at']);st=None
  elif retest:
   emit('RETEST',sg,f['low']-.2*atr if sg==1 else f['high']+.2*atr,st['armed_at']);st=None
 # Fresh cross is an event, not a persistent EMA-direction condition.
 sg=f['cross']
 if sg and sg*f['ret6']>0 and sg*f['rel6']>=0 and f['volume_ratio']>=1 and clv(sg)>=.65 and f['body_atr']>=.2:
  emit('FIRST_TURN',sg,f['low']-.2*f['atr'] if sg==1 else f['high']+.2*f['atr'])
 br=1 if f['close']>=f['level_high']+.05*f['atr'] else -1 if f['close']<=f['level_low']-.05*f['atr'] else 0
 if br and f['volume_ratio']>=1.2 and clv(br)>=.65:
  level=f['level_high'] if br==1 else f['level_low']
  # Do not reset unresolved setups on every ongoing breakout.
  if st is None:st=dict(sg=br,level=level,atr=f['atr'],armed_at=now,extreme=f['high'] if br==1 else f['low'])
  if f['compression']<=.8 and f['previous_er']<=.35:
   emit('COMPRESSION',br,f['low']-.2*f['atr'] if br==1 else f['high']+.2*f['atr'])
 return out,st
def exit_trade(c,series,structured=True,hold_override=None):
 e=c['entry_price'];sg=1 if c['side']=='LONG' else -1;atr=c['atr'];t0=c['entry_ts_ms']
 dist=max(sg*(e-c['structural_stop']),e*.005) if structured else max(2.477*atr,e*.005)
 stop=e-sg*dist;tp=e+sg*(2*dist if structured else 3.1995*atr);peak=e
 end=t0+(hold_override or (24 if structured else 46))*H
 for t in range(t0,end,H):
  b=series.get(t)
  if b is None:return None
  px=None;reason=None
  if (sg==1 and b['low']<=stop) or (sg==-1 and b['high']>=stop):px=min(stop,b['open']) if sg==1 else max(stop,b['open']);reason='STATE_STOP'
  if px is None and ((sg==1 and b['high']>=tp) or (sg==-1 and b['low']<=tp)):px=tp;reason='STATE_TP'
  if px is None and (t+H)%(2*H)==0:
   prev=series.get(t-H,b) if t-H>=t0 else b;peak=max(peak,b['high'],prev['high']) if sg==1 else min(peak,b['low'],prev['low']);n=series.get(t+H)
   arm=1.2*dist if structured else 0
   if sg*(peak-e)>=arm:
    width=.75*dist if structured else .2*atr
    proposed=max(stop,peak-width,e+.1*dist) if structured and sg==1 else min(stop,peak+width,e-.1*dist) if structured else max(stop,peak-width) if sg==1 else min(stop,peak+width)
    if n and sg*(n['open']-proposed)<=0:px=n['open'];reason='STATE_TRAIL_CROSSED_QUOTE'
    stop=proposed
  if px is not None:return dict(c,exit_ts_ms=t+H,exit_price=px,reason=reason,unit_gross_return=sg*(px/e-1))
 b=series.get(end)
 return dict(c,exit_ts_ms=end,exit_price=b['open'],reason='STATE_TIME',unit_gross_return=sg*(b['open']/e-1)) if b else None
