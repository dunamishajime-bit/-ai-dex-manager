"""Research only: no exchange calls, config/state mutation or live certificates."""
import copy, math
H=3600000
def governor_multiplier(losses,ts,side,gross,btc_current3,btc_previous3,window,multiplier):
 if btc_current3 is None or btc_previous3 is None or gross<1: return 1.
 sg=1 if side=='LONG' else -1
 if sg*btc_current3>-.01 or sg*btc_previous3<0: return 1.
 strategies={x['strategy'] for x in losses if ts-window*H<=x['ts']<=ts and x['side']==side and x['pnl']<0 and x['strategy']!='V52'}
 return multiplier if len(strategies)>=2 else 1.
def earlier_exit(candidate,bars,btc,policy):
 c=copy.deepcopy(candidate)
 sid=c['strategy_id'];side=c['side'];entry=int(c['entry_ts_ms']);end=int(c['exit_ts_ms']);price=float(c['entry_price'])
 if policy=='BASELINE' or sid not in {'FET','Q102'}:return c
 if sid=='FET' and not policy.startswith('FET_'):return c
 if sid=='Q102' and not policy.startswith('Q_'):return c
 sg=1 if side=='LONG' else -1
 peak=0.;stop=None
 for ts in range(entry,end,H):
  b=bars.get(ts)
  if b is None:raise ValueError('EXIT_CHAIN_GAP:'+c['symbol']+':'+str(ts))
  # A trailing stop established from PRIOR completed bars is live during this bar.
  if sid=='FET' and policy.startswith('FET_TRAIL') and stop is not None:
   if float(b['open'])<=stop: return changed(c,ts+H,float(b['open']),policy+'_GAP')
   if float(b['low'])<=stop:return changed(c,ts+H,stop,policy+'_STOP')
  now=ts+H
  favorable=sg*(float(b['close'])/price-1)
  peak=max(peak,(float(b['high'])/price-1) if side=='LONG' else (1-float(b['low'])/price))
  if sid=='FET' and policy.startswith('FET_TRAIL'):
   parts=policy.split('_');activation,width=parts[2:4]
   if len(parts)>4 and peak>=float(parts[4].replace('TIGHT',''))/100:width=parts[5]
   if peak>=float(activation)/100:
    stop=max(stop or 0,price*1.03,price*(1+peak)*(1-float(width)/100))
  # Decision consumes a fully completed bar; fill at the next boundary open.
  if now>=end: continue
  nextbar=bars.get(now)
  if nextbar is None:raise ValueError('NEXT_OPEN_MISSING')
  exitflag=False
  prev=bars.get(ts-2*H)
  ret3=None if prev is None else float(b['close'])/float(prev['open'])-1
  if sid=='FET' and policy.startswith('FET_MOM'):
   hours=int(policy.split('_')[-1])
   exitflag=now-entry>=hours*H and peak>=.02 and ret3 is not None and ret3<=0
  elif sid=='Q102':
   fam=str(c.get('family','')).upper()
   if policy.startswith('Q_HV') and fam=='HIGH_VOL' and side=='SHORT':
    threshold=float(policy.split('_')[-1])/100
    exitflag=now-entry>=6*H and ret3 is not None and ret3>=threshold
   elif policy.startswith('Q_REV') and fam=='REV' and side=='SHORT':
    threshold=float(policy.split('_')[-1])/100
    # Peaks for REV use completed CLOSE returns; not unavailable intrabar sequence.
    closepeak=c.get('_research_close_peak',0.)
    closepeak=max(closepeak,favorable);c['_research_close_peak']=closepeak
    exitflag=closepeak>=threshold and favorable<=closepeak*.5
   elif policy.startswith('Q_PB') and fam=='PB' and side=='LONG':
    bb=btc.get(ts);bp=btc.get(ts-2*H)
    br=None if bb is None or bp is None else float(bb['close'])/float(bp['open'])-1
    exitflag=br is not None and br<=-float(policy.split('_')[-1])/100 and favorable<=0
  if exitflag:
   c.pop('_research_close_peak',None)
   return changed(c,now,float(nextbar['open']),policy)
 c.pop('_research_close_peak',None)
 return c
def changed(c,ts,price,reason):
 if ts>int(c['exit_ts_ms']):return c
 c['exit_ts_ms']=ts;c['exit_price']=price;c['exit_reason']=reason
 c['unit_price_return']=(1 if c['side']=='LONG' else -1)*(price/float(c['entry_price'])-1)
 if c.get('partial') and int(c['partial']['ts'])>=ts:c.pop('partial')
 return c
def excursions(c,bars):
 sg=1 if c['side']=='LONG' else -1;ep=float(c['entry_price']);start=int(c['entry_ts_ms']);end=int(c['exit_ts_ms'])
 values=[]
 for ts in range(start,end,H):
  b=bars.get(ts)
  if b is None: return {'coverage':'GAP'}
  values.extend([sg*(float(b['high'])/ep-1),sg*(float(b['low'])/ep-1)])
 final=sg*(float(c['exit_price'])/ep-1)
 return {'coverage':'OK','mfe':max([0.]+values),'mae':min([0.]+values),'final_price_return':final,'giveback':max([0.]+values)-final}
