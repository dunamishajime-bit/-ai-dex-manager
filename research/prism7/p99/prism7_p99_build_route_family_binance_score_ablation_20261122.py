#!/usr/bin/env python3
"""P99: source frozen BINANCE_NONNEGATIVE directional 5TF points, one
non-PENGU non-V52 strategy/family at a time, vs P92 adopted PENGU base.
No score threshold optimization. Q102 momentum vs mean-reversion and V4
continuation are pre-declared structural splits, not prospective validation.
Old research engine / no 2026-11-22 STABLE4 DD21 hold.
"""
from pathlib import Path
import json,hashlib
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
SRC=ROOT/"P98_NONV52_DUAL_MARKET_ALLRUNNER_PAIRED"/"P98_PORTFOLIO_BINANCE_NONNEGATIVE_PENGU_BIN5M_UNCHANGED_RESEARCH_ONLY_20261122.py"
OUT=ROOT/"P99_NONV52_ROUTE_FAMILY_ABLATION_BTC_BINANCE_MARKET"
OUT.mkdir(exist_ok=True)
MODELS={
 "V4":"c['s']=='V4'",
 "Q102":"c['s']=='Q102'",
 "IDLE":"c['s']=='IDLE'",
 "FET":"c['s']=='FET'",
 "HYPE":"c['s']=='HYPE'",
 "RESIDUAL":"c['s']=='RESIDUAL'",
 "Q102_TREND_BRK_PB":"c['s']=='Q102' and ('|BRK' in c['route'] or '|PB' in c['route'])",
 "Q102_REV_MR":"c['s']=='Q102' and ('|MR' in c['route'] or '|REV' in c['route'])",
 "V4_CONT_TREND":"c['s']=='V4' and (c['route'].startswith('CONT_') or c['route']=='REC_G5_SLOW_TREND')"
}
source=SRC.read_text(encoding="utf8")
assert source.count('c["p98_gate_pass"]=bool(z["policies"][P98_SCORE_POLICY])')==1
assert source.count('O=pathlib.Path(r"')==1
assert source.count('P98_SCORE_POLICY=')==1
assert 'P98_SCORE_POLICY=\'BINANCE_NONNEGATIVE\'' in source
assert 'P92_NATIVE_SOURCE_INJECTION' in source
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
z={}
for target,predicate in MODELS.items():
 text=source
 beg=text.index('O=pathlib.Path(r"')
 end=text.index('");O.mkdir(exist_ok=True)',beg)+len('");O.mkdir(exist_ok=True)')
 output=OUT/target
 text=text[:beg]+'O=pathlib.Path(r"'+str(output)+'");O.mkdir(exist_ok=True)'+text[end:]
 original='c["p98_gate_pass"]=bool(z["policies"][P98_SCORE_POLICY])'
 changed=f'c["p98_gate_pass"]=bool(z["policies"][P98_SCORE_POLICY]) if ({predicate}) else True'
 text=text.replace(original,changed)
 assert 'P92_NATIVE_SOURCE_INJECTION' in text
 compile(text,"P99_"+target,"exec")
 f=OUT/f"P99_NONV52_TARGET_{target}_BINANCE_NEGATIVE_POINT_FROZEN_PENGU_UNCHANGED_20261122.py"
 if f.exists():raise FileExistsError(f)
 f.write_text(text,encoding="utf8")
 z[target]={"predicate":predicate,"script":str(f),"sourceSHA256":sha(f),"output":str(output)}
manifest={"schema":"prism7-p99-route-family-Binance-5TF-no-negative-point-isolation-ablation/v1",
 "status":"RESEARCH_ONLY_PENGU_BINANCE_5M_UNCHANGED",
 "familyPoliciesFixedBeforeOutcomesEvaluated":True,
 "BinancePolicy":"BINANCE_NONNEGATIVE",
 "allModes":z,"baseP98BinancePolicySHA256":sha(SRC),
 "currentProductionParity":False,
 "noNewGross0p25":True,"noProductionOrdersSTOPRunnerChange":True,
 "thisStageOnlyCausalBinanceContextNotIndependentNativeEntryRecomputation":True}
p=OUT/"P99_SOURCE_FAMILY_ABLATION_SHA_MANIFEST_20261122.json"
p.write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
print("P99_BUILT_9_FAMILY_AND_STRUCTURAL_TARGET_SCRIPTS",json.dumps({k:v["sourceSHA256"] for k,v in z.items()},ensure_ascii=False),flush=True)
print("MANIFEST",p)
