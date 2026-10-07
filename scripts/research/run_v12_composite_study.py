"""Prespecified multi-route V12 architecture with component-removal ablations."""
import json,sys,collections,math
from pathlib import Path
import run_v12_logic_dissection as s
import v12_composite_logic as m
OUT=s.OUT;POOL=[];ACTIVE={}
ROUTES={'BREAKOUT','PULLBACK','REVERSAL'}
CASES={'COMP_ALL':{'routes':sorted(ROUTES)},'COMP_TREND_ONLY':{'routes':['BREAKOUT','PULLBACK']},'COMP_REV_ONLY':{'routes':['REVERSAL']},'COMP_NO_BREAKOUT':{'routes':['PULLBACK','REVERSAL']},'COMP_NO_PULLBACK':{'routes':['BREAKOUT','REVERSAL']},'COMP_NO_MOM_EXIT':{'routes':sorted(ROUTES),'no_momentum':True},'COMP_NO_TRAIL':{'routes':sorted(ROUTES),'no_trail':True}}
UNIVERSE=['BTC','ETH','BNB','SOL','LINK','AVAX','DOGE','INJ','XRP','ADA','LTC','ATOM','AAVE','NEAR']
def prepare():
 global POOL
 s.initialize();maps={};ordered={}
 for symbol in UNIVERSE:
  sym=symbol+'USDT';raw=s.w.base.rows(s.w.MARKET/f'{sym}.jsonl');hr={int(b['event_time_ms']):b for b in raw};h2=[]
  for t in sorted(hr):
   if t%(2*s.H) or t+s.H not in hr:continue
   x=hr[t];y=hr[t+s.H]
   h2.append(dict(ts=t,end=t+2*s.H,open=float(x['open']),high=max(float(x['high']),float(y['high'])),low=min(float(x['low']),float(y['low'])),close=float(y['close']),volume=float(x['base_volume'])+float(y['base_volume'])))
  maps[sym]={b['end']:i for i,b in enumerate(h2)};ordered[sym]=h2
 POOL=[]
 for now in range(1754784000000,1786320000000,2*s.H):
  bi=maps['BTCUSDT'].get(now)
  if bi is None or bi<120:continue
  btc=ordered['BTCUSDT'][bi-120:bi+1]
  if any(btc[i]['ts']-btc[i-1]['ts']!=2*s.H for i in range(1,121)):continue
  for symbol in UNIVERSE:
   sym=symbol+'USDT';i=maps[sym].get(now);bar=s.w.bars[sym].get(now)
   if i is None or i<120 or not bar:continue
   bs=ordered[sym][i-120:i+1]
   if any(bs[j]['ts']-bs[j-1]['ts']!=2*s.H for j in range(1,121)):continue
   f=m.features(bs,btc)
   if f is None:continue
   for route in m.classify(f):
    rev=route['route']=='REVERSAL';dist=max(f['atr']*(1 if rev else 1.2),bar['open']*.005)
    c=dict(symbol=sym,side='LONG' if route['sg']==1 else 'SHORT',entry_ts_ms=now,entry_price=bar['open'],atr=f['atr'],route=route['route'],score=route['strength']/(f['atr']/bar['open']),maxHoldHours=18 if rev else 36,requested_gross=min(1.,.0319/(dist/bar['open'])),features=f,signal_ts_ms=now,entryQualityClass='COMPOSITE')
    POOL.append(c)
 (OUT/'composite-route-pool.jsonl').write_text(''.join(json.dumps(c,sort_keys=True)+'\n' for c in POOL))
 print('COMPOSITE_POOL',dict(collections.Counter(c['route'] for c in POOL)),flush=True)
def select(pool,p):
 groups=collections.defaultdict(list)
 for c in pool:
  if c['route'] in p['routes']:groups[c['entry_ts_ms']].append(c)
 out=[]
 for ts,cs in sorted(groups.items()):
  # Rerank and refill from all eligible route candidates for each ablation.
  cs.sort(key=lambda c:(-c['score'],{'PULLBACK':0,'BREAKOUT':1,'REVERSAL':2}[c['route']],c['symbol']))
  unique=[];seen=set()
  for c in cs:
   if c['symbol'] in seen:continue
   seen.add(c['symbol']);unique.append(c)
  for rank,c in enumerate(unique[:3],1):
   if rank==3 and c['score']<.7:continue
   out.append(dict(c,rank=rank,requested_gross=min(.1,c['requested_gross']) if rank==3 else c['requested_gross']))
 return out
def filt(candidates,name):
 out=[c for c in candidates if c['strategy_id']!='V12']
 for c in select(POOL,ACTIVE):
  x=m.exit_trade(c,s.w.bars[c['symbol']],ACTIVE.get('no_trail',False),ACTIVE.get('no_momentum',False))
  if x is None:continue
  d=s.w.base.candidate(x,'V12');d.update(route=c['route'],entryQualityClass='COMPOSITE',composite_features=c['features']);out.append(d)
 return out
def main():
 global ACTIVE
 protocol={'purpose':'V12 itself positive net expectancy and realized PnL; no trade-count target; combine state/direction, relative strength, volume, structural entry and route-specific exit','cases':CASES,'parameters_frozen_before_bt':True,'tuning':'one fixed architecture; no grid search or best-case selection. All ablations reported. Period was previously explored; not independent holdout.','feature_windows':'H2 completed, EMA12/48, BTC ret6h+ER24h, symbol ret12h+rel24h, volume20bars, ATR31bars, RSI14 simple gain/loss','route_rules':'See classify() source; trend continuation and confirmed pullback, climax/structure-confirmed reversal','exit_rules':'Trend stop1.2ATR TP2.5ATR hold36h arm1.5ATR trail1ATR; reversal stop1ATR TP1.5ATR hold18h arm1ATR trail0.75ATR. minstop0.5%; H2 adverse4h acceleration after6h+lowprofit exits next quote. Stop-first ambiguous H1. Armed trail floor0.1ATR requires actual next quote.','sizing':'Frozen existing risk budget3.19%; recompute from new stop. cap1x, rank3cap0.1x; no HC1.75 boost. Shared ownership/gross/cooldowns/fees/funding reused. Different signal architecture, not a production-parity claim.','limits':['H1 quote proxy not historical tick fills','Changing V12 streams interacts with fixed other-strategy candidates','No historic pending/margin replay','No LIVE changes']}
 (OUT/'composite-protocol.json').write_text(json.dumps(protocol,indent=2))
 prepare();s.w.setup();s.w.base.read_table=s.read_table;s.w.base._study_filter=filt
 for name,p in CASES.items():
  ACTIVE=p;print('COMPOSITE_START',name,flush=True);r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['composite_parameters']=p
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[t for t in ts if t['strategy_id']=='V12']
   def stats(a):
    d=s.w.stats(a);d['unit_returns']=s.stat([t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a]);d['net_without_best_usd']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0);return d
   sc['v12_details']={'all':stats(v),'first':stats([t for t in v if t['exit_ts_ms']<s.MID]),'second':stats([t for t in v if t['entry_ts_ms']>=s.MID]),'routes':{route:stats([t for t in v if t.get('route')==route]) for route in ROUTES}}
   sc['strategy_stats_usd']={sid:s.w.stats([t for t in ts if t['strategy_id']==sid]) for sid in sorted({t['strategy_id'] for t in ts})}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2))
  (OUT/'comparison-summary.json').write_text(json.dumps([json.loads(p.read_text()) for p in sorted((OUT/'cases').glob('*/result.json'))],indent=2))
  print('COMPOSITE_DONE',name,flush=True)
if __name__=='__main__':main()
