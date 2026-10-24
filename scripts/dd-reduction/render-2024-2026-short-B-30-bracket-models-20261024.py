#!/usr/bin/env python3
"""Causal same-bar stop-first M5 B rebound SHORT stop/TP/trail research.
Existing all-six families remain frozen; only B's bracket/exit paths changed.
STOP grid 1.5/2/2.5/3/3.5% and 5 exit modes; 2024-26 IN-SAMPLE research.
"""
from __future__ import annotations
import json,bisect,collections
from pathlib import Path
from importlib import util
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
B='SHORT_BEAR_REBOUND_2H_FADE'
def load(n,p):
 s=util.spec_from_file_location(n,p);o=util.module_from_spec(s);s.loader.exec_module(o);return o
orig=load('source_m5_B_stop_research',HERE/'render-2024-directional-long-short-search-20261024.py')
bank=json.loads((OUT/'RENDER_ALL_SIX_SHORT_CAUSAL_ENTRY_BANK_2024_2026AUG_20261024.json').read_text('utf8'))
contracts={}
for sl in (.015,.02,.025,.03,.035):
 bp=int(round(sl*1000))
 for mode,tp,hold,trigger,floor in (
  ('T15H6',.015,6,0,0),('T25H12',.025,12,0,0),
  ('T40H24',.04,24,0,0),('T40M15H18',.04,18,.015,.005),
  ('T40M25H24',.04,24,.025,.010),
  ('T50M25H24',.05,24,.025,.010)):
  name=f'BST{bp:02d}_{mode}'
  contracts[name]=(tp,sl,hold,trigger,floor)
def main():
 events=bank['events']
 keys={(x['symbol'],x['t']):x for x in events if B in x['shortSignals'] and x['causalFeatures']['oi3Pct']<=-.2}
 print('NEED_REPLAY',len(keys),'CONTRACTS',len(contracts),flush=True)
 n=0
 for bars,_btc,_metrics,_funding,symbol,_expiry in orig.source():
  t=[int(z[0]) for z in bars]
  for (coin,time),x in keys.items():
   if coin!=symbol:continue
   i=bisect.bisect_left(t,time)-1
   assert i>=2 and t[i]+orig.M5==time and t[i+1]==time
   for name,c in contracts.items():
    x['exitModels'][name]=orig.simulate(bars,i,'SHORT',c)
   n+=1
  print('PROCESSED',symbol,n,flush=True)
 assert n==len(keys)
 final={'status':'CAUSAL_RESEARCH_ONLY_B_REBOUND_SHORT_STOP_BRACKET_VARIANTS',
  'fromBank':'RENDER_ALL_SIX_SHORT_CAUSAL_ENTRY_BANK_2024_2026AUG_20261024.json',
  'BVariants':contracts,'policyCount':len(contracts),
  'replayed':n,'events':events,
  'warnings':['Only B exit regenerated; all other routes original',
    'Model historical M5 next-open stop-first, not live fills',
    'Data 2024 through 2026-08-09 was repeatedly studied; not OOS']}
 path=OUT/'RENDER_2024_2026_ALL_SIX_WITH_B_30_BRACKETS_M5_LEDGER_20261024.json'
 path.write_text(json.dumps(final,ensure_ascii=False,separators=(',',':'))+'\n','utf8')
 print('SAVED',path,'EVENTS',len(events),flush=True)
if __name__=='__main__':main()
