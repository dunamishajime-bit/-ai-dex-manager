#!/usr/bin/env python3
"""Compare verified baseline and dual-regime native full8 run by ledger SHA.
Research-only read; records differences and macro-regime A/B breakdown.
"""
from __future__ import annotations
import collections,datetime as dt,hashlib,json
from pathlib import Path
ROOT=Path('C:/tmp/render-regime-native8-results-20261024')
REPO=Path(__file__).resolve().parents[2]
OUT=REPO/'docs/research/results/render-two-regime-20261024'
BASE='RENDER_TWO_REGIME_PARITY_BASELINE'
CASES=['RENDER_TWO_REGIME_A_WEAK_SELLER_0P05_OI_UP']
REPORT='PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def read_case(c):
 p=ROOT/c/REPORT
 j=json.loads(p.read_text('utf8'))['cases'][c]['costs']
 for cost in ('10','30'):
  assert j[cost]['accounting']=='PASS'
  expected=j[cost]['ledgerSha256']
  paths=list((ROOT/c/'engine').rglob('portfolio-trades.jsonl'))
  matches=[f for f in paths if f'{cost}bps' in f.parts and sha(f)==expected]
  assert len(matches)>=1,('NO_MATCHING_LEDGER_SHA',c,cost,expected)
  j[cost]['_sourceLedgerFile']=str(matches[0])
 return j
def ledger(path):
 rows=[]
 with Path(path).open('r',encoding='utf8') as f:
  for line in f:
   line=line.strip()
   if line:rows.append(json.loads(line))
 return rows
def tr_name(row):
 return str(row.get('strategy_id')),str(row.get('symbol')),str(row.get('side')),int(row.get('entry_ts_ms'))
def cells(rows):
 out={}
 for label,filter_ in [
  ('all',lambda r:True),
  ('JAN_MAR_2026',lambda r:1767225600000<=int(r['entry_ts_ms'])<1775001600000),
  ('APR_AUG_2026',lambda r:1775001600000<=int(r['entry_ts_ms'])<1786320000000)]:
  filtered=[r for r in rows if filter_(r)]
  val=[float(r.get('total_pnl_jpy',0)) for r in filtered]
  out[label]={'n':len(filtered),'wins':sum(v>0 for v in val),
   'winsPct':round(100*sum(v>0 for v in val)/len(val),2) if val else None,
   'pnlJpy':round(sum(val,0.),2)}
 return out
def main():
 data={'status':'RESEARCH_ONLY_FULL8_DYNAMIC_RESELECTION_CAUSAL_A_B',
 'researchEpoch':dt.datetime.now(dt.timezone.utc).isoformat(),
 'baselineCase':BASE,'cases':{},'warnings':[
  'Native 8 wallet research is not current venue production SHA or actual fill certification',
  'New gate uses 2026 post-hoc 7d market thresholds, not pristine OOS',
  'No new synthetic native route added; only existing H1 candidates veto/reselect'],
 }
 orig=read_case(BASE)
 for c in CASES:
  alt=read_case(c)
  sub={}
  evidence=json.loads((ROOT/(c+'_regime_evidence.json')).read_text('utf8'))
  for cost in ('10','30'):
   a=orig[cost];b=alt[cost]
   ro=ledger(a['_sourceLedgerFile']);rn=ledger(b['_sourceLedgerFile'])
   idle0=[r for r in ro if r.get('strategy_id')=='IDLE' and r.get('symbol')=='RENDERUSDT' and r.get('side')=='SHORT']
   idle1=[r for r in rn if r.get('strategy_id')=='IDLE' and r.get('symbol')=='RENDERUSDT' and r.get('side')=='SHORT']
   okeys={tr_name(r) for r in idle0};nkeys={tr_name(r) for r in idle1}
   all0={tr_name(r) for r in ro};all1={tr_name(r) for r in rn}
   loss0=[r for r in idle0 if float(r.get('total_pnl_jpy',0))<=0]
   entries0={tr_name(r):r for r in idle0}
   entries1={tr_name(r):r for r in idle1}
   out={'base':{k:a[k] for k in ('finalEquityJpy','ddPct','portfolioPF','closedTrades','byStrategy','ledgerSha256')},
    'candidate':{k:b[k] for k in ('finalEquityJpy','ddPct','portfolioPF','closedTrades','byStrategy','ledgerSha256')},
    'delta':{'equityJpy':round(b['finalEquityJpy']-a['finalEquityJpy'],3),
      'ddPctPoints':round(b['ddPct']-a['ddPct'],6),
      'trades':int(b['closedTrades']-a['closedTrades'])},
    'renderBaseline':cells(idle0),'renderVariant':cells(idle1),
    'renderRemovedEntryTimes':sorted({x[-1] for x in okeys-nkeys}),
    'renderNewEntryTimes':sorted({x[-1] for x in nkeys-okeys}),
    'otherStrategyRemoved':dict(collections.Counter(x[0] for x in all0-all1 if x[0]!='IDLE')),
    'otherStrategyAdded':dict(collections.Counter(x[0] for x in all1-all0 if x[0]!='IDLE')),
    'renderLossCuts':sum(tr_name(r) in (okeys-nkeys) for r in loss0),
    'renderWinsRemoved':sum(float(entries0[x].get('total_pnl_jpy',0))>0 for x in okeys-nkeys),
    'renderLossesRemoved':sum(float(entries0[x].get('total_pnl_jpy',0))<=0 for x in okeys-nkeys),
    'gatingEvidenceSummary':evidence['summary'][cost],
    'nativeSharedWalletAccounting':'PASS'}
   sub[cost]=out
   print('FULL8',c,cost,'EQUITY_DELTA',out['delta']['equityJpy'],'DD_DELTA_PP',
    out['delta']['ddPctPoints'],'TOTAL_TRADES_DELTA',out['delta']['trades'],
    'RENDER',out['renderBaseline']['all']['n'],'TO',out['renderVariant']['all']['n'],
    'RENDER_JFM',out['renderBaseline']['JAN_MAR_2026']['wins'],'/',
    out['renderBaseline']['JAN_MAR_2026']['n'],'TO',
    out['renderVariant']['JAN_MAR_2026']['wins'],'/',out['renderVariant']['JAN_MAR_2026']['n'],
    'EVIDENCE',out['gatingEvidenceSummary'],flush=True)
  data['cases'][c]=sub
 OUT.mkdir(exist_ok=True,parents=True)
 target=OUT/'RENDER_PARALLEL_NATIVE8_AB_ADMISSION_COMPARE_20261024.json'
 target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('COMPARE_RESULT',target)
if __name__=='__main__':main()
