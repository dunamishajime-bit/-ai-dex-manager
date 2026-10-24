#!/usr/bin/env python3
"""RESEARCH ONLY / NO LIVE. High-win-rate independent RENDER SHORT Native8 replay.
2026 independent candidates are chosen with as-of expanding *closed shadow*
performance, one symbol owner, causal wick/H1 and BTC divergence conditions.
Only isolated research-wallet admission is modified for this exact route.
All other core IDs, incumbent #4427 model rows, shared margin and stop remain.
"""
from __future__ import annotations
import argparse,bisect,collections,hashlib,importlib.util,json,math,sys
from pathlib import Path
ROOT=Path('C:/tmp')
HERE=ROOT/'render-mtf-study-20261024'
ORIG=HERE/'run_render_4427_independent_profit_sell55_native8_20261024.py'
POLICY_JSON=ROOT/'render4427-independent-gates-audit-20261024/docs/research/results/render4427-scoped-priority-native8-20261024/RENDER_4427_HIGHWR_EXPANDING_CAUSAL_ASOF_OWNER_20261025.json'
SCOPED_SOURCE=HERE/'render_4427_priority_native8_source_patch_v3_20261024.py'
spec=importlib.util.spec_from_file_location('highwr_indep_4427_native8_runner',ORIG)
runner=importlib.util.module_from_spec(spec);sys.modules[spec.name]=runner;spec.loader.exec_module(runner)
source_spec=importlib.util.spec_from_file_location('r4427_scoped_previous_source',SCOPED_SOURCE)
# Do not import the previous scoped source because importing runs its full research suite.
source_text=SCOPED_SOURCE.read_text('utf8')
import ast
tree=ast.parse(source_text)
INSERT=next(ast.literal_eval(x.value) for x in tree.body if isinstance(x,ast.Assign)
            and any(isinstance(t,ast.Name) and t.id=='INSERT' for t in x.targets))
OLD_ROUTE='IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT'
NEW_ROUTE='IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT'
assert INSERT.count(OLD_ROUTE)==1
new_insert=INSERT.replace(OLD_ROUTE,NEW_ROUTE)
NEWCASE='RENDER_4427_HIGHWR_WICK_SHARP_S6_CAUSAL_NATIVE8_20261025'
data=json.loads(POLICY_JSON.read_text('utf8'))
case=next(x for x in data['cases'] if x['gate']=='WICK_SHARP_S6' and x['policy']=='expanding_highwr')
assert case['independentPerf']['30']['n']==12 and case['independentPerf']['30']['wins']==11
selected=sorted(case['accepted2026'],key=lambda r:r['t'])
assert len(selected)==6 and sum(x['net30']>0 for x in selected)==5
assert all(x['overlapCandidates']==0 for x in selected)
native=runner.native
previous=runner.previous
original_bootstrap=native.study.previous.native.m.m.core.task8.legacy.bootstrap
core=native.study.previous.native.m.m.core
previous.CASE_RULES[NEWCASE]={k:list(v) for k,v in previous.CASE_RULES[runner.case].items()}
previous.PROFIT_FLOOR[NEWCASE]=previous.PROFIT_FLOOR[runner.case]
native.NEW_CASES[NEWCASE]=dict(native.NEW_CASES[runner.case])
runner.case=NEWCASE
runner.result={'addedIndependents':case['selectedIndependent']}
runner.forward_new=[{'sym':'RENDERUSDT','t':x['t'],'family':'BTC_RENDER_DIVERGE_WICK_SHARP_S6',
                      'exit':'S6','exitTs':x['t']+6*3600000,'net30':x['net30'],
                      'score':x['score']} for x in selected]
origshadow=json.loads((HERE/'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz').read_bytes().hex()[:0] or '{}') if False else None
# Exact shadow EXIT timestamps are sourced from verified original all-H1 bank, not estimated +6h.
import gzip
with gzip.open(HERE/'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz','rt',encoding='utf8') as stream:
 bank=json.load(stream)['rows']
by_ts={}
for row in bank:
 if row['sym']!='RENDERUSDT':continue
 c=next((x for x in row['candidates'] if x['family']=='BTC_RENDER_DIVERGE' and x['exit']=='S6'),None)
 if c:by_ts[row['t']]=c
for row in runner.forward_new:
 orig=by_ts[row['t']]
 assert abs(row['net30']-orig['net30'])<1e-6,(row,orig)
 row['exitTs']=orig['exitTs']
 assert row['t']<row['exitTs']<=row['t']+6*3600000+300000
runner.seen=collections.defaultdict(set)
runner.counters=collections.defaultdict(collections.Counter)
inj_times=collections.defaultdict(list)
def injection(source,cost_bps):
 old=runner.base.generate_model_rows(source,cost_bps)
 mark,idx=source.getdata('RENDERUSDT')
 old_times={int(q['entry_ts_ms']) for q in old}
 out=[]
 for event in runner.forward_new:
  t=int(event['t'])
  assert t not in old_times,('SAME_H1_COMPETITION_NOT_ACTUALLY_RESOLVED',t)
  i=bisect.bisect_left(idx,t)
  assert 1<=i<len(idx) and int(idx[i])==t and int(idx[i-1])+300000==t,('ASTER_NATIVE_H1_MARK_REQUIRED',t)
  price=float(mark[i][1]); assert price>0 and math.isfinite(price)
  raw=float(event['net30'])+.30
  exitpx=price*(1-raw/100)
  assert exitpx>0 and math.isfinite(exitpx)
  out.append({'status':'MODELED_CLOSED_TRADE','strategy_id':'IDLE','symbol':'RENDERUSDT','side':'SHORT',
    'route':NEW_ROUTE,'signal_ts_ms':t,'entry_ts_ms':t,'entry_price':price,
    'exit_ts_ms':int(event['exitTs']),'exit_price':exitpx,
    'exit_reason':'RESEARCH_HIGHWR_BTC_DIVERGE_H1_WICK_S6_TP15_STOP20',
    'unit_price_return':raw/100,'requested_gross':.25,'priority':0,
    'generic_accepted':True,'route_selected':True,'overlay_source_current':True,
    'research_causal_source':'OFFICIAL_BINANCE_M5_COMPLETED_H1_WICK35_SHARP05_EXPANDING_CLOSED_SHADOW_ASOF',
    'research_new_route_group':'BTC_RENDER_DIVERGE_WICK_SHARP',
    'funding_return_per_gross':0.,'ambiguous_bar':False,
    'source_runtime_sha':'RESEARCH_ONLY_RENDER_4427_WINRATE_CAUSAL_20261025'})
  inj_times[cost_bps].append(t)
  runner.seen[cost_bps].add((t,NEW_ROUTE))
  runner.counters[cost_bps]['new_independent_highwr']+=1
 print('RENDER_HIGHWR_NATIVE8_INJECT',cost_bps,'incumbent42',len(old),'new6',len(out),flush=True)
 assert len(out)==6
 return [*old,*out]
native.research_new_rows=injection
def scoped_bootstrap():
 source,helper=original_bootstrap()
 base=helper.base
 orig_patch=base.BASE_ADMISSION_PATCH
 def patch(src,strict):
  patched=orig_patch(src,strict)
  marker='            for candidate in rows:\n'
  assert patched.count(marker)==1 and '_prepare_overlay(rows, active' in patched
  return patched.replace(marker,new_insert+marker,1)
 base.BASE_ADMISSION_PATCH=patch
 return source,helper
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True)
 args=ap.parse_args()
 assert args.output.resolve().as_posix().lower().startswith('c:/tmp/')
 args.output.mkdir(parents=True,exist_ok=True)
 core.task8.legacy.bootstrap=scoped_bootstrap
 oldargv=list(sys.argv)
 try:
  sys.argv=[str(ORIG),'--output',str(args.output)]
  runner.main()
 finally:
  core.task8.legacy.bootstrap=original_bootstrap
  sys.argv=oldargv
 evidence={'status':'RESEARCH_ONLY_HIGHWR_CAUSAL_6_CANDIDATES_NATIVE8',
    'runDateJST':'2026-10-25','sourcePolicySha256':hashlib.sha256(POLICY_JSON.read_bytes()).hexdigest(),
    'ownerSourceSha256':hashlib.sha256(SCOPED_SOURCE.read_bytes()).hexdigest(),
    'modelRoute':NEW_ROUTE,'case':NEWCASE,'highWinRule':'BTC_RENDER_DIVERGE, H1 close down >=0.5%, upper wick >=35%, expanding high-WR gate using only closed shadow history, 6h S6 fixed bracket',
    'newResearchCandidateDates':[{'t':x['t'],'net30':x['net30'],'exitTs':x['exitTs'],'score':x['score']} for x in runner.forward_new],
    'injectionCountsByCost':{str(k):len(v) for k,v in inj_times.items()},
    'riskContract':'Native8 existing gross/symbol owner/account/stop/margin logic unchanged, research-only scoped coexistence with non-RENDER active core at effective gross room >=0.25x',
    'limitations':['H1 price-filling and Binance 5-minute modeled bracket exits, NOT Aster real signed fills',
      'Funding for new trades assumed zero, no pending or venue partial fill parity',
      'No pristine out-of-sample data, 4629 retrospectively screened combinations',
      'Any incumbent same-time conflict triggers fail-closed, never score replacements in Native8',
      'No LIVE, VPS, Production, HP or external order was modified']}
 dst=args.output/(NEWCASE+'_true_scope_audit.json')
 dst.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n','utf8')
 print('HIGHWR_NATIVE8_DONE',dst,flush=True)
if __name__=='__main__':main()
