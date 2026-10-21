#!/usr/bin/env python3
"""Price-path screen of HYPE_LONG exits, holding all V4/Q102 official rules fixed.
Entry vs 5m price scale must match; no same-bar future use for profit arming.
Historical trade outcome and path read only, not a portfolio economic test.
"""
from __future__ import annotations
import bisect,collections,json,statistics,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import task9_initial_adverse_stop_20261020 as core
BASE=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_q102_adopted2_plus_hvlong_2h_bt')
OUT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_exit_after_q102v4')
M5=300000;H=3600000
ARMS=(.003,.005,.008,.01,.012,.015,.02,.03,.04,.05)
FLOORS=(-.0025,0.,.002,.003,.005,.008,.01,.015,.02)
INITIAL=((0,.01,.003),(0,.015,.003),(0,.02,.005),
 (1,.01,.003),(1,.015,.005),(2,.015,.005),(3,.02,.005))
def read_trades(cost):
 files=sorted((p for p in BASE.rglob('portfolio-trades.jsonl') if p.parent.name==f'PRICE_MODEL_{cost}BPS'),key=lambda p:p.stat().st_mtime)
 assert len(files)==6,(cost,len(files))
 return [json.loads(l) for l in files[-1].read_text('utf8').splitlines() if l.strip() and json.loads(l)['strategy_id']=='HYPE_LONG']
def compute(row,source):
 entry=float(row['entry_price']);start=int(row['entry_ts_ms']);end=int(row['exit_ts_ms'])
 bars,times=source.getdata(str(row['symbol']))
 st=bisect.bisect_left(times,start);ex=bisect.bisect_left(times,end)
 if st>=ex or abs(bars[st][1]/entry-1)>.025:return {'reason':'PRICE_ANCHOR_BAD'}
 scale=entry/bars[st][1];peak=0.;stage=set();startcuts={};profits={}
 confirmed_peak=0.;mfe=0.;mae=0.;lossclose=0.;prev_high=0.
 for i in range(st,ex):
  ts,o,h,l,c,_=bars[i]
  if i>st and ts-bars[i-1][0]!=M5:return {'reason':'INTERNAL_5M_GAP'}
  o*=scale;h*=scale;l*=scale;c*=scale
  for hours,stop,mfegate in INITIAL:
   key=f'{hours}h_stop{stop*100:g}_priorMfeLT{mfegate*100:g}'
   if key not in startcuts and ts>=start+hours*H and peak<mfegate and (o<=entry*(1-stop) or l<=entry*(1-stop)):
    startcuts[key]=(ts,peak,(min(o,entry*(1-stop))/entry-1)*100)
  for arm in ARMS:
   if arm in stage:
    for floor in FLOORS:
     if floor>=arm:continue
     key=f'arm{arm*100:g}_floor{floor*100:g}'
     if key not in profits and (o<=entry*(1+floor) or l<=entry*(1+floor)):
      profits[key]=(ts,peak,(min(o,entry*(1+floor))/entry-1)*100)
  mfe=max(mfe,h/entry-1)
  mae=max(mae,1-l/entry)
  confirmed_peak=max(confirmed_peak,c/entry-1)
  peak=max(peak,h/entry-1)
  for arm in ARMS:
   if c>=entry*(1+arm):stage.add(arm)
 return {'reason':'OK','candidate':row['candidate_id'],'exitReason':row['exit_reason_actual'],
  'pnlJpy':row['modeled_realized_pnl_jpy_at_exit_fx'],'win':row['modeled_realized_pnl_jpy_at_exit_fx']>0,
  'hours':(end-start)/H,'peakMfePct':mfe*100,'maxMaePct':mae*100,
  'peakConfirmedClosePct':confirmed_peak*100,
  'firstInitialHits':startcuts,'profitGuardHits':profits}
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 source,_=core.task8.legacy.bootstrap()
 result={'status':'HYPE_USER_ADOPTED_V4_Q102_3_FIXED_PRICE_SCREEN','portfolioCertified':False,'costs':{}}
 for cost in (10,30):
  candidates=read_trades(cost)
  rows=[compute(r,source) for r in candidates]
  assert all(r['reason']=='OK' for r in rows),collections.Counter(r['reason'] for r in rows)
  def stat(group):
   return {'trades':len(group),'wins':sum(x['win'] for x in group),
    'medianMFE':statistics.median(x['peakMfePct'] for x in group),
    'medianMAE':statistics.median(x['maxMaePct'] for x in group),
    'medianHrs':statistics.median(x['hours'] for x in group),
    'totalRealizedPnlJpy':sum(x['pnlJpy'] for x in group)}
  report={'count':len(rows),'summary':{'all':stat(rows),'winners':stat([r for r in rows if r['win']]),
    'losers':stat([r for r in rows if not r['win']])},
    'exitReasons':dict(collections.Counter(r['exitReason'] for r in rows)),
    'initialRisk':{},'profitProtection':{}}
  for h,stop,mfegate in INITIAL:
   key=f'{h}h_stop{stop*100:g}_priorMfeLT{mfegate*100:g}'
   hit=[r for r in rows if key in r['firstInitialHits']]
   report['initialRisk'][key]={'trades':len(hit),'oldLosers':sum(not x['win'] for x in hit),
     'oldWinners':sum(x['win'] for x in hit),'oldWinnersPnlAtRisk':sum(x['pnlJpy'] for x in hit if x['win']),
     'oldLoserPnL':sum(x['pnlJpy'] for x in hit if not x['win'])}
  for a in ARMS:
   for f in FLOORS:
    if f>=a:continue
    key=f'arm{a*100:g}_floor{f*100:g}'
    hit=[r for r in rows if key in r['profitGuardHits']]
    report['profitProtection'][key]={'trades':len(hit),'oldLosers':sum(not x['win'] for x in hit),
      'oldWinners':sum(x['win'] for x in hit)}
  result['costs'][str(cost)]=report
  (OUT/f'HYPE_ACCEPTED_5M_PRICE_PATHS_{cost}BPS.jsonl').write_text('\n'.join(json.dumps(x,ensure_ascii=False) for x in rows)+'\n','utf8')
  print('HYPE_PATH',cost,report['count'],'REASONS',report['exitReasons'],'STATS',report['summary'],flush=True)
  print('EARLY_SCREEN',[(k,v) for k,v in report['initialRisk'].items() if v['trades']],flush=True)
  print('PROFIT_SCREEN',[(k,v) for k,v in report['profitProtection'].items() if k in ('arm0.5_floor0.2','arm0.8_floor0.3','arm1_floor0.5','arm1.5_floor0.5')],flush=True)
 (OUT/'HYPE_M5_PROFIT_INITIAL_SCREEN_20261022.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
 print('SCREEN_DONE',flush=True)
if __name__=='__main__':main()
