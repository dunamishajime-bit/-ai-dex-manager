#!/usr/bin/env python3
"""RESEARCH ONLY: capped 55-minute high-WR independent RENDER native8 replay.
Causal fixed max hold uses authenticated Binance 5m source prices from prior audit.
Separate follow-up to observed TAO collision; retrospective hypothesis, NOT OOS.
All live orders, VPS, Production, HP and source runners remain untouched.
"""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json,sys
from pathlib import Path
ROOT=Path('C:/tmp')
REPO=ROOT/'render4427-independent-gates-audit-20261024'
PARENT=REPO/'scripts/dd-reduction/render_4427_highwr_native8_wick_sharp_s6_20261025.py'
CAPJSON=REPO/'docs/research/results/render4427-scoped-priority-native8-20261024/RENDER_4427_HIGHWR_TIME_CAP_M5_45_360MIN_20261025.json'
spec=importlib.util.spec_from_file_location('render4427_highwr55_native_child',PARENT)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
cap=json.loads(CAPJSON.read_text('utf8'))
chosen={r['entry_ts_ms']:r for r in cap['results']['55']['trades']}
assert len(chosen)==6
oldcase=m.NEWCASE
case='RENDER_4427_HIGHWR_WICK_SHARP_MAX55M_NATIVE8_20261025'
m.previous.CASE_RULES[case]={k:list(v) for k,v in m.previous.CASE_RULES[oldcase].items()}
m.previous.PROFIT_FLOOR[case]=m.previous.PROFIT_FLOOR[oldcase]
m.native.NEW_CASES[case]=dict(m.native.NEW_CASES[oldcase])
m.NEWCASE=case;m.runner.case=case
before=[(r['t'],r['net30']) for r in m.runner.forward_new]
for ev in m.runner.forward_new:
 row=chosen[ev['t']]
 assert row['net30Pct']>=-2.30001
 assert abs(row['entry_price_binance']-(next(z['entry_price_binance'] for z in cap['results']['360']['trades'] if z['entry_ts_ms']==ev['t'])))<1e-9
 ev['net30']=row['net30Pct'];ev['exitTs']=row['exit_ts_ms']
 assert ev['t']<=ev['exitTs']<=ev['t']+55*60000
source_inject=m.injection
def capped_injection(source,cost_bps):
 rows=source_inject(source,cost_bps)
 for row in rows:
  if row.get('route')==m.NEW_ROUTE:
   assert int(row['entry_ts_ms']) in chosen
   row['exit_reason']='RESEARCH_HIGHWR_WICK_S6_MAX55MIN'
   row['research_causal_source']='BINANCE_5M_ASOF_WICK35_H1DOWN05_EXPANDING_HIGHWR_FIXED_MAX55M_AFTER_INCUMBENT_TAO_COLLISION_RESEARCH'
 return rows
m.native.research_new_rows=capped_injection
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--output',type=Path,required=True)
 args=ap.parse_args()
 assert args.output.resolve().as_posix().lower().startswith('c:/tmp/')
 argv=list(sys.argv)
 try:
  sys.argv=[str(PARENT),'--output',str(args.output)]
  m.main()
 finally:
  sys.argv=argv
 evidence={'status':'RESEARCH_ONLY_NATIVE8_WINRATE_FIXED55MIN_COUNTERFACTUAL','case':case,
   'asofPolicy':'same expanding high-WR gates; only hard holding ceiling=55m, TP+1.5%, STOP-2%',
   'capSourceSha256':hashlib.sha256(CAPJSON.read_bytes()).hexdigest(),
   'changeBySignal':[{'t':r['t'],'originalNet30':dict(before)[r['t']],
                      'cappedNet30':r['net30'],'newExitTs':r['exitTs']} for r in m.runner.forward_new],
   'note':'55min ceiling chosen after TAO opportunity was found; ex-post and not OOS.',
   'nativeStillEnforces':'original all8 gross, portfolio owner, cooldown, safety, account/margin. scoped other-symbol core coexistence research only',
   'noRealOrders':True,'venueFillCertified':False,
   'limitations':['No live/venue L2 or true partial-order protection proof','No pristine prospective holdout',
     'New entry source is Binance 5m price model, exits native H1 55min + risk checks','Not approved LIVE']}
 p=args.output/(case+'_additional_audit.json')
 p.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('NATIVE8_HIGHWR_MAX55_COMPLETE',p)
if __name__=='__main__':main()
