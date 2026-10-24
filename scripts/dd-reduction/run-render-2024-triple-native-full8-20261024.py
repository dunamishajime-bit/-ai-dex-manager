#!/usr/bin/env python3
"""RESEARCH ONLY: Inject two independent, causally sourced RENDER H1 entry
routes into the exact frozen eight-strategy native shared-wallet candidate
selection, leaving all preexisting candidates, rules, limits and exits
unchanged. This is NOT a blend of standalone portfolio PnL.

Input is the precomputed verified frozen H1+M5 market-bank 2025-08-10 through
2026-08-10, researched from public Binance Vision. New modeled candidates
have unique routes under existing IDLE 0.25x owner; no post-admission override.
Native engine must decide lock, capacity, ownership, margin, shared portfolio.
No production/VPS/HP or actual orders touched.
"""
from __future__ import annotations
import argparse,bisect,collections,datetime as dt,hashlib,importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
R=HERE.parents[1]
def load(n,path):
 spec=importlib.util.spec_from_file_location(n,path)
 x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x);return x
study=load('triple2024_native_previous_engine',HERE/'run-render-two-regime-native-full8-20261024.py')
previous=study.previous
kernel=study.kernel
core_filter=study.core_native_filter
assert kernel.entry_filter is study.dual_filter
BANK=R/'docs/research/results/render-three-regime-20261024/RENDER_2024_FRESH_LONG_SHORT_12_ENTRY_7_EXIT_SCREENER_20261024.json'
BASE_CASE='RENDER_PROFIT_F035_JUP_M1P5'
NEW_CASES={
 'RENDER_TRI_ALPHA_BTC_TRAP_OI06_ADD':{'oi3':-.6,'trap':True,'bear':True},
 'RENDER_TRI_ALPHA_BTC_TRAP_OI02_ADD':{'oi3':-.2,'trap':True,'bear':True},
 'RENDER_TRI_ALPHA_BTC_TRAP_ONLY_ADD':{'oi3':None,'trap':True,'bear':False},
 'RENDER_TRI_ALPHA_BEAR_OI06_ONLY_ADD':{'oi3':-.6,'trap':False,'bear':True}}
for case in NEW_CASES:
 previous.CASE_RULES[case]={key:list(val) for key,val in previous.CASE_RULES[BASE_CASE].items()}
 previous.PROFIT_FLOOR[case]=.0035
bank=json.loads(BANK.read_text('utf8'))
assert bank['status'].startswith('RESEARCH_ONLY') and len(bank['dualShortResearchSignalEvents'])==263
# The frozen Aster H1 mark ledger for RENDER begins only 2026-01-06.
# Never fabricate mark data in native wallet replay. Existing other seven
# strategies and earlier RENDER B candidates are otherwise preserved.
START=1767830400000;END=1786320000000
records=[r for r in bank['dualShortResearchSignalEvents'] if
 r['symbol']=='RENDERUSDT' and START<=int(r['t'])<END]
assert len(records)>40 and len({r['t'] for r in records})==len(records)
records.sort(key=lambda x:x['t'])
# new modeled routes were first defined and their external Aug-Oct data
# were checked *without changing these 2025-2026 candidate conditions.*
audit=collections.defaultdict(lambda:collections.Counter())
chosen_ids=collections.defaultdict(set)
STATE={'case':None}
def research_new_rows(source,cost_bps):
 case=STATE['case'];c=NEW_CASES[case]
 native_bars,native_times=source.getdata('RENDERUSDT')
 out=[]
 counted=collections.Counter()
 for event in records:
  feats=event['causalFeatures']
  trap=('SHORT_2024_BTC_RALLY_FAILURE' in event['signals']) and c['trap']
  bear=('SHORT_BEAR_REBOUND_2H_FADE' in event['signals']) and c['bear'] and feats['oi3Pct']<=c['oi3']
  if not trap and not bear:continue
  t=int(event['t'])
  idx=bisect.bisect_left(native_times,t)
  if idx<1 or idx>=len(native_times) or int(native_times[idx])!=t or int(native_times[idx-1])+300000!=t:
   raise RuntimeError(('NEW_CAUSAL_NATIVE_H1_M5_ENTRY_UNAVAILABLE',t))
  px=float(native_bars[idx][1])
  assert px>0 and math.isfinite(px)
  ex=event['exitModel30']
  exit_ts=int(ex['exitTs'])
  assert t<exit_ts<=t+24*3600000+300000,(t,exit_ts)
  raw_return=float(ex['net30'])+.30
  # Source bank exitModel30 is full SHORT path WITHOUT trade commission
  # except -0.30 percentage points model round-trip. Native exchange
  # engine charges 10/30bps itself. Thus reconstruct RAW price.
  exit_px=px*(1-raw_return/100)
  assert exit_px>0 and math.isfinite(exit_px)
  owner='TRAP' if trap else 'BEAR_OI'
  route='IDLE_RENDER_TRI_2024_BTC_TRAP_SHORT' if trap else 'IDLE_RENDER_TRI_OI3_BEAR_REBOUND_SHORT'
  key=(t,route)
  # Same candidate can be evaluated in all three dynamic wallet replay phases.
  # Repeat observations are expected; count DISTINCT research events only.
  chosen_ids[(case,cost_bps)].add(key)
  row={
    'status':'MODELED_CLOSED_TRADE',
    'strategy_id':'IDLE','symbol':'RENDERUSDT','side':'SHORT',
    'route':route,'signal_ts_ms':t,'entry_ts_ms':t,'entry_price':px,
    'exit_ts_ms':exit_ts,'exit_price':exit_px,'exit_reason':'RESEARCH_TRI_'+str(ex['reason']),
    'unit_price_return':float(raw_return)/100,
    'requested_gross':.25,
    'priority':0,
    'generic_accepted':True,
    'route_selected':True,
    'overlay_source_current':True,
    'research_causal_source':'BINANCE_VISION_2024_TRIPLE_20261024',
    'research_new_route_group':owner,
    'funding_return_per_gross':0.,
    'ambiguous_bar':False,
    'source_runtime_sha':'RESEARCH_ONLY_H1_M5_TRIPLE_20261024',
  }
  out.append(row)
  counted[owner]+=1
 audit[(case,cost_bps)].update(counted)
 return out
def injection_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
 current=core_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
 added=research_new_rows(source,cost_bps)
 # Never promote existing filled rows, change other contracts,
 # alter current risk lock, or suppress incumbent entries.
 current_keys={(str(r.get('strategy_id')),str(r.get('symbol')),int(r['entry_ts_ms']),
               str(r.get('route'))) for r in current}
 for row in added:
  key=(str(row['strategy_id']),str(row['symbol']),int(row['entry_ts_ms']),str(row['route']))
  if key in current_keys:raise RuntimeError(('NEW_SIGNAL_COLLIDES_SAME_ROUTE',key))
 obs['renderTripleNewCandidateAppended']=len(added)
 obs['renderTripleExistingCandidatesPreserved']=len(current)
 if len(added)<25:raise RuntimeError(('INSUFFICIENT_NEW_NATIVE_CANDIDATES',len(added)))
 print('TRIPLE_NATIVE_H1_PRE_WALLET_INJECTION',STATE['case'],cost_bps,
  'baseline',len(current),'new',len(added),'by_route',dict(audit[(STATE['case'],cost_bps)]),flush=True)
 return [*current,*added]
kernel.entry_filter=injection_filter
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--case',choices=list(NEW_CASES),required=True)
 args=parser.parse_args()
 assert R not in (args.output.resolve(),*args.output.resolve().parents)
 assert args.output.resolve().as_posix().lower().startswith('c:/tmp/')
 args.output.mkdir(parents=True,exist_ok=True)
 STATE['case']=args.case
 study.STATE['cache'].clear()
 before=list(sys.argv)
 try:
  sys.argv=[str(HERE/'run-idle-three-entry-native-full8-20261024.py'),
    '--output',str(args.output/args.case),'--case',args.case]
  previous.main()
 finally:sys.argv=before
 audits={str(cost):{
   'newByRoute':dict(audit[(args.case,cost)]),
   'candidateUniqueKeys':len(chosen_ids[(args.case,cost)])}
   for cost in (10,30)}
 document={'status':'RESEARCH_ONLY_FULL8_EIGHT_STRATEGY_DYNAMIC_NATIVE_NEW_H1_ENTRY_MODEL',
  'case':args.case,'rules':NEW_CASES[args.case],
  'background':'Incumbent RENDER native B kept unchanged; two new H1-short routes added under current IDLE .25 gross research budget, not fake existing trades',
  'costs':audits,'candidateBankSource':str(BANK),
  'riskContract':'Original 8-logic shared-account owner, slots, gross and candidate reselection are NOT patched here.',
  'limitations':['Binance market proxy for Aster actual lifecycle; funding zero for the two new modeled candidate routes',
   'Research explores multiple historical thresholds; no prospective untouched OOS',
   'The full-wallet engine must report ACTUAL accepted/rejected new entries and accounting',
   'No Production/VPS/HP or account orders modified']}
 (args.output/(args.case+'_new_native_evidence.json')).write_text(
  json.dumps(document,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('FULL8_TRI_H1_RUN_FINISHED',args.case,audits,flush=True)
if __name__=='__main__':main()
