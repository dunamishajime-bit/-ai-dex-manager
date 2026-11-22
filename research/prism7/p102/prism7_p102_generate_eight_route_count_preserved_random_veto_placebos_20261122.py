#!/usr/bin/env python3
"""P102: random-label placebo of P100 proposed signed-Binance preentry
gate, exactly preserving per-(strategy,route,symbol,side) rejected signal
counts. Reassign the same veto bit across candidate IDs within the group
with deterministic seeds; full allrunner chronological replay. Selection
within the original source candidate universe uses hindsight and is NOT
a tradable policy, only a falsification for score-vs-generic-risk pruning.
Do not use to tune score thresholds. No full equity CSV for placebo: the
script retains full intraday MTM in-memory and emits result, fills and reason
evidence SHA; no production or live change.
"""
from pathlib import Path
import json,hashlib,random,collections
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
ROOT=R/"P102_BINANCE_TF_RANDOM_VETO_PLACEBO"
SRC=R/"P100_SELECTED_FAMILY_COMBINATION_SHADOW_RISK"/"P100_EXPLORATORY_IDLE_Q102BRKPB_RESIDUAL_PENGU_BIN5M_UNCHANGED_20261122.py"
LEDGER=R/"results"/"PRISM7_P97_ALLRUNNER_2715_RAW_CANDIDATE_ASOF_BINANCE_AST_SIGNED_SCORE_20261122.jsonl"
ROOT.mkdir(exist_ok=True)
REPLICATES=8
rows=[json.loads(x) for x in LEDGER.read_text(encoding="utf8").splitlines() if x.strip()]
assert len(rows)==2715
def target(z):
 return (z["strategy"] in ("IDLE","RESIDUAL") or
   z["strategy"]=="Q102" and ("|BRK" in z["route"] or "|PB" in z["route"]))
groups=collections.defaultdict(list)
for z in rows:
 if target(z):
  groups[(z["strategy"],z["route"],z["symbol"],z["side"])].append(z)
assert len(groups)>=12
nativeBlocked=sum(not z["policies"]["BINANCE_NONNEGATIVE"] for g in groups.values() for z in g)
assert nativeBlocked==42+20+156,(nativeBlocked,"P100_TRIPLE_NATIVE_SOURCE_SCORE_VETO")
text=SRC.read_text(encoding="utf8")
key='c["p98_gate_pass"]=bool(z["policies"][P98_SCORE_POLICY]) if ('
line=next(x for x in text.splitlines() if key in x)
assert text.count(line)==1
assert text.count('p98_rows={z["id"]:z for z in jlines(p98_path)}')==1
assert text.count('def wr(name,rows,cols):')==1
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
models={}
for rep in range(1,REPLICATES+1):
 allow={}
 counts=[]
 for group,zz in sorted(groups.items()):
  src=[bool(z["policies"]["BINANCE_NONNEGATIVE"]) for z in zz]
  v=list(src)
  groupkey="|".join(group)
  stable=int.from_bytes(hashlib.sha256((groupkey+"|"+str(rep)+"|P102").encode("utf8")).digest()[:8],"big")
  rnd=random.Random(stable)
  rnd.shuffle(v)
  assert sum(v)==sum(src)
  allow.update({z["id"]:accept for z,accept in zip(zz,v)})
  counts.append({"group":groupkey,"n":len(zz),"blocked":len(v)-sum(v),"maskChanged":v!=src})
 assert len(allow)==sum(len(x) for x in groups.values())
 assert sum(not x for x in allow.values())==nativeBlocked
 mask=ROOT/f"P102_RANDOMIZED_PER_SOURCE_ROUTE_SCORE_GATE_{rep:02d}_20261122.json"
 mask.write_text(json.dumps(allow,ensure_ascii=True,sort_keys=True,separators=(",",":"))+"\n",encoding="ascii")
 output=ROOT/f"PLACEBO_{rep:02d}"
 candidate=text
 marker='O=pathlib.Path(r"'
 ix=candidate.index(marker);end=candidate.index('");O.mkdir(exist_ok=True)',ix)+len('");O.mkdir(exist_ok=True)')
 candidate=candidate[:ix]+f'O=pathlib.Path(r"{output}");O.mkdir(exist_ok=True)'+candidate[end:]
 candidate=candidate.replace('p98_rows={z["id"]:z for z in jlines(p98_path)}',
   'p98_rows={z["id"]:z for z in jlines(p98_path)}\np102_mask=json.loads(pathlib.Path(r"'+str(mask)+'").read_text(encoding="ascii"))')
 candidate=candidate.replace(line,' c["p98_gate_pass"]=bool(p102_mask.get(c["id"],True))')
 candidate=candidate.replace('def wr(name,rows,cols):',
   'def wr(name,rows,cols):\n if name.endswith("_EQUITY_5MIN.csv"):return')
 assert "p102_mask" in candidate and "EQUITY_5MIN.csv" in candidate
 compile(candidate,"P102_PLACEBO_"+str(rep),"exec")
 dest=ROOT/f"P102_RANDOM_VETO_PLACEBO_REPLAY_{rep:02d}_20261122.py"
 if dest.exists():raise FileExistsError(dest)
 dest.write_text(candidate,encoding="utf8")
 models[str(rep)]={"sourceSHA256":sha(dest),"scriptPath":str(dest),"maskSHA256":sha(mask),
    "maskPath":str(mask),"outputFolder":str(output),
    "candidateCountTarget":len(allow),"sourceTargetBlocks":nativeBlocked,
    "perRouteMaskCountExact":True,
    "routesWithMaskChanged":sum(z["maskChanged"] for z in counts)}
manifest={"schema":"prism7-p102-random-label-negative-point-gate-placebo-source-route-preserving-8-reps/v1",
 "status":"EXPLORATORY_IN_SAMPLE_PLACEBO_NONTRADABLE",
 "replicates":REPLICATES,
 "sourceP100SelectedCombinedBaselineSHA256":sha(SRC),
 "sourceP97HistoricalAsOfScoreSHA256":sha(LEDGER),
 "perSourceRouteSideSymbolTotalNativeBlocksHeldFixed":True,
 "blocks":nativeBlocked,
 "noFutureValidTradableDecisionInRandomMask":True,
 "noFirstPartyActualSignedVenueFill":True,
 "placeholderNo5MinEquityWrittenForPlaceboOnly":True,
 "riskModelStillCalculatedInMemoryByNativeEngine":True,
 "PENGUAndV52AlwaysUnchanged":True,
 "placeboModels":models}
p=ROOT/"P102_PLACEBO_FROZEN_SHA_RUN_MANIFEST_20261122.json"
p.write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
print("P102_PLACEBO_8_SOURCE_ROUTEMATCHED_MASKS_PREPARED",
 json.dumps({"replicates":len(models),"blocks":nativeBlocked,
    "allRowsTarget":len(allow),"sources":[z["sourceSHA256"] for z in models.values()]},ensure_ascii=False),flush=True)
print("MANIFEST",p)
