#!/usr/bin/env python3
"""Audit causal full8 Idle RENDER DOT JUP entry gate economics and route-level trade count.
Read-only historical analyses, not LIVE execution.
"""
from __future__ import annotations
import argparse,hashlib,importlib.util,collections,json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r'C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8')
BASE_DIR='rv24penguInitialCombinedNormal8Recovery24'
BASE_CASE='NORMAL_8H_HARDCOOL_PLUS_RECOVERY_24H_3P'
CASES={
'RENDER_BTC3GE_M1P5':'rv24IdleEntryRenderBTC3GE_M1P5',
'RENDER_BTC3GE_M1':'rv24IdleEntryRenderBTC3GE_M1',
'RENDER_ATR3LE_0P8':'rv24IdleEntryRenderATR3LE0P8',
'DOT_RET1GE_M1':'rv24IdleEntryDOTRet1GE_M1',
'DOT_LOWVOL_OVERSOLD_VETO':'rv24IdleEntryDOTNoOversold',
'JUP_RET12GE_M5':'rv24IdleEntryJUPRet12GE_M5',
'COMBO_KEEP90':'rv24IdleEntryComboKeep90',
'COMBO_BEST_WR':'rv24IdleEntryComboBestWR',
'COMBO_ATR_DOT_JUP':'rv24IdleEntryComboATRDotJUP',
'COMBO_ATR_JUP_ONLY':'rv24IdleEntryComboATRJUPOnly',
'COMBO_BTC_ATR_JUP_ONLY':'rv24IdleEntryComboBTCATRJUPOnly',
'COMBO_BTC_DOT_JUP3_GE_M1P5':'rv24IdleEntryComboBTCDOTJupRet3M1p5',
'COMBO_BTC_DOT_JUP3_GE_M1':'rv24IdleEntryComboBTCDOTJupRet3M1',
'RENDER_CO_DECLINE_AND_JUP_M1P5':'rv24IdleRenderCoDeclineJupM1p5',
'RENDER_CO_DECLINE_STRONG_AND_JUP_M1P5':'rv24IdleRenderCoStrongJupM1p5',
'RENDER_CO_M1P5_FLOOR0P5':'rv24IdleRenderCoJupF05',
'RENDER_CO_M1P5_FLOOR0P75':'rv24IdleRenderCoJupF075',
'RENDER_PROFIT_F05_JUP_M1P5':'rv24IdleRenderProfitF05JupM1p5',
'RENDER_PROFIT_F075_JUP_M1P5':'rv24IdleRenderProfitF075JupM1p5',
'RENDER_REBOUND_NO_LATE_DUMP':'rv24IdleRenderReboundNoLateDump',
'RENDER_REBOUND_NO_SHARP1H_DUMP':'rv24IdleRenderReboundNoSharp1hDump',
'RENDER_PROFIT_F035_JUP_M1P5':'rv24RenderF035JupM1p5',
'RENDER_PROFIT_F040_JUP_M1P5':'rv24RenderF040JupM1p5',
'RENDER_PROFIT_F045_JUP_M1P5':'rv24RenderF045JupM1p5',
'RENDER_INITIAL_WATCH1_2H_JUP_M1P5':'rv24RenderWatch12hJupM1p5',
'RENDER_INITIAL_WATCH1_2H_F035_JUP_M1P5':'rv24RenderWatch12hF035JupM1p5'
}
SYMS=('RENDERUSDT','DOTUSDT','JUPUSDT')
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def trade_ledger(dir_name,digest):
 directory=ROOT/dir_name/'engine'
 for f in directory.rglob('portfolio-trades.jsonl'):
  if sha(f)==digest:
   return [json.loads(x) for x in f.read_text('utf8').splitlines()]
 raise RuntimeError(('MISSING_LEDGER',dir_name,digest))
def calc_subset(rows):
 out={}
 for sym in SYMS:
  rr=[r for r in rows if r['strategy_id']=='IDLE' and r['symbol']==sym]
  out[sym]={
   'n':len(rr),'wins':sum(r['total_pnl_jpy']>0 for r in rr),
   'wrPct':round(100*sum(r['total_pnl_jpy']>0 for r in rr)/len(rr),3) if rr else None,
   'modeledPnLJpy':sum(r['modeled_realized_pnl_jpy_at_exit_fx'] for r in rr),
   'losersPnlJpy':sum(r['modeled_realized_pnl_jpy_at_exit_fx'] for r in rr if r['total_pnl_jpy']<0),
   'entryTsMs':[int(r['entry_ts_ms']) for r in rr]
  }
 return out
def one_result(meta,rows,baseline,base_rows):
 assert meta['accounting']=='PASS' and meta['reselectionPasses']==3
 entry=calc_subset(rows);base=calc_subset(base_rows)
 return {
 'finalEquityJpy':meta['finalEquityJpy'],
 'deltaFromBaselineJpy':meta['finalEquityJpy']-baseline['finalEquityJpy'],
 'ddPct':meta['ddPct'],
 'ddDeltaPctPoints':meta['ddPct']-baseline['ddPct'],
 'portfolioTrades':meta['closedTrades'],
 'portfolioTradesDelta':meta['closedTrades']-baseline['closedTrades'],
 'pf':meta['portfolioPF'],
 'allIdleTrades':sum(x['strategy_id']=='IDLE' for x in rows),
 'symbols':{s:{**entry[s],'nDelta':entry[s]['n']-base[s]['n'],
    'wrDeltaPctPoints':entry[s]['wrPct']-base[s]['wrPct'] if entry[s]['wrPct'] is not None else None}
    for s in SYMS},
 'baselineSymbolSummary':base,
 'penguTradeCount':sum(x['strategy_id']=='PENGU' for x in rows),
 'ledgerSha256':meta['ledgerSha256'],'accounting':meta['accounting']}
def main():
 pa=argparse.ArgumentParser()
 pa.add_argument('--require-all',action='store_true')
 args=pa.parse_args()
 anchor=json.loads((ROOT/BASE_DIR/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json').read_text('utf8'))
 base=anchor['cases'][BASE_CASE]['costs']
 cases={}
 for name,dir_name in CASES.items():
  p=ROOT/dir_name/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json'
  if not p.exists():
   if args.require_all:raise RuntimeError(('NOT_RUN',name))
   continue
  j=json.loads(p.read_text('utf8'))
  if name not in j['cases']:
   if args.require_all:raise RuntimeError(('CASE_MISSING',name))
   continue
  vals=j['cases'][name]['costs']
  if set(vals)!={'10','30'}:
   if args.require_all:raise RuntimeError(('COST_INCOMPLETE',name))
   continue
  output={}
  for cost in ('10','30'):
   baseRows=trade_ledger(BASE_DIR,base[cost]['ledgerSha256'])
   actual=trade_ledger(dir_name,vals[cost]['ledgerSha256'])
   output[cost]=one_result(vals[cost],actual,base[cost],baseRows)
   print('AUDIT',name,cost,'EQUITY',round(output[cost]['finalEquityJpy']),
     'DELTA',round(output[cost]['deltaFromBaselineJpy']),'DD',round(output[cost]['ddPct'],4),
     'PORT_N',output[cost]['portfolioTrades'],'PORT_N_DELTA',output[cost]['portfolioTradesDelta'],
     'BY_SYMBOL',[(s,output[cost]['symbols'][s]['n'],
        output[cost]['symbols'][s]['wrPct']) for s in SYMS],flush=True)
  cases[name]=output
 result={'status':'RESEARCH_ONLY_NOT_LIVE','baselineByCost':{x:{k:base[x][k] for k in (
  'finalEquityJpy','ddPct','closedTrades','portfolioPF','ledgerSha256')} for x in ('10','30')},
 'testedCases':cases,
 'note':'Selected-trade gate screens are historical in-sample. Only these 8-strategy full8 dynamic reruns are model economic results; OOS/venue unverified.'}
 path=REPO/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json'
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 print('SAVED',path,path.stat().st_size,'cases',len(cases),flush=True)
if __name__=='__main__':main()
