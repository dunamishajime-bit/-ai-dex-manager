#!/usr/bin/env python3
"""P98: isolate six full-fleet Aster/Binance signed point entry veto policies
around the SAME P92 user-adopted PENGU Binance->ASTER confirm5 base.
Creates 6 new source programs without editing old P92 replay, GitHub master,
Prod, Runner, STOP, or order. Model from old strict V2, 5min read-only,
Native exits remain frozen; no PENGU/V52 gates; original gross unchanged.
"""
from pathlib import Path
import json,hashlib
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
BASE=ROOT/"P92_PAIRED_PORTFOLIO_REPLAY"/"P92_PORTFOLIO_BIN5M_CAPS_REPLAY_20261122.py"
GATE=ROOT/"results"/"PRISM7_P97_ALLRUNNER_2715_RAW_CANDIDATE_ASOF_BINANCE_AST_SIGNED_SCORE_20261122.jsonl"
P98=ROOT/"P98_NONV52_DUAL_MARKET_ALLRUNNER_PAIRED"
P98.mkdir(exist_ok=True)
POLICIES=("ASTER_NONNEGATIVE","BINANCE_NONNEGATIVE","DUAL_NONNEGATIVE",
          "DUAL_SOFT_NEGATIVE_VETO","DUAL_RISK_AWARE","DUAL_STRICT")
SRC=BASE.read_text(encoding="utf8")
assert 'O=pathlib.Path(r"' in SRC
assert SRC.count('elif c["model"] is None:reason=c.get("gate_reason","MISSING_EXIT_PATH")')==1
assert SRC.count('print("CANDIDATES",len(raw),"V52",v52n,"EXIT_MODELS"')==1
assert 'P92_NATIVE_SOURCE_INJECTION' in SRC
assert 'STOCK_CAP=1.5' in SRC and "STEP=300000" in SRC
assert GATE.exists()
allrows=[json.loads(x) for x in GATE.read_text(encoding="utf8").splitlines() if x.strip()]
assert len(allrows)==2715 and len({x["id"] for x in allrows})==2715
assert all(all(k in x["policies"] for k in POLICIES) for x in allrows)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
out={}
for policy in POLICIES:
 txt=SRC
 output=P98/policy
 start='O=pathlib.Path(r"'
 begin=txt.index(start)
 end=txt.index('");O.mkdir(exist_ok=True)',begin)+len('");O.mkdir(exist_ok=True)')
 txt=txt[:begin]+'O=pathlib.Path(r"'+str(output)+'");O.mkdir(exist_ok=True)'+txt[end:]
 assert f'O=pathlib.Path(r"{output}");O.mkdir(exist_ok=True)' in txt
 needle='print("CANDIDATES",len(raw),"V52",v52n,"EXIT_MODELS"'
 ix=txt.index(needle)
 # Place shadow score join after all candidates (including V52) are modeled,
 # without touching any source-native existing entry/exit, stop or gross.
 score_insert=(
  'P98_SCORE_POLICY='+repr(policy)+'\n'
  'p98_path=pathlib.Path(r"'+str(GATE)+'")\n'
  'p98_rows={z["id"]:z for z in jlines(p98_path)}\n'
  'assert len(p98_rows)==2715\n'
  'p98_matched=p98_skipped=0\n'
  'p98_veto=collections.Counter()\n'
  'for c in raw:\n'
  ' if c["s"]=="V52" or c["id"].startswith("PENGU_BIN5_"):\n'
  '  c["p98_gate_pass"]=True\n'
  '  p98_skipped+=1\n'
  '  continue\n'
  ' z=p98_rows.get(c["id"])\n'
  ' assert z is not None,("P98_UNKNOWN_ORIGINAL_ID",c["id"])\n'
  ' assert z["strategy"]==c["s"] and z["route"]==c["route"] and z["symbol"]==c["symbol"] and z["side"]==c["side"] and int(z["entryTs"])==c["t"],("P98_SIGNAL_JOIN_CONFLICT",c["id"])\n'
  ' assert z["usesOnlyCompletedAsterAndBinanceCandles"]\n'
  ' p98_matched+=1\n'
  ' c["p98_gate_pass"]=bool(z["policies"][P98_SCORE_POLICY])\n'
  ' if c["s"]=="PENGU":assert c["p98_gate_pass"]\n'
  ' if not c["p98_gate_pass"]:p98_veto[c["s"]]+=1\n'
  'assert p98_matched==2675 and p98_skipped==94,("P98_SOURCE_TOTAL_ORIGINAL_PLUS_V52_BIN4",p98_matched,p98_skipped)\n'
  'assert p98_skipped==90+4 and sum(p98_veto.values())>0\n'
  'print("P98_CAUSAL_DUAL_MARKET_SCORE_APPLIED",P98_SCORE_POLICY,"PENGU_AND_V52_NO_FILTER","matched",p98_matched,"veto",dict(p98_veto),flush=True)\n'
 )
 txt=txt[:ix]+score_insert+txt[ix:]
 original='elif c["model"] is None:reason=c.get("gate_reason","MISSING_EXIT_PATH")'
 changed=(original+'\n'
   '   elif not c.get("p98_gate_pass",True):reason="P98_PREENTRY_"+P98_SCORE_POLICY')
 txt=txt.replace(original,changed)
 assert txt.count("P98_PREENTRY_")==1
 assert txt.count("P92_NATIVE_SOURCE_INJECTION")==1
 dest=P98/f"P98_PORTFOLIO_{policy}_PENGU_BIN5M_UNCHANGED_RESEARCH_ONLY_20261122.py"
 if dest.exists():raise RuntimeError("P98_ALREADY_EXISTS:"+str(dest))
 dest.write_text(txt,encoding="utf8")
 out[policy]={"script":str(dest),"sourceSHA256":sha(dest),"outputFolder":str(output)}
 meta={"schema":"prism7-p98-stable-P92-adopted-pengu-binance-5m-nonv52-signed-5TF-score-policy-audit-engine/v1",
 "allSourceScoreSHA256":sha(GATE),"basePENGUAdoptedP92ScriptSHA256":sha(BASE),
 "allModes":out,"frozenBeforePortfolioResultReview":True,
 "PENGUAndV52NotModified":True,
 "nativeExitPinnedResearchModelUnchanged":True,
 "riskCalculationSame5mAsP92":True,"nativeSourcePotential0p25IsNotNewPolicy":True,
 "completeAsOfOnly":True,
 "oldResearchEngineNoLatestV4DD21Hold":True,"notProduction":True}
 m=P98/"P98_SOURCE_COMPETITION_MODELS_SHA_MANIFEST_20261122.json"
 m.write_text(json.dumps(meta,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
 print("P98_SIX_ISOLATED_FIXED_SCORE_POLICIES_SOURCE_GENERATED",json.dumps(out,ensure_ascii=False),flush=True)
 print("MANIFEST",m,sha(m))
if __name__=="__main__":main()
