#!/usr/bin/env python3
"""HYPE entry-quality screen on pre-entry completed 5m BTC/HYPE price/volume.
Design gates on chronologically early training only. Evaluate untouched later holdout
and full sample, with retrospective labels USED ONLY TO SCORE gates, never as inputs.
These results are diagnostic only; full native economic simulation is separate.
"""
from __future__ import annotations
import sys,json,hashlib,bisect,collections,statistics,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import task9_initial_adverse_stop_20261020 as core
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
BASE=ROOT/'2026-10-22_hype_profit_loss_after_v4_q102adopted3_full8'
OUT=ROOT/'2026-10-22_hype_entry_winrate_after_v4_q102'
M5=300000
def fixed_baseline(cost):
 name=f'HYPE3ACCEPTED_HYPE_BASELINE_3ACCEPTED_C{cost}_I2'
 h=hashlib.sha256(name.encode()).hexdigest()[:12]
 f=BASE/'engine'/f'cmp_{h}'/f'cmp_{h}'/f'{cost}bps'/'cases'/'V2_M150_D05_CORE_NATIVE'/'runs'/f'PRICE_MODEL_{cost}BPS'/'portfolio-trades.jsonl'
 assert f.is_file(),f
 return [json.loads(t) for t in f.read_text('utf8').splitlines() if t.strip() and json.loads(t)['strategy_id']=='HYPE_LONG']
def window_price(b,idx,dist):
 j=idx-dist*12
 if j<0:return None
 return float(b[idx][4])/float(b[j][4])-1
def metrics(entry,source):
 t=int(entry['entry_ts_ms'])
 hype,times=source.getdata('HYPEUSDT')
 btc,btc_times=source.getdata('BTCUSDT')
 idx=bisect.bisect_left(times,t)-1
 bix=bisect.bisect_left(btc_times,t)-1
 # no current or future bar, exactly latest H1/m5 close known at entry
 if idx<0 or bix<0 or int(times[idx])+M5>t or int(btc_times[bix])+M5>t:return {'fail':'FUTURE_OR_INSUFFICIENT'}
 if abs(float(hype[idx][4])/float(entry['entry_price'])-1)>.035:return {'fail':'ENTRY_ANCHOR_CLOSE_DIFF'}
 out={'entryTs':t,'symbol':entry['symbol'],'candidateId':entry['candidate_id'],
  'oldWin':float(entry['modeled_realized_pnl_jpy_at_exit_fx'])>0,
  'oldPnl':entry['modeled_realized_pnl_jpy_at_exit_fx']}
 for h in (1,3,6,12,24,48,72):
  a=window_price(hype,idx,h);b=window_price(btc,bix,h)
  if a is None or b is None:return {'fail':'INSUFFICIENT_LOOKBACK'}
  out[f'HYPE{h}hPct']=a*100;out[f'BTC{h}hPct']=b*100;out[f'REL{h}hPct']=(a-b)*100
 # volume is source native M5 volume as available, never use future bar
 for h in (1,3,6):
  n=h*12
  curr=[float(r[5]) for r in hype[idx-n+1:idx+1]]
  old=[float(r[5]) for r in hype[idx-(n+24)+1:idx-n+1]]
  if len(curr)<n or len(old)<24 or min(old)<=0 or sum(old)<=0:return {'fail':'VOLUME_MISSING'}
  out[f'VOL{h}hToPrior2hRatio']=(sum(curr)/len(curr))/(sum(old)/len(old))
 # realized range 6h vs entry: use only completed
 last=hype[idx-71:idx+1];high=max(float(r[2]) for r in last);low=min(float(r[3]) for r in last)
 if low<=0:return {'fail':'PRICE_BAD'}
 out['HYPE6hRangePct']=(high/low-1)*100
 # Last 24h close max excursion over past hour signal; high distortion trap
 trailing=hype[idx-287:idx+1]
 out['HYPE24hDistanceFromHighPct']=(float(hype[idx][4])/max(float(r[2]) for r in trailing)-1)*100
 # entry after 5m burst: calculate 5m close vs 1h old close
 out['HYPE5mReturnPct']=(float(hype[idx][4])/float(hype[idx-1][4])-1)*100
 # approximate hourly EMA from sampled 5m closes, all settled
 def ema(prices,period):
  alpha=2/(period+1)
  v=prices[0]
  for val in prices[1:]:v=alpha*val+(1-alpha)*v
  return v
 closes=[float(hype[k][4]) for k in range(idx-11,idx-12*250,-12) if k>=0]
 if len(closes)<241:return {'fail':'EMA240_INSUFFICIENT'}
 closes=closes[::-1]
 for per in (12,48,240):
  val=ema(closes,per)
  out[f'HYPE_DistanceEMA{per}_pct']=(closes[-1]/val-1)*100
 out['HYPE_EMA12GapEMA48pct']=(ema(closes,12)/ema(closes,48)-1)*100
 return out
FEATURES=[
 'BTC1hPct','BTC3hPct','BTC6hPct','BTC12hPct','BTC24hPct','BTC48hPct',
 'HYPE1hPct','HYPE3hPct','HYPE6hPct','HYPE12hPct','HYPE24hPct','HYPE48hPct',
 'REL1hPct','REL3hPct','REL6hPct','REL12hPct','REL24hPct','REL48hPct',
 'VOL1hToPrior2hRatio','VOL3hToPrior2hRatio','VOL6hToPrior2hRatio',
 'HYPE6hRangePct','HYPE24hDistanceFromHighPct',
 'HYPE5mReturnPct','HYPE_DistanceEMA12_pct','HYPE_DistanceEMA48_pct','HYPE_DistanceEMA240_pct','HYPE_EMA12GapEMA48pct']
def assess(rows,gate):
 sub=[x for x in rows if gate(x)]
 wins=sum(int(x['oldWin']) for x in sub)
 return {'trades':len(sub),'wins':wins,'losses':len(sub)-wins,
 'winRatePct':(wins/len(sub)*100 if sub else None),
 'totalOriginalPnLJpy':sum(x['oldPnl'] for x in sub)}
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 source,_=core.task8.legacy.bootstrap()
 summary={}
 for cost in (10,30):
  original=fixed_baseline(cost)
  rows=[metrics(x,source) for x in original]
  fails=collections.Counter(x['fail'] for x in rows if 'fail' in x)
  assert not fails,(cost,fails)
  rows=sorted(rows,key=lambda x:x['entryTs'])
  train=rows[:max(1,int(.70*len(rows)))];test=rows[len(train):]
  allbase=assess(rows,lambda r:True)
  trainbase=assess(train,lambda r:True);testbase=assess(test,lambda r:True)
  print('BASE',cost,'N',len(rows),'TRAIN',trainbase,'HOLDOUT',testbase,flush=True)
  candidates=[]
  # train-only 10/20/30/40/50/60% thresholds; no label enters condition
  for feat in FEATURES:
   vals=[float(x[feat]) for x in train]
   for q in (.1,.2,.3,.4,.5,.6,.7,.8,.9):
    threshold=sorted(vals)[min(len(vals)-1,round((len(vals)-1)*q))]
    for direction in ('gte','lte'):
     def gate(r,feature=feat,limit=threshold,d=direction):
      return (r[feature]>=limit) if d=='gte' else (r[feature]<=limit)
     tr=assess(train,gate);te=assess(test,gate);allr=assess(rows,gate)
     if tr['trades']<8 or tr['trades']>len(train)-3:continue
     # require reasonable nonzero untouched holdout denominator, not necessarily winning
     if te['trades']<3:continue
     rec={'feature':feat,'direction':direction,'threshold':threshold,'train':tr,'holdout':te,'full':allr}
     candidates.append(rec)
  candidates.sort(key=lambda x:(-(x['train']['winRatePct']-trainbase['winRatePct']),-x['train']['wins'],-x['holdout']['trades']))
  candidates=candidates[:250]
  # rank by in-sample (train) first; holdout shown separately to detect collapse
  filtered=[]
  seen=set()
  for c in candidates:
   token=(c['feature'],c['direction'],tuple(x['candidateId'] for x in train if (x[c['feature']]>=c['threshold'])==(c['direction']=='gte')))
   if token in seen:continue
   seen.add(token);filtered.append(c)
  ordered=filtered[:60]
  valid=[r for r in filtered if r['holdout']['winRatePct'] is not None and r['holdout']['winRatePct']>=testbase['winRatePct']
       and r['train']['winRatePct']>trainbase['winRatePct']]
  print('TOP_TRAIN',cost,[(x['feature'],x['direction'],round(x['threshold'],3),x['train']['trades'],round(x['train']['winRatePct'],1),x['holdout']['trades'],round(x['holdout']['winRatePct'],1)) for x in ordered[:12]],flush=True)
  print('TOP_GENERALIZING',cost,[(x['feature'],x['direction'],round(x['threshold'],3),x['train']['trades'],round(x['train']['winRatePct'],1),x['holdout']['trades'],round(x['holdout']['winRatePct'],1)) for x in valid[:12]],flush=True)
  output={'trainBase':trainbase,'holdoutBase':testbase,'allBase':allbase,
   'chronologicalSplit':{'trainEndTs':train[-1]['entryTs'],'holdoutStartTs':test[0]['entryTs']},
   'topTrainingOnly':ordered,'topTrainAndHoldoutNonWorse':valid[:35]}
  summary[str(cost)]=output
  (OUT/f'HYPE_ENTRY_CAUSAL_FEATURES_{cost}BPS.jsonl').write_text('\n'.join(json.dumps(x,ensure_ascii=False) for x in rows)+'\n','utf8',newline='\n')
 (OUT/'HYPE_ENTRY_WINRATE_SCREEN_20261022.json').write_text(json.dumps({'status':'TRAIN_HOLDOUT_CAUSAL_FEATURE_SCREEN_NOT_INTEGRATED_BT',
   'source':'accepted HYPE positions only; independent full population candidate gating mandatory before claims',
   'costs':summary},ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
 print('ANALYSIS_COMPLETED',flush=True)
if __name__=='__main__':main()
