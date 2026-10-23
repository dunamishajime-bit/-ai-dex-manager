#!/usr/bin/env python3
"""Independent-ish audit: PENGU short dual, normal profit floor, initial adverse LONG, and Recovery V8.
All values are model estimates. No LIVE.
"""
from __future__ import annotations
import hashlib,json,datetime
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
SOURCES={
'BASELINE':('rv24penguLongNativeV2','LONG_PEAK2_FLOOR_MINUS5'),
'NORMAL12':('rv24penguInitial_HardCool_AT12','PROFIT2_PLUS_AT12_NEG4_MFE1'),
'RECOVERY24':('rv24penguInitial_Recovery24','NORMAL_PROFIT2_RECOVERY_AT24_NEG3'),
'COMBINED':('rv24penguInitialCombinedNormal12Recovery24','NORMAL_12H_HARDCOOL_PLUS_RECOVERY_24H_3P'),
'COMBINED8':('rv24penguInitialCombinedNormal8Recovery24','NORMAL_8H_HARDCOOL_PLUS_RECOVERY_24H_3P')
}
ORIGINAL_NORMAL_TS=1762556400000
ORIGINAL_RECOVERY_TS=1767110400000
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as r:
  for b in iter(lambda:r.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def load_rows(folder,hashed):
 for f in (ROOT/folder/'engine').rglob('portfolio-trades.jsonl'):
  if sha(f)==hashed:return [json.loads(l) for l in f.read_text('utf8').splitlines()]
 raise RuntimeError(('NO_LEDGER',folder,hashed))
def each():
 baseline=json.loads((REPO/'docs/research/results/pengu-long-20261024/PENGU_LONG_CUMULATIVE_NATIVE_FULL8_AUDIT_20261024.json').read_text('utf8'))['cases']['LONG_PEAK2_FLOOR_MINUS5']
 cases={'BASELINE':{},'NORMAL12':{},'RECOVERY24':{},'COMBINED':{},'COMBINED8':{}}
 for name,(folder,case) in SOURCES.items():
  if name=='BASELINE':continue
  p=ROOT/folder/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json'
  assert p.exists(),('MISSING',name,p)
  d=json.loads(p.read_text('utf8'))['cases'][case]['costs']
  assert set(d)=={'10','30'},('COST_INCOMPLETE',name,d.keys())
  cases[name]=d
 for cost in ('10','30'):
  p0=baseline[cost]
  rows0=load_rows('rv24penguLongNativeV2',p0['ledgerSha256'])
  cases['BASELINE'][cost]={'finalEquityJpy':p0['finalEquityJpy'],'ddPct':p0['maxDrawdownPct'],
       'closedTrades':p0['portfolioTrades'],'ledgerSha256':p0['ledgerSha256']}
  origshort={(z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price']) for z in rows0 if z['strategy_id']=='PENGU' and z['side']=='SHORT' and 'RESEARCH_PENGU_TIMED_NEGATIVE' in z['exit_reason_actual']}
  origprofit={(z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price']) for z in rows0 if z['strategy_id']=='PENGU' and z['entry_version']=='LONG_V2_FINAL' and 'RESEARCH_PENGU_TIMED_NEGATIVE' in z['exit_reason_actual']}
  assert len(origshort)==len(origprofit)==2
  for name in ('NORMAL12','RECOVERY24','COMBINED','COMBINED8'):
   r=cases[name][cost]
   assert r['accounting']=='PASS' and r['reselectionPasses']==3
   rows=load_rows(SOURCES[name][0],r['ledgerSha256'])
   short={(z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price']) for z in rows if z['strategy_id']=='PENGU' and z['side']=='SHORT' and 'RESEARCH_PENGU_TIMED_NEGATIVE' in z['exit_reason_actual']}
   profit={(z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price']) for z in rows if z['strategy_id']=='PENGU' and z['entry_version']=='LONG_V2_FINAL' and 'RESEARCH_PENGU_TIMED_NEGATIVE' in z['exit_reason_actual']}
   assert origshort<=short,(name,cost,'SHORT_STOPS_DIFF')
   assert origprofit<=profit,(name,cost,'LONG_PROFIT_DIFF')
   earlyNormal=[z for z in rows if z['strategy_id']=='PENGU' and z['entry_version']=='LONG_V2_FINAL' and z['entry_ts_ms']==ORIGINAL_NORMAL_TS]
   earlyRecovery=[z for z in rows if z['strategy_id']=='PENGU' and z['entry_version']=='RECOVERY_V8' and z['entry_ts_ms']==ORIGINAL_RECOVERY_TS]
   assert len(earlyNormal)==len(earlyRecovery)==1
   if name in ('NORMAL12','COMBINED','COMBINED8'):
    assert 'PENGU_INITIAL_ADVERSE_HARD_STOP_COOLDOWN_PROXY' in earlyNormal[0]['exit_reason_actual'],(name,cost,'NORMAL_COOLDOWN')
   else:assert earlyNormal[0]['exit_reason_actual']=='LONG_HARD_STOP'
   if name in ('RECOVERY24','COMBINED','COMBINED8'):
    assert 'RESEARCH_PENGU_TIMED_NEGATIVE' in earlyRecovery[0]['exit_reason_actual'],(name,cost,'RECOVERY_STOP')
    assert 'HARD_STOP' not in earlyRecovery[0]['exit_reason_actual'],(name,cost,'RECOVERY_EVENT_MUST_BE_SOFT')
   else:assert earlyRecovery[0]['exit_reason_actual']=='RECOVERY_V8_HARD_STOP'
   cases[name][cost]={'finalEquityJpy':r['finalEquityJpy'],
      'deltaFromProfit2Baseline':r['finalEquityJpy']-p0['finalEquityJpy'],
      'ddPct':r['ddPct'],'ddDeltaPoints':r['ddPct']-p0['maxDrawdownPct'],
      'closedTrades':r['closedTrades'],'tradeDelta':r['closedTrades']-p0['portfolioTrades'],
      'penguTrades':r['penguN'],'penguWins':r['penguWins'],'profitFactor':r['portfolioPF'],
      'originalAcceptedShortStopsPreserved':len(origshort),
      'originalLongProfitStopsPreserved':len(origprofit),
      'normalInitialLongModelPnlJpy':earlyNormal[0]['modeled_realized_pnl_jpy_at_exit_fx'],
      'normalInitialLongExitReason':earlyNormal[0]['exit_reason_actual'],
      'recoveryInitialModelPnlJpy':earlyRecovery[0]['modeled_realized_pnl_jpy_at_exit_fx'],
      'recoveryInitialReason':earlyRecovery[0]['exit_reason_actual'],
      'ledgerSha256':r['ledgerSha256'],'accounting':'PASS'}
   print('PASS',name,cost,'FINAL',round(r['finalEquityJpy']),'GAIN_VS_BASE',
    round(r['finalEquityJpy']-p0['finalEquityJpy']),
    'DD',round(r['ddPct'],5),'TRADE_DELTA',r['closedTrades']-p0['portfolioTrades'],
    'NORMAL',cases[name][cost]['normalInitialLongExitReason'],
    'RECOVERY',cases[name][cost]['recoveryInitialReason'],flush=True)
 results={'status':'RESEARCH_ONLY_NOT_LIVE_OOS_NOT_VERIFIED',
 'base':'user adopted PENGU SHORT dual plus NORMAL LONG candidate MFE2 then -5 and AVAX6 / all8 native dynamic wallet',
 'cases':cases,
 'notes':['RecoveryV8 normal hard stop -6 retained and only hypothetical additional soft stop checked','Normal LONG -8 hard stop retained and extra 12h -4 triggers an early risk event with 24h PENGU cooldown + 60h route quarantine proxy','Only one original historical trigger per new initial LONG/RECOVERY stop; sample too sparse for live economic proof']}
 out=REPO/'docs/research/results/pengu-initial-negative-20261024/PENGU_INITIAL_NORMAL_RECOVERY_FULL8_COMBINED_AUDIT_20261024.json'
 out.parent.mkdir(parents=True,exist_ok=True)
 out.write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('COMBINED_AUDIT_SAVED',out,out.stat().st_size,flush=True)
if __name__=='__main__':each()
