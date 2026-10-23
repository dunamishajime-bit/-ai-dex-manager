#!/usr/bin/env python3
"""Audit every PENGU LONG comparison under SHORT dual adopted baseline, exact-ledger parity."""
from __future__ import annotations
import hashlib,collections,json
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
DIRS=(ROOT/'rv24penguLongNativeV2',ROOT/'rv24penguLongNativeV3',ROOT/'rv24penguLongNativeRecoveryIsolated')
SHORTREF=REPO/'docs/research/results/pengu-timed-negative-20261023/PENGU_TIMED_NEGATIVE_NATIVE_FULL8_COMBINED_20261023.json'
DEST=REPO/'docs/research/results/pengu-long-20261024/PENGU_LONG_CUMULATIVE_NATIVE_FULL8_AUDIT_20261024.json'
def sha(f):
 h=hashlib.sha256()
 with f.open('rb') as z:
  for chunk in iter(lambda:z.read(1048576),b''):h.update(chunk)
 return h.hexdigest()
def main():
 prior=json.loads(SHORTREF.read_text('utf8'))['cases']['SHORT_AT3_MINUS2P5_OR_AT8_MINUS4']['costs']
 combined={}
 for root in DIRS:
  d=json.loads((root/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json').read_text('utf8'))
  assert set(d['costsBps'])=={10,30}
  for k,v in d['cases'].items():
   if set(v['costs'])!={'10','30'}:
    print('SKIP_INCOMPLETE_CASE',k,root.name,list(v['costs']),flush=True)
    continue
   assert k not in combined,(k,root.name)
   combined[k]=v
 base=combined['SHORT_DUAL_BASE']['costs']
 for cost in ('10','30'):
  for k in ('closedTrades','penguN','penguWins','penguTimedStops','penguTimedShortStops'):
   assert prior[cost][k]==base[cost][k],('REFERENCE_PARITY',cost,k)
  for k in ('finalEquityJpy','ddPct'):
   assert abs(prior[cost][k]-base[cost][k])<1e-7,('ECON_PARITY',cost,k)
 print('BASELINE_SHORT_DUAL_ECONOMICS_MATCH_10_30BPS',flush=True)
 # The research-case name is intentionally embedded in PENGU SHORT soft-exit reasons.
 # File-byte hashes differ: prove ALL transaction fields equal after only renaming those reasons.
 def match_reference_ledger(digest_id,cost):
  for f in (ROOT/'rv23penguTimeNativeCombo'/'engine').rglob('portfolio-trades.jsonl'):
   if sha(f)==digest_id:
    return [json.loads(x) for x in f.read_text('utf8').splitlines()]
  raise RuntimeError(('MISSING_ORIGINAL_SHORT_LEDGER',cost,digest_id))
 def match_current_ledger(digest_id):
  for f in (ROOT/'rv24penguLongNativeV2'/'engine').rglob('portfolio-trades.jsonl'):
   if sha(f)==digest_id:
    return [json.loads(x) for x in f.read_text('utf8').splitlines()]
  raise RuntimeError(('MISSING_CURRENT_SHORT_LEDGER',digest_id))
 for cost in ('10','30'):
  left=match_reference_ledger(prior[cost]['ledgerSha256'],cost)
  right=match_current_ledger(base[cost]['ledgerSha256'])
  assert len(left)==len(right)
  n_renamed=0
  for i,(z0,z1) in enumerate(zip(left,right)):
   z=dict(z0)
   for k in ('exit_reason_actual','planned_exit_reason'):
    if isinstance(z.get(k),str) and 'RESEARCH_PENGU_TIMED_NEGATIVE_SHORT_AT3_MINUS2P5_OR_AT8_MINUS4' in z[k]:
     z[k]=z[k].replace('RESEARCH_PENGU_TIMED_NEGATIVE_SHORT_AT3_MINUS2P5_OR_AT8_MINUS4','RESEARCH_PENGU_TIMED_NEGATIVE_SHORT_DUAL_BASE')
     if k=='exit_reason_actual':n_renamed+=1
   assert z==z1,('ECONOMIC_LEDGER_MISMATCH_NOT_CASE_LABEL',cost,i,
                   {k:(z.get(k),z1.get(k)) for k in set(z)|set(z1) if z.get(k)!=z1.get(k)})
  assert n_renamed==2,(cost,n_renamed)
  print('SHORT_DUAL_NORMALIZED_LEDGER_PARITY_PASS',cost,'trades',len(left),'reasonLabelsRenamed',n_renamed,flush=True)
 indexed={}
 for root in DIRS:
  for f in (root/'engine').rglob('portfolio-trades.jsonl'):
   indexed.setdefault(sha(f),f)
 loaded={}
 def rows(h):
  if h not in loaded:
   assert h in indexed,('MISSING_LEDGER',h)
   loaded[h]=[json.loads(x) for x in indexed[h].read_text('utf8').splitlines()]
  return loaded[h]
 audit={'status':'RESEARCH_ONLY_NO_LIVE_ADOPTED_SHORT_DUAL_BASELINE','costsBps':[10,30],
  'researchPeriod':'2025-08-10_to_2026-08-10',
  'candidateCaveats':['in-sample selected research window, no independent OOS','M5 proportional H1 anchor is not real exchange execution','frozen V52 suppressed signal tape incomplete','no certified native STOP venue ACK or partial fill/restore','not current Production exact code/market accounting parity'],
  'cases':{}}
 for name,case in combined.items():
  audit['cases'][name]={}
  for cost,d in case['costs'].items():
   assert d['accounting']=='PASS' and d['reselectionPasses']==3,(name,cost)
   rs=rows(d['ledgerSha256']);brs=rows(base[cost]['ledgerSha256'])
   bidx={(x['entry_ts_ms'],x['entry_version'],x['side']):x for x in brs if x['strategy_id']=='PENGU'}
   pengu=[x for x in rs if x['strategy_id']=='PENGU']
   def rg(route):
    return [x for x in pengu if x['entry_version']==route]
   def met(r):
    return {'trades':len(r),'wins':sum(float(x['total_pnl_jpy'])>0 for x in r),
       'hardStops':sum('HARD_STOP' in x['exit_reason_actual'] for x in r),
       'modeledPnlJpy':sum(float(x['modeled_realized_pnl_jpy_at_exit_fx']) for x in r)}
   long=rg('LONG_V2_FINAL');reco=rg('RECOVERY_V8');short=rg('SHORT_V20')
   newlong=[x for x in long if 'RESEARCH_PENGU_TIMED_NEGATIVE_' in x['exit_reason_actual']]
   newrec=[x for x in reco if 'RESEARCH_PENGU_TIMED_NEGATIVE_' in x['exit_reason_actual']]
   newshort=[x for x in short if 'RESEARCH_PENGU_TIMED_NEGATIVE_' in x['exit_reason_actual']]
   assert len(newlong)+len(newrec)+len(newshort)==d['penguTimedStops']
   assert len(newshort)==2,(name,cost,len(newshort))
   assert len(pengu)==d['penguN']
   orig=[]
   for z in newlong+newrec:
    before=bidx.get((z['entry_ts_ms'],z['entry_version'],z['side']))
    orig.append(dict(entryUtcMs=z['entry_ts_ms'],route=z['entry_version'],
      oldExitReason=before['exit_reason_actual'] if before else None,
      newExitReason=z['exit_reason_actual'],
      oldWinner=bool(float(before['total_pnl_jpy'])>0) if before else None,
      oldModeledPnlJpy=round(float(before['modeled_realized_pnl_jpy_at_exit_fx']),2) if before else None,
      newModeledPnlJpy=round(float(z['modeled_realized_pnl_jpy_at_exit_fx']),2),
      oldExitTs=before['exit_ts_ms'] if before else None,newExitTs=z['exit_ts_ms']))
   out={'finalEquityJpy':d['finalEquityJpy'],'deltaVsShortDualJpy':d['finalEquityJpy']-base[cost]['finalEquityJpy'],
    'maxDrawdownPct':d['ddPct'],'ddDiffVsShortDualPctPoints':d['ddPct']-base[cost]['ddPct'],
    'portfolioTrades':d['closedTrades'],'pf':d['portfolioPF'],
    'penguNormalLong':met(long),'penguRecoveryLong':met(reco),'penguShort':met(short),
    'addedNormalLongStops':len(newlong),'addedRecoveryStops':len(newrec),
    'originalLongWinnersCut':sum(x['oldWinner'] is True for x in orig),
    'originalHardStopEarlyProtected':sum('HARD_STOP' in str(x['oldExitReason']) for x in orig),
    'allOriginalMatched':all(x['oldExitReason'] for x in orig),
    'newSoftShortStops':len(newshort),'changedPositionDetails':orig,
    'ledgerSha256':d['ledgerSha256']}
   audit['cases'][name][cost]=out
   print('FINAL',name,cost,'GAIN',round(out['deltaVsShortDualJpy']),
    'DD',round(out['maxDrawdownPct'],6),'NEW_LONG',len(newlong),
    'NEW_REC',len(newrec),'SHORT_STOPS',len(newshort),
    'PREV_WIN_CUT',out['originalLongWinnersCut'],flush=True)
 DEST.parent.mkdir(parents=True,exist_ok=True)
 DEST.write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('AUDIT_SAVED',DEST,DEST.stat().st_size,flush=True)
if __name__=='__main__':main()
