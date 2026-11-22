#!/usr/bin/env python3
"""P105: archive 32 literal deterministic route-matched shadow-filter masks,
plus P104 validation and reproducible sha256 manifests as ASCII base64 ZIP.
No real exchange account/credentials, no master/LIVE writes.
"""
from pathlib import Path
import json,hashlib,zipfile,io,base64
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
D=R/"P102_BINANCE_TF_RANDOM_VETO_PLACEBO"
OUT=R/"P103_REUSABLE_ALL_RUNNER_DUAL_MARKET_SCORE_EVIDENCE"
MASKS=sorted(D.glob("P102_RANDOMIZED_PER_SOURCE_ROUTE_SCORE_GATE_*_20261122.json"))
assert len(MASKS)==32
src=[*MASKS,D/"P102_PLACEBO_FROZEN_SHA_RUN_MANIFEST_20261122.json",
 R/"results"/"PRISM7_P104_THIRTYTWO_MARCHED_PER_ROUTE_RANDOM_VETO_PLACEBO_FALSIFICATION_20261122.json",
 R/"results"/"PRISM7_P104_ALLRUNNER_DIRECTIONAL_POINT_SCORE_32_PLACEBOS_OUTCOME_20261122.md"]
def sha(x):return hashlib.sha256(x).hexdigest()
meta={}
bio=io.BytesIO()
with zipfile.ZipFile(bio,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in src:
  assert p.exists()
  content=p.read_bytes()
  meta[p.name]={"sha256":sha(content),"bytes":len(content)}
  z.writestr(p.name,content)
body=bio.getvalue()
fname=OUT/"P105_32_ROUTE_MATCHED_RANDOM_FILTER_MASKS_AND_FALSIFICATION_20261122.zip.b64"
fname.write_text(base64.b64encode(body).decode("ascii")+"\n",encoding="ascii")
a=base64.b64decode(fname.read_text(encoding="ascii").strip(),validate=True)
assert a==body
with zipfile.ZipFile(io.BytesIO(a)) as z:
 assert z.testzip() is None
 for n,entry in meta.items():
  assert sha(z.read(n))==entry["sha256"]
manifest={
 "schema":"prism7-p105-32-fixed-route-matched-random-veto-masks-source-verification/v1",
 "sourceMode":"RESEARCH_ONLY_NOT_CAUSALLY_TRADEABLE",
 "routeSideSymbolCountsPreserved":True,
 "thirtyTwoCompleteMasks":True,
 "filename":fname.name,
 "originalMasksSourcePC":str(D),
 "base64SHA256":sha(fname.read_bytes()),
 "zipSHA256":sha(body),
 "compressedBytes":len(body),
 "base64Bytes":fname.stat().st_size,
 "all34ContentFilesSHA256":meta,
 "reproduction":"Decode .zip.b64 ASCII base64 to ZIP, verify zipSHA256, unzip, hash each named file to all34ContentFilesSHA256.",
 "originCode":"research/prism7/p102/prism7_p102_extend_thirtytwo_route_preserved_placebos_20261122.py",
 "noProductionOrTradingCodeChanged":True}
m=OUT/"P105_32_MASKS_AND_32_FLEET_RUNS_EVIDENCE_SHA_MANIFEST_20261122.json"
m.write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
print("P105_COMPLETE_32_MASKS_AND_P104_AUDIT_ARCHIVED",fname.stat().st_size,"sourceSha",manifest["base64SHA256"])
print("P105_MANIFEST",m,m.stat().st_size)
