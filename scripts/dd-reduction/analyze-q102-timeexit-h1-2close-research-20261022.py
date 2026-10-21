#!/usr/bin/env python3
"""Q102 time-exit losers: causal completed H1 bearish-or-bullish confirmations.
Price-path SCREEN ONLY; integrated economics comes from independent candidate BT.
"""
import sys,collections,bisect,json,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import task9_initial_adverse_stop_20261020 as core
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research')
BASE=ROOT/'2026-10-21_v4_locked_next_q102_cumulative'
OUT=ROOT/'2026-10-22_q102_timeexit_h1_path_screen'
M5=300000;H=3600000
HOURS=(3,6,12,24,36,48)
THRESHOLDS=(.01,.015,.02,.025,.03,.04)
def load_accepted(cost):
 p=sorted((x for x in BASE.rglob('portfolio-trades.jsonl') if x.parent.name==f'PRICE_MODEL_{cost}BPS'),key=lambda x:x.stat().st_mtime)
 assert len(p)==3
 return [json.loads(t) for t in p[-1].read_text('utf8').splitlines() if t.strip() and json.loads(t).get('strategy_id')=='Q102']
def scan(row,source):
 ent=float(row['entry_price']);t0=int(row['entry_ts_ms']);t1=int(row['exit_ts_ms']);side=row['side']
 sign=1 if side=='LONG' else -1
 b,ts=source.getdata(str(row['symbol']))
 st=bisect.bisect_left(ts,t0);end=bisect.bisect_left(ts,t1)
 if st>=end or abs(float(b[st][1])/ent-1)>.025:raise RuntimeError('MISSING_OR_MISALIGNED_'+str(row['symbol']))
 scale=ent/float(b[st][1]);armed=False;streaks={v:0 for v in THRESHOLDS}
 touches={}
 for j in range(st,end):
  timestamp,op,hi,lo,close,_=b[j]
  if j>st and timestamp-b[j-1][0]!=M5:raise RuntimeError('GAP')
  c=(float(close)*scale/ent-1)*sign
  # prior completed H1 decisions do NOT use the current 5m bar high intrabar
  if ((timestamp+M5)%H)==0:
   for threshold in THRESHOLDS:
    streaks[threshold]=(streaks[threshold]+1) if c<=-threshold else 0
    for hour in HOURS:
     k=(hour,threshold)
     if k not in touches and not armed and timestamp+M5>=t0+hour*H and streaks[threshold]>=2:
      # Only a completed H1 signal, next bar fill would occur afterward.
      if j+1<end:
       o=float(b[j+1][1])*scale
       touches[k]={'armAtCompletedH1TsMs':timestamp+M5,'nextOpen':o,'directionalReturnPct':(o/ent-1)*sign*100}
  armed |= (c>=.02)
 return touches
def main():
 source,_=core.task8.legacy.bootstrap()
 report={'status':'Q102_H1_2_CLOSED_CANDLE_TIME_EXIT_SIGNAL_SCREEN_NOT_PORTFOLIO_BT',
 'source':'8-logic accepted V4 four-rule frozen baseline, Q102 exits 5m, M5-price normalized to entry',
 'costs':{}}
 for cost in (10,30):
  q=load_accepted(cost)
  cells=collections.defaultdict(lambda:{'oldWinners':0,'oldLosers':0,'originalWinnerPnlJpy':0.,'originalLoserPnlJpy':0.,'oldTimeExitLosers':0,'hits':[]})
  for row in q:
   hit=scan(row,source)
   win=float(row['modeled_realized_pnl_jpy_at_exit_fx'])>0
   for (hour,thr),obs in hit.items():
    k=(row['family'],row['side'],hour,thr)
    d=cells[k]
    d['oldWinners' if win else 'oldLosers']+=1
    d['originalWinnerPnlJpy' if win else 'originalLoserPnlJpy']+=float(row['modeled_realized_pnl_jpy_at_exit_fx'])
    if (not win) and row['exit_reason_actual']=='Q102_TIME_EXIT':d['oldTimeExitLosers']+=1
    if len(d['hits'])<15:d['hits'].append({'symbol':row['symbol'],'candidate':row['candidate_id'],'oldWin':win,'oldExitReason':row['exit_reason_actual'],'atReturnPct':obs['directionalReturnPct']})
  vals=[]
  for (family,side,h,threshold),stats in cells.items():
   vals.append(dict(family=family,side=side,ageHours=h,negativeClosedH1ThresholdPct=threshold*100,**stats))
  report['costs'][str(cost)]={'count':len(q),'cells':sorted(vals,key=lambda z:(z['family'],z['side'],z['ageHours'],z['negativeClosedH1ThresholdPct']))}
  print('Q102_TIMEEXIT_M5SCREEN',cost,'N',len(q),'CELLS',len(vals),flush=True)
  filtered=[x for x in vals if x['family'] in ('HIGH_VOL','MR') and x['oldTimeExitLosers']>0]
  for d in sorted(filtered,key=lambda x:(-x['oldTimeExitLosers'],x['oldWinners']))[:18]:
   print('SCREEN',d['family'],d['side'],d['ageHours'],'NEG_H1',d['negativeClosedH1ThresholdPct'],
   'TIME_LOSERS',d['oldTimeExitLosers'],'LOSERS_ALL',d['oldLosers'],'WINNERS_CUT',d['oldWinners'],flush=True)
 OUT.mkdir(parents=True,exist_ok=True)
 f=OUT/'Q102_H1_CONFIRMED_TIME_EXIT_CAUSAL_SCREEN_20261022.json'
 f.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
 print('REPORT',f.name,f.stat().st_size)
if __name__=='__main__':main()
