#!/usr/bin/env python3
"""Merge audited PENGU timed-negative full8 model cases and inspect own-trade losses.

Read-only input; research artifact JSON outputs only. Never connect venue/Production.
"""
from __future__ import annotations
import argparse,collections,hashlib,json
from pathlib import Path
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
SOURCES=[ROOT/"rv23penguTimeNativeFull",ROOT/"rv23penguTimeNativeScope",ROOT/"rv23penguTimeNativeCombo"]
REPORT="PENGU_TIMED_NEGATIVE_NATIVE_FULL8_20261023.json"
REPO=Path(__file__).resolve().parents[2]
REFERENCE=REPO/"docs/research/results/residual-composite-20261023/RESIDUAL_AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json"
def digest(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for c in iter(lambda:f.read(1048576),b''):h.update(c)
 return h.hexdigest()
def main(dest):
 collected={}
 for directory in SOURCES:
  report=directory/REPORT
  if not report.exists():raise RuntimeError(("STUDY_NOT_FINISHED",report))
  data=json.loads(report.read_text('utf8'))
  for name,item in data['cases'].items():
   assert name not in collected,("DUPLICATE_CASE",name)
   assert set(item['costs'])=={'10','30'},("CASE_MISSING_COST",name,list(item['costs']))
   collected[name]=item
 assert len(collected)==20,("EXPECTED_20_TOTAL_SCENARIOS",len(collected))
 anchors=json.loads(REFERENCE.read_text('utf8'))['cases']['WATCH35_2H_PLUS_HARD5']['costs']
 for cost in ('10','30'):
  observed=collected['BASE']['costs'][cost]
  assert observed['ledgerSha256']==anchors[cost]['ledgerSha256']
  assert abs(observed['finalEquityJpy']-anchors[cost]['finalEquityJpy'])<1e-8
 index={}
 for folder in SOURCES:
  for p in (folder/'engine').rglob('portfolio-trades.jsonl'):
   h=digest(p)
   index.setdefault(h,p)
 print('LEDGER_INDEXED',len(index),flush=True)
 rows_by_hash={}
 def getrows(h):
  if h not in rows_by_hash:
   if h not in index:raise RuntimeError(("MISSING_SOURCE_TRADE_LEDGER",h))
   rows_by_hash[h]=[json.loads(s) for s in index[h].read_text('utf8').splitlines()]
  return rows_by_hash[h]
 bases={}
 for c in ('10','30'):
  r=getrows(collected['BASE']['costs'][c]['ledgerSha256'])
  bases[c]={ (x['entry_ts_ms'],x['side'],x['entry_version']):x for x in r if x['strategy_id']=='PENGU'}
  assert len(bases[c])==67,("PENGU_BASE_COUNT",c)
 combined={"status":"RESEARCH_ONLY_PENGU_TIMED_NEGATIVE_FULL8_19_SCENARIO_BOTH_COSTS_NOT_LIVE",
  "period":"2025-08-10_to_2026-08-10","costsBps":[10,30],
  "precedent":"RESIDUAL AVAX six adopted filters+exits fixed; PENGU existing -8%/-6% stop unchanged",
  "limits":["historically selected 67 PENGU trades; in-sample exploratory",
   "H1 model entry price versus M5 spot 1-5% observed candidate distortions: sensitivity only",
   "M5 bar closes and next open are not venue actual fills",
   "V52 original frozen candidate tape has suppressed signal gap",
   "No real venue native stop ACK/restart or LIVE Production SHA parity"],"cases":collected}
 audit={"status":combined["status"],"cases":{}}
 def metrics(rows):
  winners=[x for x in rows if float(x['total_pnl_jpy'])>0]
  losers=[x for x in rows if float(x['total_pnl_jpy'])<=0]
  pnl=lambda z:float(z['modeled_realized_pnl_jpy_at_exit_fx'])
  return {"n":len(rows),"wins":len(winners),"losses":len(losers),
   "modeledPnlJpy":sum(pnl(x) for x in rows),"grossLossJpy":sum(pnl(x) for x in losers),
   "hardStopCount":sum('HARD_STOP' in str(x['exit_reason_actual']) for x in rows),
   "worstIndividualLossJpy":min([pnl(x) for x in losers],default=0),
   "profitFactor":sum(pnl(x) for x in winners)/abs(sum(pnl(x) for x in losers))
    if losers and sum(pnl(x) for x in losers)<0 else None}
 for name,case in collected.items():
  for c,values in case['costs'].items():
   assert values['accounting']=='PASS'
   assert values['reselectionPasses']==3
   trades=getrows(values['ledgerSha256'])
   assert len(trades)==values['closedTrades']
   pengu=[x for x in trades if x['strategy_id']=='PENGU']
   assert len(pengu)==values['penguN']
   def route(z):
    return {'SHORT':'SHORT','RECOVERY_V8':'RECOVERY_V8'}.get(z['entry_version'],'BASE_LONG')
   allsoft=[x for x in pengu if 'RESEARCH_PENGU_TIMED_NEGATIVE_' in str(x.get('exit_reason_actual',''))]
   assert len(allsoft)==values['penguTimedStops']
   changed=[]
   for x in allsoft:
    old=bases[c].get((x['entry_ts_ms'],x['side'],x['entry_version']))
    before=float(old['modeled_realized_pnl_jpy_at_exit_fx']) if old else None
    after=float(x['modeled_realized_pnl_jpy_at_exit_fx'])
    changed.append({"entryTsMs":x['entry_ts_ms'],"side":x['side'],"route":x['entry_version'],
      "oldExit":old['exit_reason_actual'] if old else None,
      "oldPnlJpy":before,"newPnlJpy":after,
      "modelPnlDeltaJpy":after-before if before is not None else None,
      "baselineHadWon":bool(float(old['total_pnl_jpy'])>0) if old else None,
      "protectedOriginalHardStop":bool('HARD_STOP' in old['exit_reason_actual']) if old else None})
   groups={'ALL_PENGU':pengu,'SHORT_V20':[x for x in pengu if x['entry_version']=='SHORT_V20'],
    'LONG_V2_FINAL':[x for x in pengu if x['entry_version']=='LONG_V2_FINAL'],
    'RECOVERY_V8':[x for x in pengu if x['entry_version']=='RECOVERY_V8']}
   audit["cases"].setdefault(name,{})[c]={"portfolioFinalEquityJpy":values['finalEquityJpy'],
    "portfolioDdPct":values['ddPct'],"portfolioPf":values['portfolioPF'],
    "portfolioN":values['closedTrades'],"portfolioDeltaJpy":values['deltaVsDualJpy'],
    "routeMetrics":{k:metrics(v) for k,v in groups.items()},
    "earlyStops":changed,"earlyStopN":len(changed),
    "baselineWinnersCut":sum(d['baselineHadWon'] is True for d in changed),
    "originalHardStopsIntercepted":sum(d['protectedOriginalHardStop'] is True for d in changed),
    "directModeledJpyImprovementAmongMatched":sum(d['modelPnlDeltaJpy'] for d in changed if d['modelPnlDeltaJpy'] is not None),
    "directWorsenedMatchedCount":sum(d['modelPnlDeltaJpy'] is not None and d['modelPnlDeltaJpy']<0 for d in changed)}
   print(name,c,"gain",round(values['deltaVsDualJpy']),
    "dd",round(values['ddPct'],5),"N",values['closedTrades'],
    "winners",len([x for x in pengu if x['total_pnl_jpy']>0]),"stop",len(allsoft),
    "priorHardIntercept",audit["cases"][name][c]["originalHardStopsIntercepted"],
    "PnLImprovedMatchingJPY",round(audit["cases"][name][c]["directModeledJpyImprovementAmongMatched"]),
    flush=True)
 dest.mkdir(parents=True,exist_ok=True)
 for target,payload in ((dest/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_COMBINED_20261023.json',combined),
                         (dest/'PENGU_TIMED_NEGATIVE_NATIVE_FULL8_AUDIT_20261023.json',audit)):
  target.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding='utf8',newline='\n')
  print("AUDIT_SAVED",target,"BYTES",target.stat().st_size)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
 main(p.parse_args().output)
