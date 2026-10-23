#!/usr/bin/env python3
"""SCREEN ONLY: established selected Idle SHORT entries and causal M5 feature filters.
Does not alter production. All outcomes are from selected historical trades.
"""
from __future__ import annotations
import importlib.util,json,math,collections,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
def load(n,path):
 sp=importlib.util.spec_from_file_location(n,path)
 m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
feat=load('idle_prev_caused',HERE/'screen-idle-five-symbol-entry-caused-20261022.py')
ledger=load('idle_prev_cumulative',HERE/'screen-idle-next-m5-after-pengu-20261024.py')
source_mod=load('idle_source_reference',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
# data feed acquired lazily only for screen, not during native full8 import
SYMS=['RENDERUSDT','DOTUSDT','JUPUSDT']
def rules():
 data={n:r for n,r in feat.CANDIDATES}
 for key,low,high in [('btc1h',-2,2),('btc3h',-3,3),('btc6h',-4,4),('ret1h',-3,2),('ret3h',-5,3),('ret6h',-8,3),('rel1h',-3,2),('rel3h',-5,3),('rel6h',-5,3)]:
  for t in (low,-1.5,-1.,-.5,0,.5,1.,1.5,high):
   for op in ('ge','le'):
    data[f'{key}_{op}_{t:g}']={'feat':key,'op':op,'threshold':t}
 for t in (.35,.45,.55,.65,.8,1.,1.5):
  data[f'atr3h_le_{t:g}']={'feat':'atr3h','op':'le','threshold':t}
  data[f'atr3h_ge_{t:g}']={'feat':'atr3h','op':'ge','threshold':t}
 for t in (.75,.9,1.,1.1,1.2,1.35,1.5):
  data[f'volratio_ge_{t:g}']={'feat':'volratio','op':'ge','threshold':t}
  data[f'volratio_le_{t:g}']={'feat':'volratio','op':'le','threshold':t}
 data['not_btc6_positive_and_symbol_rel6_positive']={'multi':[('btc6h','gt',0),('rel6h','gt',0)],'vetoIfAll':True}
 data['not_btc3_positive_and_symbol_rel3_positive']={'multi':[('btc3h','gt',0),('rel3h','gt',0)],'vetoIfAll':True}
 data['not_oversold_ret6_and_low_volume']={'multi':[('ret6h','lt',-3),('volratio','lt',1)],'vetoIfAll':True}
 data['not_weak_btc_and_strong_symbol']={'multi':[('btc3h','lt',-.5),('rel3h','gt',1)],'vetoIfAll':True}
 return data
RULES=rules()
def accept(f,r):
 if f is None:return False
 if 'multi' in r:
  tests=[]
  for k,op,v in r['multi']:
   x=f.get(k)
   if x is None or not math.isfinite(x):return False
   tests.append(x>v if op=='gt' else x<v)
  return not all(tests) if r['vetoIfAll'] else all(tests)
 return feat.passes(f,r)
def metrics(rows):
 if not rows:return {'n':0,'wins':0,'winRate':None,'pnlJpy':None}
 wins=sum(z['win'] for z in rows)
 return {'n':len(rows),'wins':wins,'winRate':round(100*wins/len(rows),3),
         'pnlJpy':round(sum(z['pnl'] for z in rows),2)}
def normalize(rows):
 return [{'ts':int(r['entry_ts_ms']),'sym':r['symbol'],
   'win':float(r['total_pnl_jpy'])>0,'pnl':float(r['modeled_realized_pnl_jpy_at_exit_fx']),
   'candidateId':r['candidate_id'],'features':feat.get_feat(SOURCE,r['symbol'],int(r['entry_ts_ms']))} for r in rows]
def half(rows):
 # Pre-registered calendar split, not untouched OOS (historical data used by previous work).
 cutoff=1770681600000 # 2026-02-10 00 UTC
 return {'earlier':metrics([r for r in rows if r['ts']<cutoff]),
         'later':metrics([r for r in rows if r['ts']>=cutoff])}
def main():
 SOURCE,_=source_mod.native.m.m.core.task8.legacy.bootstrap()
 output={'status':'SELECTED_TRADE_SCREEN_ONLY_NOT_CAUSAL_FULL8_NOT_UNTOUCHED_OOS',
    'ruleCount':len(RULES),'rules':RULES,'costs':{}}
 for cost in (10,30):
  allrows,ref=ledger.source_ledger(cost)
  out={}
  for sym in SYMS:
   rows=normalize([r for r in allrows if r['strategy_id']=='IDLE' and r['side']=='SHORT' and r['symbol']==sym])
   assert rows and all(r['features'] is not None for r in rows),(sym,cost,'MISSING_FEATURES')
   baseline=metrics(rows)
   results=[]
   for name,rule in RULES.items():
    kept=[r for r in rows if accept(r['features'],rule)]
    if len(kept)==len(rows) or len(kept)<math.ceil(.75*len(rows)):continue
    removed=[r for r in rows if not accept(r['features'],rule)]
    obj={'name':name,'rule':rule,'kept':metrics(kept),'removed':metrics(removed),
       'keptPct':round(100*len(kept)/len(rows),2),'deltaWRpp':round(metrics(kept)['winRate']-baseline['winRate'],2),
       'earlyLate':half(kept),'baselineEarlyLate':half(rows),
       'removedExamples':[{'ts':z['ts'],'won':z['win'],'pnlJpy':round(z['pnl'])} for z in removed]}
    results.append(obj)
   # Favor trade volume and wins, but avoid sorting by profits in order to avoid extremal selection.
   results.sort(key=lambda z:(-z['deltaWRpp'],-z['kept']['n'],len(z['removedExamples']),z['name']))
   out[sym]={'baseline':baseline,'baselineSplit':half(rows),'candidateRules':results,'allEntryFeatures':rows}
   print('COST',cost,'SYM',sym,'BASE',baseline,'COMPARABLE',len(results),flush=True)
   for x in results[:15]:
    print(' CAND',x['name'],'kept',x['kept']['n'],'WR',x['kept']['winRate'],
       'removedW',x['removed']['wins'],'early',x['earlyLate']['earlier']['winRate'],
       'later',x['earlyLate']['later']['winRate'],flush=True)
  output['costs'][str(cost)]={'ledgerSha':ref['ledgerSha256'],'symbols':out}
 dst=REPO/'docs/research/results/idle-entry-three-20261024'
 dst.mkdir(parents=True,exist_ok=True)
 f=dst/'IDLE_RENDER_DOT_JUP_CURRENT_CAUSAL_ENTRY_SCREEN_20261024.json'
 f.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 print('SAVE',f,'SIZE',f.stat().st_size,flush=True)
if __name__=='__main__':main()
