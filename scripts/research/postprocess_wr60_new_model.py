"""Postprocess all research cases: normalized payoff, temporal groups, weekly cluster uncertainty."""
from pathlib import Path
import json,collections,datetime,random,math
import run_wr60_new_model as w
def payoff(a):
 ret=[t['total_pnl_jpy']/(t.get('original_quantity',t['quantity'])*t['entry_price']) for t in a]
 wins=[r for r in ret if r>0];losses=[r for r in ret if r<0]
 return dict(w.stats(a),mean_net_return=sum(ret)/len(ret) if ret else None,unit_pf=sum(wins)/-sum(losses) if losses else None,average_win_return=sum(wins)/len(wins) if wins else None,average_loss_return=sum(losses)/len(losses) if losses else None)
def cluster(a,start,end,seed):
 zone=datetime.timezone(datetime.timedelta(hours=9));groups=collections.defaultdict(lambda:[0,0])
 def week(ts):
  d=datetime.datetime.fromtimestamp(ts/1000,zone).date()
  return d-datetime.timedelta(days=d.weekday())
 cursor=week(start);last=week(end-1)
 while cursor<=last:groups[cursor]=[0,0];cursor+=datetime.timedelta(days=7)
 for t in a:
  z=groups[week(t['entry_ts_ms'])];z[0]+=int(t['total_pnl_jpy']>0);z[1]+=1
 blocks=list(groups.values());rng=random.Random(seed);samples=[]
 for _ in range(2000):
  chosen=rng.choices(blocks,k=len(blocks));n=sum(b[1] for b in chosen)
  if n:samples.append(sum(b[0] for b in chosen)/n)
 samples.sort()
 return {'blocks':len(blocks),'resamples':len(samples),'lower_5pct':samples[int(len(samples)*.05)],'upper_95pct':samples[min(len(samples)-1,int(len(samples)*.95))],'method':'Entry JST calendar-week cluster percentile bootstrap; exploratory and not selection-adjusted'}
def main():
 results=json.loads((w.OUT/'comparison-summary.json').read_text());assert len(results)==len(w.VARS)
 for index,c in enumerate(results):
  for sc in c['scenarios']:
   p=w.OUT/'cases'/c['case']/'runs'/sc['scenario_id']/'portfolio-trades.jsonl'
   a=w.base.rows(p if p.exists() else Path(str(p)+'.gz'))
   sc['strategy_stats_usd']={sid:payoff([t for t in a if t['strategy_id']==sid]) for sid in sorted({t['strategy_id'] for t in a})}
   sc['temporal_stats']={}
   mid=sc['period_start_ms']+182*24*w.H
   for label,subset in [('first_half',[t for t in a if t['exit_ts_ms']<mid]),('second_half',[t for t in a if t['entry_ts_ms']>=mid])]:
    sc['temporal_stats'][label]={'portfolio':payoff(subset),'by_strategy':{sid:payoff([t for t in subset if t['strategy_id']==sid]) for sid in sorted({t['strategy_id'] for t in subset})}}
   sc['weekly_cluster_win_rate']=cluster(a,sc['period_start_ms'],sc['period_end_ms'],20261008+index*100+int(sc['round_trip_cost_bps']))
   sc['all_active_sleeves_observed_wr60']=all(x['win_rate']>=.6 for x in sc['strategy_stats_usd'].values())
  (w.OUT/'cases'/c['case']/'result.json').write_text(json.dumps(c,indent=2),encoding='utf-8')
 (w.OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
 print('POSTPROCESS_PASS',len(results)*3)
if __name__=='__main__':main()
