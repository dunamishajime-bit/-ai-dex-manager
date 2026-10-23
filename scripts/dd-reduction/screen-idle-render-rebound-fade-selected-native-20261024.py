#!/usr/bin/env python3
"""Causal RENDER SHORT bounce/fade screen, selected + refused future-label summaries.
Every real portfolio performance claim REQUIRES separate dynamic 8-strategy rerun.
"""
from __future__ import annotations
import collections,datetime,hashlib,importlib.util,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path('C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8')
OUT=REPO/'docs/research/results/idle-entry-three-20261024'
SLATE=ROOT/'rv24IdleEntryComboBTCDOTJupRet3M1p5'
CASE='COMBO_BTC_DOT_JUP3_GE_M1P5'
SPLIT=int(datetime.datetime(2026,4,1,tzinfo=datetime.timezone.utc).timestamp()*1000)
def load(name,p):
 spec=importlib.util.spec_from_file_location(name,p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
r=load('render_rebound_rules',HERE/'research-idle-render-rebound-fade-20261024.py')
legacy=load('render_rebound_legacy',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
def checksum(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for c in iter(lambda:f.read(1<<20),b''):h.update(c)
 return h.hexdigest()
def latest(cost):
 manifest=json.loads((SLATE/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json').read_text('utf8'))
 sha=manifest['cases'][CASE]['costs'][str(cost)]['ledgerSha256']
 for p in (SLATE/'engine').rglob('portfolio-trades.jsonl'):
  if checksum(p)==sha:return p,sha
 raise RuntimeError(('UNMATCHED_LEDGER',cost,sha))
def metric(data):
 n=len(data);w=sum(x['win'] for x in data)
 return {'n':n,'wins':w,'wr':round(100*w/n,2) if n else None,
   'netReturnSumPct':round(sum(x['ret'] for x in data),4)}
def main():
 source,_=legacy.native.m.m.core.task8.legacy.bootstrap()
 result={'status':'RESEARCH_STATIC_COHORT_ONLY_NO_LIVE_OR_FULL8_RESELECTION',
  'selectedAnchor':CASE,'costs':{},'temporalSplit2026':'2026-04-01',
  'warning':'Ex-post exit estimates for rejected portfolio candidates are NOT achievable live without ownership and full8 capital replay; all sample is researched in-sample.'}
 for cost in (10,30):
  file,sha=latest(cost)
  chosen={x['candidate_id']:x for x in (json.loads(z) for z in file.read_text('utf8').splitlines())
    if x.get('strategy_id')=='IDLE' and x.get('symbol')=='RENDERUSDT'}
  rows=[]
  with (file.parent/'candidate-decisions.jsonl').open('r',encoding='utf8') as stream:
   for line in stream:
    z=json.loads(line)
    if z.get('strategy_id')!='IDLE' or z.get('symbol')!='RENDERUSDT':continue
    entry=float(z['candidate_entry_price_usd']);exit=float(z['candidate_exit_price_usd'])
    if entry<=0 or exit<=0:continue
    features=r.get(source,'RENDERUSDT',int(z['entry_ts_ms']))
    assert features is not None,(cost,z['candidate_id'],'MISSING_CAUSAL_BARS')
    isChosen=z['candidate_id'] in chosen
    priceReturn=100*(entry-exit)/entry-cost/100
    rows.append({'id':z['candidate_id'],'ts':int(z['entry_ts_ms']),
      'features':features,'win':(chosen[z['candidate_id']]['total_pnl_jpy']>0) if isChosen else priceReturn>0,
      'ret':priceReturn,
      'selected':isChosen,'decisionReason':z['reason'],
      'exitReason':z.get('candidate_exit_reason')})
  assert sum(x['selected'] for x in rows)==len(chosen)
  results={}
  for name in r.NAMES:
   chosenRows=[x for x in rows if x['selected']]
   allGood=[x for x in rows if r.rule_accept(x['features'],name)]
   selectedGood=[x for x in chosenRows if r.rule_accept(x['features'],name)]
   selectedBad=[x for x in chosenRows if not r.rule_accept(x['features'],name)]
   earlier=[x for x in selectedGood if x['ts']<SPLIT]
   later=[x for x in selectedGood if x['ts']>=SPLIT]
   d={'selected':metric(selectedGood),'selectedRejects':metric(selectedBad),
      'selectedRetainedPct':round(100*len(selectedGood)/len(chosenRows),3),
      'candidateAcceptedByGate':metric(allGood),'candidateTotal':len(rows),
      'earlierSelected':metric(earlier),'laterSelected':metric(later),
      'selectedExitReasons':dict(collections.Counter(x['exitReason'] for x in selectedGood))}
   results[name]=d
   print('COST',cost,'RULE',name,'SELECTION',d['selected'],'RETAIN',d['selectedRetainedPct'],
     'REJECTED_SELECTED',d['selectedRejects'],'CANDIDATES',len(allGood),'EARLIER',d['earlierSelected'],'LATER',d['laterSelected'],flush=True)
  result['costs'][str(cost)]={'ledgerSha256':sha,'selectedCount':len(chosen),'rawCandidates':len(rows),'rules':results}
 file=OUT/'IDLE_RENDER_REBOUND_FADE_PREALLOCATION_SCREEN_20261024.json'
 file.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('RESULT_SAVED',file,file.stat().st_size)
if __name__=='__main__':main()
