"""Direction-architecture probes; same original signal clock, no hindsight filters."""
import sys,json,collections,random,math,copy
import run_v12_logic_dissection as s
def main():
 s.initialize();a=s.TABLES['BASELINE'];out=[]
 for mode in ['FOLLOW','REVERSE']:
  vals=[]
  for c in a:
   side=c['side'] if mode=='FOLLOW' else ('SHORT' if c['side']=='LONG' else 'LONG')
   d=dict(c,side=side,maxHoldHours=24)
   try:x=s.simulate(d,'NO_TRAIL')
   except ValueError:continue
   vals.append(x)
  out.append({'mode':mode,'scope':'Architecture counterfactual only: original clock/symbol/gross; opposite-direction probe does not enforce original BTC/HC direction gates and cannot be deployed directly. Protective stop/TP, no immediate trailing, max hold24h.','first':{str(k):s.stat([c['unit_gross_return']-k/10000 for c in vals if c['exit_ts_ms']<s.MID]) for k in [10,20,30]},'second':{str(k):s.stat([c['unit_gross_return']-k/10000 for c in vals if c['entry_ts_ms']>=s.MID]) for k in [10,20,30]}})
 (s.OUT/'direction-architecture-probe.json').write_text(json.dumps(out,indent=2))
 print(json.dumps(out,indent=2))
 # Accepted V12 ledger loss decomposition and descriptive weekly intervals.
 ts=s.rows(s.w.PRIOR/'cases/Q_RET14_DELTA/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl');v=[x for x in ts if x['strategy_id']=='V12']
 r=[x['total_pnl_jpy']/(x['original_quantity']*x['entry_price']) for x in v];pos=[x for x in r if x>0];neg=[x for x in r if x<0]
 d={'accepted_trades':len(v),'win_rate':len(pos)/len(v),'avg_win':sum(pos)/len(pos),'avg_loss':sum(neg)/len(neg),'price_usd':sum(x['price_pnl'] for x in v),'funding_usd':sum(x['funding_pnl'] for x in v),'net_usd':sum(x['total_pnl_jpy'] for x in v),'price_positive_but_net_negative':sum(x['price_pnl']>0 and x['total_pnl_jpy']<=0 for x in v)}
 d['fees_usd']=d['price_usd']+d['funding_usd']-d['net_usd']
 d['break_even_win_rate']=-d['avg_loss']/(d['avg_win']-d['avg_loss'])
 d['quarters']={}
 START=1754784000000
 for q in range(4):
  lo=START+q*91*24*s.H;hi=START+(q+1)*91*24*s.H if q<3 else START+365*24*s.H
  xs=[x for x in v if lo<=x['entry_ts_ms']<hi];d['quarters'][str(q+1)]={'usd':s.w.stats(xs),'unit':s.stat([x['total_pnl_jpy']/(x['original_quantity']*x['entry_price']) for x in xs])}
 (s.OUT/'accepted-loss-decomposition.json').write_text(json.dumps(d,indent=2));print('LOSS_DECOMPOSITION',json.dumps(d))
if __name__=='__main__':main()
