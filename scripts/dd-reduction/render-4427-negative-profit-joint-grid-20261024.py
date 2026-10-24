#!/usr/bin/env python3
"""Side-by-side RENDER #4427 causal M5 early loss + profit-preserving exits.
Apply variants to BTC-A and OI-B separately, both, and cross selected
initial-loss x profit rules; every case recomputes cooldown/ownership.
Historical 2024-26 only, NOT independent out-of-sample.
"""
from __future__ import annotations
import itertools,json,collections,math
from pathlib import Path
from importlib import util
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def load(n,p):
 s=util.spec_from_file_location(n,p);o=util.module_from_spec(s);s.loader.exec_module(o);return o
runner=load('render4427_ab_reroute_regime_engine',HERE/'render-six-short-entry-portfolio-priority-grid-20261024.py')
ab=runner.ab
json_bank=OUT/'RENDER_4427_INITIAL_NEGATIVE_AND_PROFIT_PROTECTION_M5_MODEL_BANK_20261024.json'
base_grid=json.loads((OUT/'RENDER_B_30_INITIAL_STOP_AND_ENTRY_PORTFOLIO_COHORT_GRID_20261024.json').read_text('utf8'))
base=next(c for c in base_grid['allCasesSummary'] if c['index']==4427)
A=ab.A;B=ab.B;X='SHORT_DEEP_DROP_FAILED_RETEST'
PRIORITY=base['priority']
BASE='E_NONE__P_BASE'
X_POLICY='TAKE15_STOP20_H6'
def name(e,p):return 'E_'+e+'__P_'+p
def stats(selected,cost):
 years={y:runner.stats([v for v in selected if ab.start[y]<=v['t']<ab.end[y]],cost)
        for y in ('2024','2025','2026')}
 parts={y:runner.stats([v for v in selected if lo<=v['t']<hi],cost)
        for y,(lo,hi) in ab.subperiods.items()}
 return {'years':years,'segments':parts,'overall':runner.stats(selected,cost)}
def candidate_rows(events,Aexit,Bexit):
 exits={A:Aexit,B:Bexit,X:X_POLICY}
 return runner.select(events,PRIORITY,exits)
def searchspace(E,P):
 cases={('NONE','NONE'):{'A':BASE,'B':BASE,'stage':'baseline'}}
 # early-only and profit-only: isolate A, isolate B, or both
 for item in E:
  if item=='NONE':continue
  x=name(item,'BASE')
  for scope in ('A','B','BOTH'):
   cases[('EARLY',item,scope)]={'A':x if scope!='B' else BASE,
     'B':x if scope!='A' else BASE,'stage':'early_only','mode':item,'scope':scope}
 for item in P:
  if item=='BASE':continue
  x=name('NONE',item)
  for scope in ('A','B','BOTH'):
   cases[('PROFIT',item,scope)]={'A':x if scope!='B' else BASE,
     'B':x if scope!='A' else BASE,'stage':'profit_only','mode':item,'scope':scope}
 # 1D combined: can attribute adverse stop vs profit protection separately
 for ea,pr in itertools.product(E,P):
  if ea=='NONE' or pr=='BASE':continue
  x=name(ea,pr)
  for scope in ('A','B','BOTH'):
   cases[('JOINT',ea,pr,scope)]={'A':x if scope!='B' else BASE,
     'B':x if scope!='A' else BASE,'stage':'joint','adverse':ea,'profit':pr,'scope':scope}
 # explicitly apply early loss to B and stronger profit to A (and reciprocal).
 for ea in E:
  if ea=='NONE':continue
  for pr in P:
   if pr=='BASE':continue
   cases[('CROSS',ea,pr,'A_PROFIT_B_LOSS')]={
       'A':name('NONE',pr),'B':name(ea,'BASE'),
       'stage':'cross_B_loss_A_profit','adverse':ea,'profit':pr}
   cases[('CROSS',ea,pr,'A_LOSS_B_PROFIT')]={
       'A':name(ea,'BASE'),'B':name('NONE',pr),
       'stage':'cross_A_loss_B_profit','adverse':ea,'profit':pr}
 return list(cases.values())
def pass_test(one,baseline):
 years=one['30']['years'];parts=one['30']['segments']
 old=baseline['30']['years'];oldP=baseline['30']['segments']
 n_good=all(years[y]['n']>=old[y]['n']-2 for y in years)
 everyyear_profit=all((years[y]['pf'] or 0)>1.05
         and years[y]['pnlPctSum']>0 and years[y]['compoundPct']>0 for y in years)
 protect=years['2025']['closeDdPct']>=old['2025']['closeDdPct']-.3
 improvedH2=(parts['25_AUG_DEC']['pf'] or 0)>oldP['25_AUG_DEC']['pf']+.15
 early2024=(parts['24_RNDR_JAN_MAY']['pf'] or 0)>1.0
 both_costs=all(one[str(c)]['overall']['compoundPct']>0 for c in (10,30))
 return {'everyYearProfit':everyyear_profit,'nMaintained':n_good,
   'no2025WorseDD':protect,'H2PFImproved15pts':improvedH2,
   '2024JanMayPFpositive':early2024,'10and30Positive':both_costs,
   'strict':all((everyyear_profit,n_good,protect,improvedH2,early2024,both_costs))}
def main():
 j=json.loads(json_bank.read_text('utf8'));assert j['status'].startswith('RESEARCH_ONLY')
 events=j['events']
 sentinel=candidate_rows(events,BASE,BASE)
 orig2024=runner.stats([v for v in sentinel if ab.start['2024']<=v['t']<ab.end['2024']],30)
 assert orig2024['n']==70 and orig2024['wr']==65.714 and orig2024['pf']==1.1579,(orig2024,base)
 baseline={str(cost):stats(sentinel,cost) for cost in (10,30)}
 print('BASE_4427',[(y,baseline['30']['years'][y]) for y in ('2024','2025','2026')],flush=True)
 candidates=searchspace(j['allEarlyModels'],j['allProfitModels'])
 print('GRID_CANDIDATES',len(candidates),flush=True)
 records=[]
 for i,c in enumerate(candidates):
  selected=candidate_rows(events,c['A'],c['B'])
  cur={str(cost):stats(selected,cost) for cost in (10,30)}
  gate=pass_test(cur,baseline)
  row={**c,'i':i,'gates':gate,'byCost':cur}
  records.append(row)
  if (i+1)%100==0:print('SCREEN_DONE',i+1,'/',len(candidates),
   'STRICT',sum(x['gates']['strict'] for x in records),flush=True)
 best=sorted(records,key=lambda x:(
   not x['gates']['strict'],
   -(x['byCost']['30']['segments']['25_AUG_DEC']['pf'] or 0),
   -min((x['byCost']['30']['years'][y]['pf'] or 0) for y in ('2024','2025','2026')),
   x['byCost']['30']['years']['2025']['closeDdPct']*(-1)
 ))
 print('EXAMINED',len(records),'STRICT',sum(x['gates']['strict'] for x in records))
 for x in best[:25]:
  print('LEADER',x['i'],x['stage'],x['A'],x['B'],
   'STRICT',x['gates']['strict'],
   'ANNUAL',[(y,v['n'],v['wr'],v['pf'],v['compoundPct'],v['closeDdPct'])
      for y,v in x['byCost']['30']['years'].items()],
   '2025H2',x['byCost']['30']['segments']['25_AUG_DEC'],
   '2024JANMAY',x['byCost']['30']['segments']['24_RNDR_JAN_MAY']['compoundPct'],
   flush=True)
 output={'status':'RESEARCH_ONLY_4427_CAUSAL_NEGATIVE_PROFIT_JOINT_SEARCH_IN_SAMPLE',
 'modelBank':json_bank.name,'caseCount':len(records),
 'baseline':baseline,'strictCount':sum(x['gates']['strict'] for x in records),
 'entryPriority':PRIORITY,'XExit':X_POLICY,
 'warnings':['Year 2024-2026 used in historical model selection, no untouched holdout.',
 '2026 Aug-Oct previously seen, retrospective evaluation only.',
 '5m exit modeled, not certified Aster order path',
 'Do not deploy without full8 10/30 and official live execution evidence'],
 'topResults':best[:60],
 'allModelSummaries':[{'i':v['i'],'stage':v['stage'],'A':v['A'],'B':v['B'],
   'gates':v['gates'],
   '30':{'year':{y:{k:v['byCost']['30']['years'][y][k]
          for k in ('n','wr','pf','compoundPct','closeDdPct','maxLossPct')}
          for y in ('2024','2025','2026')},
     'h2':v['byCost']['30']['segments']['25_AUG_DEC'],
     '2024JanMay':v['byCost']['30']['segments']['24_RNDR_JAN_MAY']},
   '10':{'year':{y:{k:v['byCost']['10']['years'][y][k] for k in ('n','wr','pf','compoundPct','closeDdPct')}
           for y in ('2024','2025','2026')},
     'h2':v['byCost']['10']['segments']['25_AUG_DEC']}}
      for v in records]}
 dest=OUT/'RENDER_4427_INITIAL_NEGATIVE_PROFIT_JOINT_2024_2026_GRID_20261024.json'
 dest.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n','utf8')
 print('SAVED',dest,flush=True)
if __name__=='__main__':main()
