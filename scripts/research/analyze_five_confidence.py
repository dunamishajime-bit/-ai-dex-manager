"""Entry-known confidence classification with a chronological held-out half."""
import pathlib,sys,json,gzip,math,statistics,collections
from run_five_improvements import BASE,OUT,DATA,ROOT,readrows,bars,H
from five_improvement_policies import excursions
MID=1754784000000+int(365/2*24*H)
def metrics(rs):
 pnls=[float(x['total_pnl_jpy']) for x in rs]
 wins=sum(x>0 for x in pnls);n=len(rs);z=1.96
 if not n:return {'n':0,'wins':0,'win_rate':None,'wilson95':None,'pf':None}
 p=wins/n;den=1+z*z/n;ctr=(p+z*z/(2*n))/den;rad=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
 loss=-sum(x for x in pnls if x<0)
 return {'n':n,'wins':wins,'win_rate':p,'wilson95':[ctr-rad,ctr+rad],'pf':sum(x for x in pnls if x>0)/loss if loss else None,'mean_net_price_return':statistics.mean((1 if x['side']=='LONG' else -1)*(x['exit_price']/x['entry_price']-1)-.001 for x in rs)}
def feature(t,series,btc):
 ts=t['entry_ts_ms'];b=series.get(ts-H);b3=series.get(ts-3*H);b24=series.get(ts-24*H);bb=btc.get(ts-H);bb3=btc.get(ts-3*H);bb24=btc.get(ts-24*H)
 vs=[float(series[a].get('base_volume',0)) for a in range(ts-25*H,ts-H,H) if a in series]
 if None in [b,b3,b24,bb,bb3,bb24] or len(vs)!=24 or statistics.median(vs)<=0:return None
 sg=1 if t['side']=='LONG' else -1
 r24=sg*(float(b['close'])/float(b24['open'])-1);br24=sg*(float(bb['close'])/float(bb24['open'])-1)
 return {'volume':float(b.get('base_volume',0))/statistics.median(vs),'momentum24':r24,'btc3':sg*(float(bb['close'])/float(bb3['open'])-1),'rs24':r24-br24}
def main():
 tr=readrows(BASE/'ledgers/VPS_VERIFIED_VENUE_365D/PRICE_MODEL_10BPS/portfolio-trades.jsonl.gz')
 raw=readrows(BASE/'inputs/current-source-checked-candidates.jsonl.gz')
 bykey={(c['strategy_id'],c['symbol'],c['side'],c['entry_ts_ms']):c for c in raw}
 cache={s:bars(s) for s in {x['symbol'] for x in tr if x['strategy_id']!='V52'}|{'BTCUSDT'}}
 btc=cache['BTCUSDT'];prepared=[];missing=0
 for t in tr:
  if t['strategy_id']=='V52':continue
  f=feature(t,cache[t['symbol']],btc)
  if f is None:missing+=1;continue
  prepared.append((t,f))
 train=[x for x in prepared if x[0]['exit_ts_ms']<MID];test=[x for x in prepared if x[0]['entry_ts_ms']>=MID]
 def match(f,r):return all(f[k]>=v for k,v in r.items())
 attempts=[]
 for volume in [1.,1.2,1.5]:
  for momentum in [0.,.02,.05]:
   for b3 in [0.,.005]:
    for rs in [0.,.01]:
     rule={'volume':volume,'momentum24':momentum,'btc3':b3,'rs24':rs}
     a=metrics([t for t,f in train if match(f,rule)])
     attempts.append({'rule':rule,'train':a})
 eligible=[a for a in attempts if a['train']['n']>=30 and a['train']['win_rate']>=.70]
 available=[a for a in attempts if a['train']['n']>=30]
 best=max(available,key=lambda a:(a['train']['wilson95'][0],a['train']['n'])) if available else None
 classes={}
 if best:
  rule=best['rule'];best['heldout']=metrics([t for t,f in test if match(f,rule)])
  best['promotion_supported']=best['train']['win_rate']>=.70 and best['heldout']['n']>=30 and best['heldout']['wilson95'][0]>=.70
  # A+ picked only on train; A positive RS/momentum, B otherwise.
  for label in ['A+','A','B']:
   chosen=[]
   for t,f in test:
    cl='A+' if match(f,rule) else ('A' if f['rs24']>=0 and f['momentum24']>=0 else 'B')
    if cl==label:chosen.append(t)
   classes[label]=metrics(chosen)
 fixed={}
 for label,fn in [('V12_EXISTING_HC',lambda t: str(bykey.get((t['strategy_id'],t['symbol'],t['side'],t['entry_ts_ms']),{}).get('entry_quality_class','')).upper().startswith('HC')),('PENGU_SHORT',lambda t:t['strategy_id']=='PENGU' and t['side']=='SHORT'),('FET',lambda t:t['strategy_id']=='FET'),('IDLE',lambda t:t['strategy_id']=='IDLE'),('V52',lambda t:t['strategy_id']=='V52')]:
  group=[t for t in tr if fn(t)];fixed[label]={'full':metrics(group),'train':metrics([t for t in group if t['entry_ts_ms']<MID]),'heldout':metrics([t for t in group if t['entry_ts_ms']>=MID])}
 report={'split_ts_ms':MID,'feature_rows':len(prepared),'missing_features':missing,'train_count':len(train),'heldout_count':len(test),'rules_tested':len(attempts),'eligible_training_rules':len(eligible),'selected_on_train_only':best,'heldout_classes':classes,'fixed_classes':fixed,'selection_warning':'36 training searches; one untouched temporal test half; existing period already used in previous research, not independently unseen market history','production_size_change':False}
 (OUT/'confidence-analysis.json').write_text(json.dumps(report,indent=2))
 details=[]
 for t in tr:
  if t['strategy_id']=='FET':
   c={'entry_ts_ms':t['entry_ts_ms'],'exit_ts_ms':t['exit_ts_ms'],'entry_price':t['entry_price'],'exit_price':t['exit_price'],'side':t['side']}
   x=excursions(c,cache[t['symbol']]);details.append({'entry_ts':t['entry_ts_ms'],'exit_ts':t['exit_ts_ms'],'exit_reason':t['exit_reason_actual'],'net_pnl_usd':t['total_pnl_jpy'],**x})
 (OUT/'fet-giveback-analysis.json').write_text(json.dumps({'trades':details,'scope':'H1 intrabar extrema bound; exit-bar path before STOP cannot be determined; not tick-exact MFE','count':len(details)},indent=2))
 print('CONFIDENCE',json.dumps(report),flush=True);print('FET',json.dumps(details),flush=True)
if __name__=='__main__':main()
