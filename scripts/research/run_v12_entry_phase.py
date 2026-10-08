"""Prespecified event-based V12 entry phase study; all variants reported."""
import json,collections,math
from pathlib import Path
import run_v12_logic_dissection as s
import v12_composite_logic as f
import v12_entry_state_logic as m
OUT=s.ROOT/'docs/research/results/v12-entry-phase-20261008'
START=1754784000000;END=1786320000000;H=s.H
UNIVERSE=['BTC','ETH','BNB','SOL','LINK','AVAX','DOGE','INJ','XRP','ADA','LTC','ATOM','AAVE','NEAR']
ROUTES=['FIRST_TURN','COMPRESSION','RETEST','FAILED_BREAK']
CASES={'BASELINE_Q_RET14':{},'STATE_ALL_LEGACY_EXIT':{'routes':ROUTES,'structured':False},'STATE_ALL_STRUCT_EXIT':{'routes':ROUTES},**{r+'_STRUCT':{'routes':[r]} for r in ROUTES},'STATE_NO_FIRST_TURN':{'routes':ROUTES[1:]},'STATE_NO_FAILED_BREAK':{'routes':ROUTES[:-1]},'STATE_NO_BTC_STRUCT':{'routes':ROUTES,'no_btc':True}}
POOLS={};ACTIVE={}
def frames(bs,btc):
 ps=[b['close'] for b in bs];bp=[b['close'] for b in btc];c=bs[-1];p=bs[-2]
 tr=[max(b['high']-b['low'],abs(b['high']-q['close']),abs(b['low']-q['close'])) for b,q in zip(bs[1:],bs[:-1])]
 atr=sum(tr[-31:])/31;pa=sum(tr[-32:-1])/31;av=sum(b['volume'] for b in bs[-21:-1])/20
 if min(atr,pa,av)<=0:return None
 diff=f.ema(ps,6)-f.ema(ps,24);pd=f.ema(ps[:-1],6)-f.ema(ps[:-1],24)
 span=max(c['high']-c['low'],1e-20);clv=(c['close']-c['low'])/span
 return dict(now=c['end'],open=c['open'],high=c['high'],low=c['low'],close=c['close'],prev_close=p['close'],prev_high=p['high'],prev_low=p['low'],atr=atr,level_high=max(b['high'] for b in bs[-13:-1]),level_low=min(b['low'] for b in bs[-13:-1]),volume_ratio=c['volume']/av,clv_long=clv,clv_short=1-clv,compression=sum(tr[-7:-1])/6/pa,previous_er=f.er(ps[:-1],12),btc6=bp[-1]/bp[-4]-1,ret6=ps[-1]/ps[-4]-1,rel6=ps[-1]/ps[-4]-bp[-1]/bp[-4],cross=1 if diff>0 and pd<=0 else -1 if diff<0 and pd>=0 else 0,body_atr=abs(c['close']-c['open'])/atr)
def prepare():
 s.w.load_bars();ordered={};maps={}
 for symbol in UNIVERSE:
  sym=symbol+'USDT';raw=s.w.base.rows(s.w.MARKET/f'{sym}.jsonl');hr={}
  for b in raw:
   t=int(b['event_time_ms']);assert t not in hr
   if b.get('closed',True) is not False:hr[t]=b
  a=[]
  for t in sorted(hr):
   if t%(2*H) or t+H not in hr:continue
   x,y=hr[t],hr[t+H]
   a.append(dict(ts=t,end=t+2*H,open=float(x['open']),high=max(float(x['high']),float(y['high'])),low=min(float(x['low']),float(y['low'])),close=float(y['close']),volume=float(x['base_volume'])+float(y['base_volume'])))
  ordered[sym]=a;maps[sym]={b['end']:i for i,b in enumerate(a)}
 pools={False:[],True:[]};states={(sym,g):None for sym in ordered for g in pools}
 for now in range(START-240*H,END,2*H):
  bi=maps['BTCUSDT'].get(now)
  if bi is None or bi<120:continue
  btc=ordered['BTCUSDT'][bi-120:bi+1]
  if any(btc[j]['ts']-btc[j-1]['ts']!=2*H for j in range(1,121)):
   for k in states:states[k]=None
   continue
  for sym,arr in ordered.items():
   i=maps[sym].get(now);bar=s.w.bars[sym].get(now)
   if i is None or i<120 or not bar:
    for g in pools:states[sym,g]=None
    continue
   bs=arr[i-120:i+1]
   if any(bs[j]['ts']-bs[j-1]['ts']!=2*H for j in range(1,121)):
    for g in pools:states[sym,g]=None
    continue
   x=frames(bs,btc)
   if x is None:continue
   for no_btc in pools:
    emitted,states[sym,no_btc]=m.step(states[sym,no_btc],x,not no_btc)
    if now<START:continue
    for e in emitted:
     dist=e['sg']*(bar['open']-e['structural_stop'])
     if dist<=0 or dist>2.5*x['atr']:continue
     c=dict(e,symbol=sym,side='LONG' if e['sg']==1 else 'SHORT',entry_ts_ms=now,entry_price=bar['open'],atr=x['atr'],features=x,score=x['volume_ratio']*(x['clv_long'] if e['sg']==1 else x['clv_short'])/(max(dist,bar['open']*.005)/x['atr']),signal_ts_ms=now,entryQualityClass='STATE_EVENT')
     pools[no_btc].append(c)
 for no_btc,a in pools.items():
  (OUT/('state-pool-no-btc.jsonl' if no_btc else 'state-pool.jsonl')).write_text(''.join(json.dumps(c,sort_keys=True)+'\n' for c in a))
  print('POOL',no_btc,dict(collections.Counter(c['route'] for c in a)),flush=True)
 return pools,ordered,maps
def diagnostic(ordered,maps):
 a=s.rows(s.OUT/'source-candidates/BASELINE.jsonl');ref={s.w.base.key(c):c for c in s.w.frozen_read('V12')};out=[]
 for c in a:
  sym=c['symbol'];t=c['entry_ts_ms'];sg=1 if c['side']=='LONG' else -1;i=maps[sym].get(t)
  if i is None or i<120:continue
  bs=ordered[sym][i-120:i+1];ps=[b['close'] for b in bs];atr=c['atr'];age=0
  for j in range(i,max(44,i-48),-1):
   arr=ordered[sym]
   if sg*(arr[j]['close']/arr[j-45]['close']-1)<.0227:break
   age+=2
  ret6=sg*(ps[-1]/ps[-4]-1);distance=sg*(ps[-1]-f.ema(ps,12))/atr
  phase='TURNING' if ret6<0 and sg*(ps[-1]-f.ema(ps,6))<0 else 'LATE' if age>=24 or distance>2 else 'EARLY' if age<=6 and ret6>0 else 'CONTINUING'
  x=ref[s.w.base.key(c)]
  d=dict(symbol=sym,side=c['side'],entry_ts_ms=t,phase=phase,momentum_condition_age_h=age,distance_ema12_atr=distance,signed_ret6=ret6,exit_net10=x['unit_gross_return']-.001,timeline={})
  for h in [-48,-24,-12,-6,-2,2,6,12,24]:
   b=s.w.bars[sym].get(t+h*H);d['timeline'][str(h)]=sg*(b['open']/c['entry_price']-1) if b else None
  out.append(d)
 (OUT/'entry-phase-diagnostic.jsonl').write_text(''.join(json.dumps(d,sort_keys=True)+'\n' for d in out))
 groups={}
 for phase in ['EARLY','CONTINUING','LATE','TURNING']:
  a=[d for d in out if d['phase']==phase]
  groups[phase]={'exit10':s.stat([d['exit_net10'] for d in a]),'by_side':{side:s.stat([d['exit_net10'] for d in a if d['side']==side]) for side in ['LONG','SHORT']},'timeline':{str(h):s.stat([d['timeline'][str(h)] for d in a if d['timeline'][str(h)] is not None]) for h in [-48,-24,-12,-6,-2,2,6,12,24]}}
 (OUT/'entry-phase-summary.json').write_text(json.dumps({'raw_candidates_not_independent_trades':True,'age_definition':'consecutive completed H2 signed90h return>=2.27%, capped96h; not full gate age','timeline_offline_diagnostic_only':True,'groups':groups},indent=2))
def select(pool,p):
 groups=collections.defaultdict(list)
 for c in pool:
  if c['route'] in p['routes']:groups[c['entry_ts_ms']].append(c)
 out=[]
 for ts,cs in sorted(groups.items()):
  cs.sort(key=lambda c:(-c['score'],ROUTES.index(c['route']),c['symbol']));seen=set();unique=[]
  for c in cs:
   if c['symbol'] in seen:continue
   seen.add(c['symbol']);unique.append(c)
  for rank,c in enumerate(unique[:3],1):
   if rank==3 and c['score']<.7:continue
   sg=c['sg'];e=c['entry_price'];dist=max(sg*(e-c['structural_stop']) if p.get('structured',True) else 2.477*c['atr'],e*.005)
   gross=min(1.,.0319/(dist/e));gross=min(.1,gross) if rank==3 else gross
   out.append(dict(c,rank=rank,requested_gross=gross))
 return out
def filt(candidates,name):
 if name=='BASELINE_Q_RET14':return candidates
 out=[c for c in candidates if c['strategy_id']!='V12']
 for c in select(POOLS[ACTIVE.get('no_btc',False)],ACTIVE):
  x=m.exit_trade(c,s.w.bars[c['symbol']],ACTIVE.get('structured',True))
  if x is None:continue
  d=s.w.base.candidate(x,'V12');d.update(route=c['route'],entryQualityClass='STATE_EVENT',state_features=c['features'],setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],structural_stop=c['structural_stop']);out.append(d)
 return out
def main():
 global POOLS,ACTIVE
 OUT.mkdir(parents=True,exist_ok=True)
 protocol={'cases':CASES,'frozen_before_bt':True,'period':'2025-08-10 through 2026-08-10 UTC; prior explored period, not untouched holdout','features':'closed H2; EMA6/24 cross, ATR31, prior12 range, prior20 volume, prior6 TR mean / prior31ATR compression, prior12 ER, signed BTC6>=-0.5%; warm state240h','entry':'event confirmation then next H1 open; no retrospective entry. State expires8h. Wrongside structural stop or >2.5ATR rejected. All cases reported, no parameter grid.','exit':'legacy46h stop2.477ATR TP3.1995ATR trail0.2ATR; structure24h stop event extreme+0.2ATR, min0.5%price, TP2R arm1.2R trail0.75R floor0.1R; stop-first ambiguous bar; crossed replacement uses actual next open','size':'existing3.19%risk, grosscap1, rank3cap0.1. Fixed nonV12 streams incl Q RET14. Global exposure, ownership, cooldown, fees/funding and FX unchanged','adoption':'each of all/first/second >=50 trades, netUSD>0, unitmean>0, PF>=1.1 at10/20/30bps, withoutbest net>0','live_changes':False}
 (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2))
 POOLS,ordered,maps=prepare();diagnostic(ordered,maps);s.w.OUT=OUT;s.w.setup();s.w.base.read_table=s.w.frozen_read;s.w.base._study_filter=filt
 for name,p in CASES.items():
  ACTIVE=p;print('START',name,flush=True);r=s.w.base.run_study(name,'10,20,30');r['research_only']=True
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[t for t in ts if t['strategy_id']=='V12']
   def stats(a):
    d=s.w.stats(a);d['unit_returns']=s.stat([t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a]);d['net_without_best_usd']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0);return d
   sc['v12_details']={'all':stats(v),'first':stats([t for t in v if t['exit_ts_ms']<s.MID]),'second':stats([t for t in v if t['entry_ts_ms']>=s.MID]),'routes':{route:stats([t for t in v if t.get('route')==route]) for route in ROUTES}}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2));(OUT/'comparison-summary.json').write_text(json.dumps([json.loads(p.read_text()) for p in sorted((OUT/'cases').glob('*/result.json'))],indent=2));print('DONE',name,flush=True)
if __name__=='__main__':main()
