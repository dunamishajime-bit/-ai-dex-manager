#!/usr/bin/env python3
"""P100: 4 exploratory combinations of PREDECLARED P97 fixed Binance W,D,12H,4H,1H
negative-point filters restricted to route families with favorable P99 evidence.
This is in-sample selection. Do NOT mark as OOS or production-valid even if
a combination improves relative backtest NAV or DD. Other routes untouched,
PENGU owner-approved prior frozen, V52 excluded, no real/live change.
"""
from pathlib import Path
import hashlib,json
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
SRC=R/"P98_NONV52_DUAL_MARKET_ALLRUNNER_PAIRED"/"P98_PORTFOLIO_BINANCE_NONNEGATIVE_PENGU_BIN5M_UNCHANGED_RESEARCH_ONLY_20261122.py"
OUT=R/"P100_SELECTED_FAMILY_COMBINATION_SHADOW_RISK"
OUT.mkdir(exist_ok=True)
mod={
 "IDLE_RESIDUAL":"c['s'] in ('IDLE','RESIDUAL')",
 "IDLE_Q102BRKPB":"c['s']=='IDLE' or (c['s']=='Q102' and ('|BRK' in c['route'] or '|PB' in c['route']))",
 "Q102BRKPB_RESIDUAL":"c['s']=='RESIDUAL' or (c['s']=='Q102' and ('|BRK' in c['route'] or '|PB' in c['route']))",
 "IDLE_Q102BRKPB_RESIDUAL":"c['s'] in ('IDLE','RESIDUAL') or (c['s']=='Q102' and ('|BRK' in c['route'] or '|PB' in c['route']))"
}
source=SRC.read_text(encoding="utf8")
old='c["p98_gate_pass"]=bool(z["policies"][P98_SCORE_POLICY])'
assert source.count(old)==1 and source.count('O=pathlib.Path(r"')==1
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
output={}
for name,pred in mod.items():
 t=source
 idx=t.index('O=pathlib.Path(r"')
 end=t.index('");O.mkdir(exist_ok=True)',idx)+len('");O.mkdir(exist_ok=True)')
 folder=OUT/name
 t=t[:idx]+f'O=pathlib.Path(r"{folder}");O.mkdir(exist_ok=True)'+t[end:]
 t=t.replace(old,old+f" if ({pred}) else True")
 compile(t,"P100_"+name,"exec")
 dest=OUT/f"P100_EXPLORATORY_{name}_PENGU_BIN5M_UNCHANGED_20261122.py"
 if dest.exists():raise FileExistsError(dest)
 dest.write_text(t,encoding="utf8")
 output[name]={"predicate":pred,"scriptPath":str(dest),"sourceSHA256":sha(dest),"outputFolder":str(folder)}
manifest={"schema":"prism7-p100-disDex-nonv52-selective-binance-signed-fiveTF-portfolio-combos/v1",
 "sourceBinancePolicy":"BINANCE_NONNEGATIVE",
 "combosSelectedAfterInspectingP99SameTargetPeriod":True,
 "status":"EXPLORATORY_ONLY_NOT_UNTOUCHED_OUT_OF_SAMPLE",
 "sourceBaseP98BinanceScoreFullFleet":sha(SRC),
 "combos":output,
 "PENGUAndV52Unchanged":True,
 "same5minEngineSameGrossAsP92":True,
 "noLiveOrdersRiskGateMutations":True}
p=OUT/"P100_FAMILY_COMBO_SOURCE_SHA_MANIFEST_20261122.json"
p.write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
print("P100_COMBOS_PREPARED_RESEARCH_ONLY",json.dumps({k:z["sourceSHA256"] for k,z in output.items()},ensure_ascii=False),flush=True)
