#!/usr/bin/env python3
"""IDLE SHORT next-strategy causal M5 screen anchored to adopted PENGU full8.
Screen is not economic BT; a selected trade is NOT an independent candidate cohort.
"""
from __future__ import annotations
import importlib.util,bisect,collections,math,hashlib,json,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
M5=300000; H=3600000
CASES={}
for h in (1,2,3,4,6,8,12):
 for loss in (.75,1.,1.5,2.,2.5,3.,4.):
  for mfe in (.25,.5,1.):
   CASES[f'AT{h}_LOSS{loss:g}_MFE{mfe:g}']={'mode':'AT','hours':h,'loss':loss,'mfeMax':mfe}
for loss in (1.,1.5,2.,2.5,3.):
 for delay in (1,2,3):
  for mfe in (.25,.5,1.):
   CASES[f'TOUCH{loss:g}_WATCH{delay}_MFE{mfe:g}']={'mode':'WATCH','loss':loss,'watchH':delay,'mfeMax':mfe}
for loss in (1.,1.5,2.,2.5):
 for mins in (30,60,120,180):
  for mfe in (.25,.5,1.):
   CASES[f'SUSTAIN{loss:g}_MIN{mins}_MFE{mfe:g}']={'mode':'SUSTAIN','loss':loss,'mins':mins,'mfeMax':mfe}
def load(name,p):
 sp=importlib.util.spec_from_file_location(name,p)
 m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(1<<20),b''):h.update(chunk)
 return h.hexdigest()
def source_ledger(cost):
 p=ROOT/'rv24penguInitialCombinedNormal8Recovery24'/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json'
 m=json.loads(p.read_text('utf8'))
 k=m['cases']['NORMAL_8H_HARDCOOL_PLUS_RECOVERY_24H_3P']['costs'][str(cost)]
 for f in (ROOT/'rv24penguInitialCombinedNormal8Recovery24'/'engine').rglob('portfolio-trades.jsonl'):
  if sha(f)==k['ledgerSha256']:
   return [json.loads(x) for x in f.read_text('utf8').splitlines()],k
 raise RuntimeError(('MISSING_LEDGER',cost))
def path_short(row,feed):
 bars,times=feed.getdata(row['symbol'])
 entry=float(row['entry_price'])
 start=int(row['entry_ts_ms']);end=int(row['exit_ts_ms'])
 a=bisect.bisect_left(times,start)
 assert a<len(times) and int(times[a])==start,(row['symbol'],start,'NO_ENTRY_M5')
 anchor=float(bars[a][1]);scale=entry/anchor
 assert abs((scale-1)*100)<5,('ANCHOR_GAP',row['symbol'],start,scale)
 path=[];maxFavorable=0.
 for i in range(a,len(times)-1):
  ts=int(times[i]);done=ts+M5
  if done>=end:break
  assert int(times[i+1])==done,('M5_GAP',row['symbol'],ts)
  bar=bars[i]
  hi=float(bar[2])*scale;lo=float(bar[3])*scale;close=float(bar[4])*scale;nxt=float(bars[i+1][1])*scale
  favorable=100*(1-lo/entry)
  before=maxFavorable
  maxFavorable=max(maxFavorable,favorable)
  path.append({'ts':done,'gainClose':100*(1-close/entry),'mfeBefore':before,
    'mfeAfter':maxFavorable,'maeHighPct':100*(hi/entry-1),
    'gainFillNext':100*(1-nxt/entry),'fillPrice':nxt})
 return path
def stop(path,rule,start):
 mode=rule['mode'];threshold=rule['mfeMax']
 touch=None;continuous=0
 for p in path:
  if p['mfeAfter']>=threshold:return None
  t=int(p['ts']);gain=p['gainClose']
  if mode=='AT':
   when=start+rule['hours']*H
   if t==when:return p if gain<=-rule['loss'] else None
   if t>when:return None
  elif mode=='WATCH':
   if touch is None and gain<=-rule['loss']:touch=t
   elif touch is not None and t>=touch+rule['watchH']*H:
    if gain<=-rule['loss']:return p
    touch=None
  elif mode=='SUSTAIN':
   continuous=continuous+1 if gain<=-rule['loss'] else 0
   if continuous>=rule['mins']//5:return p
  else:raise ValueError(mode)
 return None
def evaluate(rows,paths):
 result={}
 for key,rule in CASES.items():
  hits=[]
  for r in rows:
   out=stop(paths[(r['symbol'],int(r['entry_ts_ms']))],rule,int(r['entry_ts_ms']))
   if out is not None:
    hit={'symbol':r['symbol'],'entryTs':r['entry_ts_ms'],'oldWon':r['total_pnl_jpy']>0,
      'oldPnlJpy':r['modeled_realized_pnl_jpy_at_exit_fx'],'exitReason':r['exit_reason_actual'],
      'newTs':out['ts'],'priceChangePct':out['gainFillNext'],'mfeBefore':out['mfeBefore']}
    hits.append(hit)
  result[key]={'n':len(hits),'winnersCut':sum(h['oldWon'] for h in hits),'lossesCut':sum(not h['oldWon'] for h in hits),'hits':hits}
 return result
def main():
 base=load('idle_next_source',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 base.native.m.acquire_verified_h1()
 feed,_=base.native.m.m.core.task8.legacy.bootstrap()
 data={'status':'SELECTED_TRADE_SCREEN_ONLY_NOT_ECONOMIC_OR_LIVE','costs':{},'cases':CASES}
 for cost in (10,30):
  allrows,ref=source_ledger(cost)
  idle=[z for z in allrows if z['strategy_id']=='IDLE' and z['side']=='SHORT']
  paths={(z['symbol'],int(z['entry_ts_ms'])):path_short(z,feed) for z in idle}
  per={}
  for sym in sorted(set(z['symbol'] for z in idle)):
   rows=[z for z in idle if z['symbol']==sym]
   values=evaluate(rows,paths)
   good=[(k,v) for k,v in values.items() if v['lossesCut']>=2 and v['winnersCut']==0]
   print('COST',cost,'SYMBOL',sym,'N',len(rows),'WIN',sum(z['total_pnl_jpy']>0 for z in rows),
         'LOSSES',sum(z['total_pnl_jpy']<0 for z in rows),'ZERO_WIN_KILL_2PLUS_HITS',len(good),flush=True)
   for k,v in sorted(good,key=lambda q:(-q[1]['lossesCut'],q[1]['n'],q[0]))[:16]:
    print('CAND',sym,k,'HITS',v['n'],'LOSSES',v['lossesCut'],'WIN_CUT',v['winnersCut'],flush=True)
   per[sym]={'tradeCount':len(rows),'wins':sum(z['total_pnl_jpy']>0 for z in rows),
              'realizedJpy':sum(z['modeled_realized_pnl_jpy_at_exit_fx'] for z in rows),
              'results':values}
  data['costs'][str(cost)]={'sourceLedgerSha':ref['ledgerSha256'],'symbols':per}
 out=REPO/'docs/research/results/idle-next-20261024/IDLE_SHORT_CURRENT_CUMULATIVE_M5_LOSS_SCREEN_20261024.json'
 out.parent.mkdir(parents=True,exist_ok=True)
 out.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('SCREEN_SAVED',out,'SIZE',out.stat().st_size,flush=True)
if __name__=='__main__':main()
