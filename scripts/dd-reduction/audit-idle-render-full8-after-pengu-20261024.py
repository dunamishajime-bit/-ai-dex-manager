#!/usr/bin/env python3
"""Audit IDLE RENDER initial negative exit variants against PENGU cumulative baseline.
Reports actual all8 results and preserves source ledger SHA evidence. No LIVE.
"""
from __future__ import annotations
import json,hashlib
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
BASEFOLDER='rv24penguInitialCombinedNormal8Recovery24'
BASECASE='NORMAL_8H_HARDCOOL_PLUS_RECOVERY_24H_3P'
TESTS={
 'SUSTAIN2_MIN180_MFE1':('rv24IdleRenderSustain2M180','RENDER_SUSTAIN2_MIN180_MFE1'),
 'TOUCH1_WATCH2_MFE0P25':('rv24IdleRenderWatch1TwoH','RENDER_TOUCH1_WATCH2_MFE0P25'),
 'AT4_LOSS1_MFE0P25':('rv24IdleRender4H1','RENDER_AT4_LOSS1_MFE0P25')
}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for x in iter(lambda:f.read(1<<20),b''):h.update(x)
 return h.hexdigest()
def read(folder,sha):
 for p in (ROOT/folder/'engine').rglob('portfolio-trades.jsonl'):
  if digest(p)==sha:return [json.loads(s) for s in p.read_text('utf8').splitlines()]
 raise RuntimeError(('MISSING_LEDGER',folder,sha))
def record(data,cost,orig,rows,name):
 assert data['accounting']=='PASS' and data['reselectionPasses']==3,(name,cost,'ACCOUNTING_OR_PASSES_FAILED')
 pengu=[z for z in rows if z['strategy_id']=='PENGU']
 origpengu=[z for z in orig if z['strategy_id']=='PENGU']
 op={(z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price'],z['side'],z['entry_version']) for z in origpengu}
 np={(z['entry_ts_ms'],z['exit_ts_ms'],z['exit_price'],z['side'],z['entry_version']) for z in pengu}
 assert op==np,(name,cost,'PENGU_ECONOMIC_EXIT_COHORT_CHANGED',len(op),len(np))
 oldi=[z for z in orig if z['strategy_id']=='IDLE' and z['symbol']=='RENDERUSDT']
 now=[z for z in rows if z['strategy_id']=='IDLE' and z['symbol']=='RENDERUSDT']
 changed=[z for z in now if z['exit_reason_actual']=='RESEARCH_IDLE_RENDER_INITIAL_RENDER_'+name]
 if name!='BASE':
  assert len(changed)>0,(name,cost,'NO_APPLIED_IDLE_TRIGGER')
  assert all(z['side']=='SHORT' for z in changed)
 return {'finalEquityJpy':data['finalEquityJpy'],'maxDrawdownPct':data['ddPct'],
 'portfolioTrades':data['closedTrades'],'portfolioPF':data['portfolioPF'],
 'penguCohortPreserved':len(op),
 'renderTradesOriginal':len(oldi),'renderTradesCandidate':len(now),
 'renderOriginalWins':sum(z['total_pnl_jpy']>0 for z in oldi),
 'renderCandidateWins':sum(z['total_pnl_jpy']>0 for z in now),
 'renderNewRiskExits':len(changed),'renderNewRiskExitEntryTsMs':[z['entry_ts_ms'] for z in changed],
 'renderModelPnlJpy':sum(z['modeled_realized_pnl_jpy_at_exit_fx'] for z in now),
 'ledgerSha256':data['ledgerSha256'],'accounting':data['accounting']}
def main():
 pre=json.loads((ROOT/BASEFOLDER/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json').read_text('utf8'))
 b=pre['cases'][BASECASE]['costs']
 cases={'BASE':{'costs':{}}}
 base_ledgers={}
 for cost in ('10','30'):
  data=b[cost];base_ledgers[cost]=read(BASEFOLDER,data['ledgerSha256'])
  rows=base_ledgers[cost]
  cases['BASE']['costs'][cost]={
  'finalEquityJpy':data['finalEquityJpy'],'maxDrawdownPct':data['ddPct'],
  'portfolioTrades':data['closedTrades'],
  'renderTrades':sum(z['strategy_id']=='IDLE' and z['symbol']=='RENDERUSDT' for z in rows),
  'ledgerSha256':data['ledgerSha256']}
 for name,(folder,case) in TESTS.items():
  p=ROOT/folder/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json'
  if not p.exists():continue
  d=json.loads(p.read_text('utf8'))['cases'][case]['costs']
  if set(d)!={'10','30'}:continue
  cases[name]={'costs':{}}
  for cost in ('10','30'):
   result=d[cost];rows=read(folder,result['ledgerSha256'])
   s=record(result,cost,base_ledgers[cost],rows,name)
   s['deltaFromCumulativeJpy']=result['finalEquityJpy']-b[cost]['finalEquityJpy']
   s['ddDeltaPctPoints']=result['ddPct']-b[cost]['ddPct']
   s['tradeDelta']=result['closedTrades']-b[cost]['closedTrades']
   cases[name]['costs'][cost]=s
   print('AUDIT',name,cost,'FINAL',round(s['finalEquityJpy']),
    'DELTA',round(s['deltaFromCumulativeJpy']),'DD',round(s['maxDrawdownPct'],5),
    'N',s['portfolioTrades'],'RENDER_EXIT',s['renderNewRiskExits'],'PENGU_COHORT',s['penguCohortPreserved'],flush=True)
 result={'status':'RESEARCH_ONLY_NOT_LIVE_OR_OOS','baseline':'PENGU approved SHORT two steps plus NORMAL LONG 8h -5 / Recovery V8 24h -3 and AVAX6, 8 dynamic shared wallet', 'cases':cases,
 'notes':['Selected-trade M5 screen used in-sample and cannot certify these exits','Both bps economic full8 runs and ledger SHA checks required','Venue actual order/funding/parity cannot be inferred from H1/M5 model']}
 out=REPO/'docs/research/results/idle-next-20261024/IDLE_RENDER_AFTER_PENGU_NATIVE_FULL8_AUDIT_20261024.json'
 out.parent.mkdir(parents=True,exist_ok=True)
 out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 print('AUDIT_SAVED',out,flush=True)
if __name__=='__main__':main()
