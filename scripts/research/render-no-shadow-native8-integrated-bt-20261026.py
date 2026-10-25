#!/usr/bin/env python3
"""Research only: approved legacy -1% watch and independent exact-M5 55m,
in *one* unchanged Native8 dynamic wallet. Scoped owner experiment, not LIVE.
"""
import argparse,bisect,collections,importlib.util,json,math,sys
from pathlib import Path
ROOT=Path('C:/tmp/render-dual-preflight-native8-20261025')
DD=Path('C:/tmp/render-multiregime-study-20261024/scripts/dd-reduction')
def load(label,path):
 s=importlib.util.spec_from_file_location(label,path)
 m=importlib.util.module_from_spec(s);sys.modules[label]=m;s.loader.exec_module(m);return m
m=load('dual_render_existing_watch_native8',DD/'run-idle-render-after-pengu-full8-20261024.py')
EVIDENCE=json.loads((ROOT/'RENDER_NO_SHADOW_EXIT_HOLD_COMPARISON_20261026.json').read_text(encoding='utf8'))
assert EVIDENCE['status']=='RESEARCH_PUBLIC_BINANCE_OFFICIAL_M5_NO_SHADOW_QUALITY_GATE'
ROUTE='IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT'
signals={}
CASE=None
def configure(case_id):
 global CASE,signals
 matches=[v for v in EVIDENCE['cases'] if v['id']==case_id]
 if len(matches)!=1:raise RuntimeError(('NO_SUCH_CASE',case_id))
 CASE=matches[0]
 signals={int(x['entryTs']):x for x in CASE['trades']}
 assert signals and len(signals)==len(CASE['trades'])
 assert not CASE['unresolved']

native=m.native
kernel=native.m.m
original_filter=kernel.entry_filter
previous=m.idle_filter
source_core=native.m.m.core
old_bootstrap=source_core.task8.legacy.bootstrap
counters=collections.Counter()
def with_independent(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
 counters["entry_filter_called"]+=1
 current=previous(rows,overlays,source,cost_bps,obs,baseline_lookup)
 data,times=source.getdata('RENDERUSDT')
 extra=[]
 for t,x in signals.items():
  i=bisect.bisect_left(times,t)
  if i<1 or i>=len(times) or int(times[i])!=t or int(times[i-1])+300000!=t:
   # No invented history: if Aster has no compatible mark, new route blocked.
   counters['Aster_mark_missing']+=1;continue
  entry=float(data[i][1])
  if not math.isfinite(entry) or entry<=0:raise RuntimeError(('MODEL_INVALID_ASTER_MARK',t))
  raw=float(x['grossPct'])
  exitpx=entry*(1-raw/100)
  if exitpx<=0:raise RuntimeError(('MODEL_EXIT_INVALID',t))
  extra.append(dict(status='MODELED_CLOSED_TRADE',strategy_id='IDLE',symbol='RENDERUSDT',
   side='SHORT',route=ROUTE,signal_ts_ms=t,entry_ts_ms=t,entry_price=entry,
   exit_ts_ms=int(x['exitTs']),exit_price=exitpx,
   exit_reason='RESEARCH_NO_SHADOW_'+CASE['id']+'_'+str(x['reason']),
   unit_price_return=raw/100,requested_gross=.25,priority=0,
   generic_accepted=True,route_selected=True,overlay_source_current=True,
   research_causal_source='BINANCE_OFFICIAL_M5_NO_LOOKAHEAD_OI_NOT_REQUIRED',
   research_new_route_group='RENDER_NO_SHADOW_'+CASE['id'],
   funding_return_per_gross=0.,ambiguous_bar=False,
   source_runtime_sha='RESEARCH_ONLY_NO_LIVE_RENDER_DUAL_20261025'))
 counters['signal_eligible_at_native_input']+=len(extra)
 obs['newRenderDualPreWallet']=len(extra)
 return [*current,*extra]
kernel.entry_filter=with_independent
original_source_batch=None
def scoped_bootstrap():
 global original_source_batch
 counters["bootstrap_called"]+=1
 source,helper=old_bootstrap()
 gate=helper.base.s.w.base
 if original_source_batch is None:
  original_source_batch=gate.source_batch
  assert original_source_batch.__name__=='source_batch'
 gate.source_batch=scoped_source
 return source,helper
def scoped_source(rows,active,completed,ts,market,equity,gross,finalize,lifecycle):
 original_source_batch(rows,active,completed,ts,market,equity,gross,finalize,lifecycle)
 for row in rows:
  if row.get('route')!=ROUTE:continue
  counters['seen']+=1
  if str(row.get('_overlay_block'))!='CORE_SIGNAL_OR_POSITION':
   counters['core_not_special_case_'+str(row.get('_overlay_block'))]+=1;continue
  if active:
   counters['baseline_account_not_flat']+=1;continue
  if any(o is not row and o.get('symbol')==row.get('symbol')
         and not o.get('_overlay_block') for o in rows):
   counters['legacy_render_incumbent_wins']+=1;continue
  if any(o is not row and o.get('strategy_id')!='IDLE'
         and not o.get('_overlay_block') for o in rows):
   counters['same_ts_core_higher_priority']+=1;continue
  if ts<int(lifecycle.get('RENDERUSDT',0)):
   counters['render_symbol_cooldown']+=1;continue
  if not all(row.get(k) is True for k in ('generic_accepted','route_selected','overlay_source_current')):
   counters['unproven_source']+=1;continue
  if float(row.get('requested_gross',0))!=.25:
   counters['wrong_gross']+=1;continue
  eq=float(equity())
  if eq<=0:counters['equity_nonpositive']+=1;continue
  total=sum(gross(v,eq) for v in active.values())
  if 4.25-total+1e-9<.25:
   counters['capacity_block']+=1;continue
  row['_overlay_block']=None
  counters['independent_released_to_native_owner']+=1
source_core.task8.legacy.bootstrap=scoped_bootstrap
def run(output):
 case="RENDER_TOUCH1_WATCH2_MFE0P25"
 m.ACTIVE["case"]=case
 m.base.CASES={case:{"longRules":[],"longScope":"BOTH"}}
 kernel.entry_filter=with_independent
 before=sys.argv
 try:
  sys.argv=[str(DD/"research-pengu-combined-normal8-recovery24-full8-20261024.py"),
     "--output",str(output),"--cases",case]
  m.cumulative.main()
 finally:
  sys.argv=before
  kernel.entry_filter=original_filter
  source_core.task8.legacy.bootstrap=old_bootstrap
 if counters["entry_filter_called"]<2 or counters["bootstrap_called"]<1 or counters["signal_eligible_at_native_input"]<2:
  raise RuntimeError(("DUAL_RENDER_REPLAY_INJECTION_NOT_VERIFIED",dict(counters)))
if __name__=='__main__':
 parser=argparse.ArgumentParser()
 parser.add_argument('--output',required=True,type=Path)
 parser.add_argument('--variant',required=True)
 a=parser.parse_args()
 configure(a.variant)
 if not a.output.resolve().as_posix().lower().startswith('c:/tmp/'):raise RuntimeError('RESEARCH_OUTPUT_ONLY_TMP')
 a.output.mkdir(parents=True,exist_ok=True)
 old=list(sys.argv)
 try:
  sys.argv=[str(DD/'run-idle-render-after-pengu-full8-20261024.py'),
            '--output',str(a.output),'--case','RENDER_TOUCH1_WATCH2_MFE0P25']
  run(a.output)
 finally:sys.argv=old
 report={'status':'RESEARCH_ONLY_NATIVE8_COMBINED_BOTH_RENDER_NOT_PRODUCTION_PARITY',
 'existingStop':'TOUCH1_WATCH2_MFE0P25','independentRoute':ROUTE,
 'newModelAsOfSignals':len(signals),'counters':dict(counters),'output':str(a.output),
 'fundingNewModel':'ZERO_ASSUMPTION','variant':CASE['id'],
 'safety':'Original eight-wallet shared funds/core precedence preserved. Scoped release when completely flat and without same-time higher-ranked signal.'}
 dest=ROOT/('RENDER_NOSHADOW_NATIVE8_'+CASE['id']+'_EVIDENCE_20261026.json')
 dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('DUAL_RENDER_INTEGRATED_MODEL_DONE',str(dest),dict(counters),flush=True)
