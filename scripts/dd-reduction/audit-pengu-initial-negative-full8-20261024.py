#!/usr/bin/env python3
"""Audit initial negative LONG full8 cases against prior LONG profit2 + adopted SHORT dual.
Only read frozen research outputs. No venue or Production writes.
"""
from __future__ import annotations
import hashlib,json,collections,argparse
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
BASELINE='LONG_PEAK2_FLOOR_MINUS5'
ITEMS={
 'AT8_NEG5_MFE1':('rv24penguInitialNeg_AT8_5','PROFIT2_PLUS_AT8_NEG5_MFE1'),
 'ARM35_WATCH2_MFE1':('rv24penguInitial_armed_watch2','PROFIT2_PLUS_ARM35_WATCH2_MFE1'),
 'TOUCH5_AFTER2_MFE1':('rv24penguInitial_first_touch5','PROFIT2_PLUS_TOUCH5_AFTER2_MFE1'),
 'AT12_NEG4_MFE1':('rv24penguInitial_at12_minus4','PROFIT2_PLUS_AT12_NEG4_MFE1'),
 'AT8_NEG5_HARD24H_PROXY':('rv24penguInitial_HardCool_AT8','PROFIT2_PLUS_AT8_NEG5_MFE1'),
 'ARM35_WATCH2_HARD24H_PROXY':('rv24penguInitial_HardCool_ARM','PROFIT2_PLUS_ARM35_WATCH2_MFE1'),
 'AT12_NEG4_HARD24H_PROXY':('rv24penguInitial_HardCool_AT12','PROFIT2_PLUS_AT12_NEG4_MFE1')
}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for x in iter(lambda:f.read(1<<20),b''):h.update(x)
 return h.hexdigest()
def get_rows(dirname,sha):
 target=ROOT/dirname
 for f in (target/'engine').rglob('portfolio-trades.jsonl'):
  if digest(f)==sha:return [json.loads(z) for z in f.read_text('utf8').splitlines()]
 raise RuntimeError(('NO_TRADE_LEDGER',dirname,sha))
def main():
 pa=argparse.ArgumentParser()
 pa.add_argument('--required',nargs='*',default=list(ITEMS))
 args=pa.parse_args()
 assert set(args.required)<=set(ITEMS)
 previous=json.loads((REPO/'docs/research/results/pengu-long-20261024/PENGU_LONG_CUMULATIVE_NATIVE_FULL8_AUDIT_20261024.json').read_text('utf8'))
 base=previous['cases'][BASELINE]
 original={}
 for cost in ('10','30'):
  assert abs(base[cost]['maxDrawdownPct'])<=100 and base[cost]['portfolioTrades']>1200
  original[cost]=get_rows('rv24penguLongNativeV2',base[cost]['ledgerSha256'])
 out={'status':'RESEARCH_ONLY_NOT_LIVE_NOT_OOS','baseline':'PENGU SHORT dual + NORMAL LONG MFE2 then -5 profit reversal stop',
      'baselineByCost':base,'cases':{},'notes':[
       'Changed all8 dynamic wallet re-selection impacts future entry slate; static one-trade saving is not the portfolio gain.',
       'All early-loss screens select historical 2025-11-07 23:00 UTC normal LONG; in-sample one-event risk.',
       'Price anchoring is H1 trade model proportional to causal M5 market bars; venue actual fills not certified.',
       'The HARD24H_PROXY is a research mapping of early soft risk stop to hard-stop-like 24h global PENGU cooldown and 60h same-route quarantine. It is NOT a venue hard stop.'] }
 for item in args.required:
  folder,case=ITEMS[item]
  f=ROOT/folder/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json'
  assert f.is_file(),('OUTPUT_MISSING',f)
  d=json.loads(f.read_text('utf8'))['cases'][case]['costs']
  assert set(d)=={'10','30'},('INCOMPLETE_COSTS',item,list(d))
  out['cases'][item]={}
  for cost in ('10','30'):
   r=d[cost]
   assert r['accounting']=='PASS',('ACCOUNTING',item,cost)
   assert r['reselectionPasses']==3,('RESELECTION',item,cost,r.get('reselectionPasses'))
   data=get_rows(folder,r['ledgerSha256'])
   orig=original[cost]
   idx={(z['strategy_id'],z['entry_ts_ms'],z['side'],z['entry_version']):z for z in orig}
   short=[z for z in data if z['strategy_id']=='PENGU' and z['side']=='SHORT' and
          'RESEARCH_PENGU_TIMED_NEGATIVE_' in z['exit_reason_actual']]
   oldshort=[z for z in orig if z['strategy_id']=='PENGU' and z['side']=='SHORT' and
          'RESEARCH_PENGU_TIMED_NEGATIVE_' in z['exit_reason_actual']]
   assert len(short)>=len(oldshort)==2,(item,cost,'SHORT_STOP_STABILITY',len(short),len(oldshort))
   assert {(z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price']) for z in oldshort}<={(z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price']) for z in short},('ADOPTED_SHORT_STOPS_CHANGED',item,cost)
   originals=set((z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price']) for z in orig if z['strategy_id']=='PENGU' and z['entry_version']=='LONG_V2_FINAL' and 'RESEARCH_PENGU_TIMED_NEGATIVE_' in z['exit_reason_actual'])
   # Retain original accepted profit protection on two previously losing LONGs.
   prof=[z for z in data if z['strategy_id']=='PENGU' and z['entry_version']=='LONG_V2_FINAL' and
          'RESEARCH_PENGU_TIMED_NEGATIVE_' in z['exit_reason_actual']]
   assert originals<=set((z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price']) for z in prof),('PROFIT2_LONG_CHANGED',item,cost)
   initial=[z for z in data if z['strategy_id']=='PENGU' and z['entry_version']=='LONG_V2_FINAL' and
          ('HARD24H_PROXY' not in item and 'RESEARCH_PENGU_TIMED_NEGATIVE_' in z['exit_reason_actual'] or
           'HARD24H_PROXY' in item and 'PENGU_INITIAL_ADVERSE_HARD_STOP_COOLDOWN_PROXY' in z['exit_reason_actual'])]
   early=[z for z in initial if z['entry_ts_ms']==1762556400000]
   assert len(early)==1,('NO_INITIAL_EXIT_ON_NOV07',item,cost,[(z['entry_ts_ms'],z['exit_reason_actual']) for z in initial])
   hard24h=('HARD24H_PROXY' in item)
   assert ('HARD_STOP' in early[0]['exit_reason_actual'])==hard24h,(item,cost,'RISK_COOLDOWN_PROXY_REASON')
   b=base[cost]
   out['cases'][item][cost]={
    'finalEquityJpy':r['finalEquityJpy'],
    'deltaVsLongProfit2BaseJpy':r['finalEquityJpy']-b['finalEquityJpy'],
    'maxDrawdownPct':r['ddPct'],
    'ddDeltaPercentagePoints':r['ddPct']-b['maxDrawdownPct'],
    'portfolioTrades':r['closedTrades'],
    'tradeDelta':r['closedTrades']-b['portfolioTrades'],
    'portfolioPF':r['portfolioPF'],
    'penguTrades':r['penguN'],
    'penguWins':r['penguWins'],
    'penguDualShortStops':len(short),
    'adoptedOriginalShortStopCount':len(oldshort),
    'normalLongProfitStopsPreserved':len(prof),
    'initialStopEntryTsMs':early[0]['entry_ts_ms'],
    'initialStopExitTsMs':early[0]['exit_ts_ms'],
    'initialStopExitReason':early[0]['exit_reason_actual'],
    'initialStopModelPnLJPY':early[0]['modeled_realized_pnl_jpy_at_exit_fx'],
    'initialOriginalHardLossPnLJPY':idx[('PENGU',1762556400000,'LONG','LONG_V2_FINAL')]['modeled_realized_pnl_jpy_at_exit_fx'],
    'newPENGUShortAfterInitialLoss':len([z for z in data if z['strategy_id']=='PENGU' and z['side']=='SHORT' and 1762650000000<=z['entry_ts_ms']<=1762690000000]),
    'newPENGUShortEntryMs':[z['entry_ts_ms'] for z in data if z['strategy_id']=='PENGU' and z['side']=='SHORT' and 1762650000000<=z['entry_ts_ms']<=1762690000000],
    'ledgerSha256':r['ledgerSha256'],'accounting':r['accounting']
   }
   s=out['cases'][item][cost]
   print('AUDITED',item,cost,'FINAL',round(s['finalEquityJpy']),
    'GAIN_VS_PROFIT2',round(s['deltaVsLongProfit2BaseJpy']),
    'DD',round(s['maxDrawdownPct'],5),'PENGU_SHORT_STOPS',s['penguDualShortStops'],
    'NEW_PENGU_SHORT_NEXT_DAY',s['newPENGUShortAfterInitialLoss'],flush=True)
 target=REPO/'docs/research/results/pengu-initial-negative-20261024/PENGU_INITIAL_NEGATIVE_FULL8_AUDIT_20261024.json'
 target.parent.mkdir(parents=True,exist_ok=True)
 target.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('AUDIT_SAVED',target,target.stat().st_size,flush=True)
if __name__=='__main__':main()
