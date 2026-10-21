#!/usr/bin/env python3
"""5m causal pre-profit-arm Q102 adverse hard-stop MFE gate vs winners.
This is a *trade-path screening*, NOT a portfolio backtest.
"""
import bisect,collections,json,sys,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import task9_initial_adverse_stop_20261020 as core
ROOT=Path(r'C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research')
BASE=ROOT/'2026-10-21_v4_locked_next_q102_cumulative'
OUT=ROOT/'2026-10-22_q102_entry_path_decomposition'
H=3600000;M5=300000
WINDOWS=(0,1,3,6,12)
LIMITS=(.02,.025,.03,.04,.05)
def market_result(tr,source):
 price=float(tr['entry_price']);st0=int(tr['entry_ts_ms']);end=int(tr['exit_ts_ms']);side=tr['side']
 bars,t=source.getdata(tr['symbol'])
 st=bisect.bisect_left(t,st0);en=bisect.bisect_left(t,end)
 if en<=st or abs(bars[st][1]/price-1)>.025:return None
 scale=price/bars[st][1]
 c_armer=False
 first={}
 for ix in range(st,en):
  tm,op,hi,lo,close,_=bars[ix]
  if ix>st and tm-bars[ix-1][0]!=M5:return None
  op*=scale;hi*=scale;lo*=scale;close*=scale
  for hour in WINDOWS:
   for stop in LIMITS:
    key=(hour,stop)
    if key in first or c_armer or tm<st0+hour*H:continue
    stprice=price*(1-stop if side=='LONG' else 1+stop)
    touched=(op<=stprice or lo<=stprice) if side=='LONG' else (op>=stprice or hi>=stprice)
    if touched:
     fill=min(op,stprice) if side=='LONG' else max(op,stprice)
     first[key]={'timeHours':(tm-st0)/H,'entryRelativeExitPriceReturnPct':(fill/price-1)*100*(1 if side=='LONG' else -1)}
  gain=(close/price-1)*(1 if side=='LONG' else -1)
  if gain>=.02:c_armer=True
 return first
def main():
 source,_=core.task8.legacy.bootstrap()
 result={'status':'Q102_CAUSAL_PRICE_PATH_SCREEN_ONLY','rules':'Q102 profit floor unarmed, closed 5m gain <2% previously; early adverse stop grid no same-bar hindsight','byCost':{}}
 for bps in (10,30):
  files=sorted((x for x in BASE.rglob('portfolio-trades.jsonl') if x.parent.name==f'PRICE_MODEL_{bps}BPS'),key=lambda x:x.stat().st_mtime)
  assert len(files)==3
  trades=[json.loads(s) for s in files[-1].read_text('utf8').splitlines() if s.strip()]
  q=[x for x in trades if x['strategy_id']=='Q102']
  cases=collections.defaultdict(lambda:{'winners':0,'losers':0,'winnerOriginalPnlJpy':0.,'loserOriginalPnlJpy':0.,'medianEntryReturnPct':[],'cases':[]})
  for tr in q:
   hist=market_result(tr,source)
   if hist is None:raise RuntimeError('MISSING_Q102_M5_'+str(tr['candidate_id']))
   old=float(tr['modeled_realized_pnl_jpy_at_exit_fx'])
   for (h,stop),v in hist.items():
    key=(tr['family'],tr['side'],h,stop)
    k=cases[key];iswin=old>0
    k['winners' if iswin else 'losers']+=1
    k['winnerOriginalPnlJpy' if iswin else 'loserOriginalPnlJpy']+=old
    k['medianEntryReturnPct'].append(v['entryRelativeExitPriceReturnPct'])
    k['cases'].append({'id':tr['candidate_id'],'symbol':tr['symbol'],'oldWin':iswin,'timeHours':v['timeHours']})
  sortedrows=[]
  for (fam,side,h,stop),stat in cases.items():
   sortedrows.append({'family':fam,'side':side,'armHours':h,'adverseStopPct':stop*100,
     'oldWinnersTouched':stat['winners'],'oldLosersTouched':stat['losers'],
     'winnerOriginalPnlAtRiskJpy':round(stat['winnerOriginalPnlJpy']),
     'oldLoserPnlTouchedJpy':round(stat['loserOriginalPnlJpy']),
     'medianEntryReturnPct':statistics.median(stat['medianEntryReturnPct']),
     'someCases':stat['cases'][:12]})
  result['byCost'][str(bps)]=sorted(sortedrows,key=lambda x:(x['family'],x['side'],x['armHours'],x['adverseStopPct']))
  print('COST',bps,'SCOPED_GRID_ITEMS',len(sortedrows),flush=True)
  for r in sorted(sortedrows,key=lambda v:(-v['oldLosersTouched'],v['oldWinnersTouched']))[:15]:
   print('MFE2_UNARMED',r['family'],r['side'],r['armHours'],r['adverseStopPct'],'LOSERS',r['oldLosersTouched'],'WINNERS',r['oldWinnersTouched'],'OLD_LOSS_JPY',r['oldLoserPnlTouchedJpy'],flush=True)
 OUT.mkdir(parents=True,exist_ok=True)
 p=OUT/'Q102_PREARM_INITIAL_ADVERSE_GRID_20261022.json'
 p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
 print('DONE',p,flush=True)
if __name__=='__main__':main()
