#!/usr/bin/env python3
"""Source-verified 2024 RENDERUSDT SHORT entry families, tested after 2024.
Research-only. Spot/RNDR history is NOT mixed into RENDERUSDT futures.
Baskets are stand-alone 5m-stop-first with 12h same symbol cooldown.
Results for 2024 Aug-Dec are model development, 2025 and 2026 historically
seen periods are retrospective validation, not independent pristine OOS.
"""
from __future__ import annotations
import collections,datetime as dt,hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
DEST=ROOT/'docs/research/results/render-three-regime-20261024'
DEST.mkdir(parents=True,exist_ok=True)
from importlib import util
def load(n,path):
 s=util.spec_from_file_location(n,path);m=util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('mfi2024',HERE/'render-orderflow-composite-20261024.py')
e=m.e
SPLITS=[
 ('train_2024_aug_dec','2024-08-10','2025-01-01'),
 ('early_2025_jan_mar','2025-01-01','2025-04-01'),
 ('late_2025_apr_jul','2025-04-01','2025-08-01'),
 ('recent_2025_aug_2026_aug','2025-08-10','2026-08-10'),
 ('weak_2026_jan_mar','2026-01-01','2026-04-01'),
 ('strong_2026_apr_aug','2026-04-01','2026-08-10')]
def basket(rows,tag,policy):
 selected=[];allow=-1
 for row in rows:
  if row['t']<allow or tag not in row['tags']:continue
  q=dict(row);q['policy']=policy;selected.append(q)
  allow=q['exits'][policy]['exitTs']+12*e.screen.HOUR
 return selected
def stats(rows):
 return {str(c):e.summarize(rows,c) for c in (10,30)}
def split_stats(rows):
 return {name:stats([x for x in rows if e.ms(start)<=x['t']<e.ms(end)])
  for name,start,end in SPLITS}
def main():
 manifest=json.loads((ROOT/'docs/research/results/render-orderflow-20261024/RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 assert all(x['expected']==x['valid'] for x in manifest['summary'].values())
 old=m.read_render_bars(manifest['files'],True);new=m.read_render_bars(manifest['files'],False)
 oldmani=json.loads((ROOT/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 oldbtc,_=e.old_mod.parse_months(oldmani,'BTCUSDT')
 native=e.imp('render2024_boot',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 source,_=native.native.m.m.core.task8.legacy.bootstrap()
 newbtc,_=source.getdata('BTCUSDT')
 older=e.prepare(old,oldbtc,e.OLD_BEGIN,e.CAL_END,'2024_2025_old')
 newer=e.prepare(new,newbtc,e.NEW_BEGIN,e.NEW_END,'2025_2026_new')
 report={'status':'RESEARCH_ONLY_2024_SHORT_ROUTE_YEAR_SPLIT',
 'warnings':['RENDERUSDT Binance perpetual listed 2024-07-26; old RNDRUSDT not spliced',
  '2024 development results may be in-sample; later periods previously researched',
  'Trading venue Aster not identical to Binance futures',
  'Independent single-sleeve strategies not eight-wallet dynamic replay'],
 'sourceManifest':'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json',
 'candidateCount':{'old':len(older),'new':len(newer)},
 'cohorts':SPLITS,'routes':{}}
 for tag in ('two_stage','bear_break','relative_top','btc_trap'):
  for policy in e.POLICIES:
   first=basket(older,tag,policy);next=basket(newer,tag,policy)
   combined=first+next
   key=f'{tag}__{policy}'
   report['routes'][key]=split_stats(combined)
   v=report['routes'][key]
   print('2024_FAMILY',key,'2024_30',v['train_2024_aug_dec']['30']['n'],
    v['train_2024_aug_dec']['30']['wrPct'],v['train_2024_aug_dec']['30']['pf'],
    '25Q1',v['early_2025_jan_mar']['30']['n'],v['early_2025_jan_mar']['30']['pf'],
    '25Q2',v['late_2025_apr_jul']['30']['n'],v['late_2025_apr_jul']['30']['pf'],
    '26',v['recent_2025_aug_2026_aug']['30']['n'],
    v['recent_2025_aug_2026_aug']['30']['pf'],flush=True)
 output=DEST/'RENDER_2024_FOUR_ROUTE_THREE_EXIT_CONDITIONAL_DIAGNOSTIC_20261024.json'
 output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('SAVED',output)
if __name__=='__main__':main()
