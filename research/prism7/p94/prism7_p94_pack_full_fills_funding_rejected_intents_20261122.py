#!/usr/bin/env python3
"""P94 preserve full 10/30bps accepted and rejected portfolio trade evidence
in portable base64(zip) for the research GitHub branch.
NO unbounded 5minute equity CSV in GitHub; hash and local path included.
All 5m equity files retained unchanged on owner computer and rebuildable via
P92 source engine. This is research only, no account credentials included.
"""
import csv,json,hashlib,base64,zipfile,io
from pathlib import Path
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\P92_PAIRED_PORTFOLIO_REPLAY")
OUT=ROOT/"P94_PORTABLE_LEDGER_BUNDLES"
OUT.mkdir(exist_ok=True)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
reports=[]
for mode in ("BASE5M_CAPS","BIN5M_CAPS"):
 folder=ROOT/mode
 for fee in (10,30):
  meta={"mode":mode,"feeBps":fee,"researchSourceOnly":True,"sourceP92EngineSHA256":sha(next(ROOT.glob(f"*{mode}*REPLAY_20261122.py"))),
       "files":{},"excludedEquitySourceRetainedLocal":{}}
  source=[]
  for p in folder.glob(f"*_{fee}BPS_*.csv"):
   if "_EQUITY_5MIN.csv" in p.name:
    meta["excludedEquitySourceRetainedLocal"][p.name]={"path":str(p),"size":p.stat().st_size,"sha256":sha(p),"canReproduceFromIsolatedP92Source":True}
   else:
    source.append(p)
  assert len(source)>=5
  b=io.BytesIO()
  with zipfile.ZipFile(b,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as zipf:
   for p in sorted(source):
    raw=p.read_bytes()
    zipf.writestr(p.name,raw)
    meta["files"][p.name]={"size":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}
   zipf.writestr("PORTFOLIO_RESEARCH_ONLY_NOT_SIGNED_VENUE_TRADES.txt",
       "P94: only research modeled Aster and Binance STOP/entries, NOT real orders. Original P92 engine older and lacks V4 DD21 gate; see P93 JSON.\n")
  zipbytes=b.getvalue()
  # SHA of unaltered zipped bytes, validate the written compressed bundle.
  ascii_file=OUT/f"P94_{mode}_{fee}BPS_SOURCE_MODEL_FILLS_DECISIONS_FUNDING_ALL_RUNNERS_20261122.zip.b64"
  ascii_file.write_text(base64.b64encode(zipbytes).decode("ascii")+"\n",encoding="ascii")
  assert base64.b64decode(ascii_file.read_text(encoding="ascii").strip())==zipbytes
  with zipfile.ZipFile(io.BytesIO(zipbytes)) as z:
   for k,v in meta["files"].items():assert hashlib.sha256(z.read(k)).hexdigest()==v["sha256"]
  meta["zipSHA256"]=hashlib.sha256(zipbytes).hexdigest()
  meta["portableBase64SHA256"]=sha(ascii_file)
  meta["portableBundlePath"]=str(ascii_file)
  meta["compressedSizeBytes"]=len(zipbytes)
  reports.append(meta)
  print("P94_BUNDLE_CREATED",mode,fee,"files",len(source),
      "b64bytes",ascii_file.stat().st_size,"zipSHA",meta["zipSHA256"],flush=True)
report={
 "schema":"prism7-p94-portable-full-research-only-allrunner-model-fills-decisions-funding-10-30bps-base-vs-binance5m/v1",
 "portableBundles":reports,
 "fullUnabridgedFiveMinuteEquityTimeSeriesStoredOnOwnerPC":True,
 "oneYearOriginalNativeAndNewAllRunnerSemanticsPinned":True,
 "masterProductionRunnerStopOrdersUnchanged":True,
 "rebuildSteps":"Decode ASCII base64 .zip.b64 to bytes and decompress ZIP; compare every original file SHA256 to manifest. For 5m equity CSV use P92 isolated source engine and input SHA fixed in P93.",
 "criticalLimit":"STABLE4 and V4 DD21 20261122 full parity not in P92 model; 673 prior DD block recoveries cannot be determined here."}
f=OUT/"P94_BUNDLES_REPRODUCIBILITY_SHA_MANIFEST_20261122.json"
f.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
print("P94_BUNDLE_MANIFEST",f,f.stat().st_size)
