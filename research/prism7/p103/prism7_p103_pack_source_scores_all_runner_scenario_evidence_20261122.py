#!/usr/bin/env python3
"""P103: durable auditable research text bundles with exact SHA256 per source
for P96 verified Binance archive manifest, P97 all 2715 signed fiveTF scores,
P101 19 scenario findings and all 10/30bps selected-triple simulated
trades/funding/decisions. Base older P92 complete fills already in P94.
All ZIPs are strictly portable ASCII base64, verified decode & inner hashes.
DO NOT bundle source exchange credentials or local .env. No Production write.
"""
from pathlib import Path
import json,io,zipfile,hashlib,base64,csv
R=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
OUT=R/"P103_REUSABLE_ALL_RUNNER_DUAL_MARKET_SCORE_EVIDENCE"
OUT.mkdir(exist_ok=True)
P92=R/"P92_PAIRED_PORTFOLIO_REPLAY"
P100=R/"P100_SELECTED_FAMILY_COMBINATION_SHADOW_RISK"
glob=lambda p,pat:next(p.glob(pat))
sources={
"P96_OFFICIAL_315_ZIP_SHA": [
 R/"results"/"PRISM7_P96_NONV52_ALL_SOURCES_BINANCE_USDM_H1_202507_202610_OFFICIAL_SHA_MANIFEST_20261122.json"],
"P97_ALL2715_COMPLETE_FIVE_TF_SCORE": [
 R/"results"/"PRISM7_P97_ALLRUNNER_NONV52_WEEK_D_12H_4H_1H_AST_BIN_SIGNED_SCORE_SHADOW_20261122.json",
 R/"results"/"PRISM7_P97_ALLRUNNER_2715_RAW_CANDIDATE_ASOF_BINANCE_AST_SIGNED_SCORE_20261122.jsonl"],
"P101_19_PAIRED_SCENARIOS_AND_GATE_DIFFERENCES": [
 R/"results"/"PRISM7_P101_NONV52_ASTER_BINANCE_5TF_SCORE_6_UNIFORM_9_FAMILY_4_COMBO_FULLBT_AUDIT_20261122.json",
 R/"results"/"PRISM7_P101_NONV52_ALLRUNNER_5TF_BINANCE_TREND_NEGATIVE_POINTS_RESEARCH_REPORT_20261122.md",
 R/"results"/"PRISM7_P101_30BPS_SELECTED_FLEET_GATE_ADMISSION_REOPENED_NEWLY_BLOCKED_IDS_20261122.csv",
 R/"P98_NONV52_DUAL_MARKET_ALLRUNNER_PAIRED"/"P98_SOURCE_COMPETITION_MODELS_SHA_MANIFEST_20261122.json",
 R/"P99_NONV52_ROUTE_FAMILY_ABLATION_BTC_BINANCE_MARKET"/"P99_SOURCE_FAMILY_ABLATION_SHA_MANIFEST_20261122.json",
 R/"P100_SELECTED_FAMILY_COMBINATION_SHADOW_RISK"/"P100_FAMILY_COMBO_SOURCE_SHA_MANIFEST_20261122.json"]
}
for fee in (10,30):
 folder=P100/"IDLE_Q102BRKPB_RESIDUAL"
 cases=[]
 for kind in ("DECISIONS","FILLS","FUNDING"):
  cases+=list(folder.glob(f"*_{fee}BPS_{kind}.csv"))
 assert len(cases)==3,(fee,len(cases))
 cases.append(folder/f"STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_{fee}BPS_SUMMARY.json")
 sources[f"P100_TRIPLE_SELECTED_NATIVE_10_30BPS_{fee}BPS_ALL_FILLS_FUNDING_DECISIONS"]=cases
def sha(data):return hashlib.sha256(data).hexdigest()
packs=[]
for name,files in sources.items():
 assert all(p.exists() and p.is_file() for p in files),(name,files)
 image=io.BytesIO();filehash={}
 with zipfile.ZipFile(image,mode="w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for f in files:
   data=f.read_bytes()
   filehash[f.name]={"sizeBytes":len(data),"sha256":sha(data),
     "ownerPC":str(f)}
   z.writestr(f.name,data)
  z.writestr("RESEARCH_ONLY_NOT_EXCHANGE_EXECUTION.txt",
   "All evidence is research-only, no signed exchange fill or actual STOP. Model from older strict V2 does not implement current Stable4 DD21 gate. BINANCE context score is not original independent nonPENGU native trigger.\n")
 bytesz=image.getvalue()
 p=OUT/f"P103_{name}_20261122.zip.b64"
 p.write_text(base64.b64encode(bytesz).decode("ascii")+"\n",encoding="ascii")
 # Exact SHA, contents, size reproducibility verification
 data=base64.b64decode(p.read_text(encoding="ascii").strip(),validate=True)
 assert data==bytesz
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  assert z.testzip() is None
  for fn,meta in filehash.items():assert sha(z.read(fn))==meta["sha256"]
 packs.append({"name":name,"portableBase64Path":str(p),
    "portableBase64SHA256":sha(p.read_bytes()),
    "zipDecodedBytes":len(bytesz),"zipSHA256":sha(bytesz),
    "rawTotalBytes":sum(x["sizeBytes"] for x in filehash.values()),
    "sourceFilesSHA256":filehash,"downloadB64Bytes":p.stat().st_size})
 print("P103_REPRODUCIBLE_ZIP_ARCHIVE",name,"srcCount",len(files),
  "zipsize",len(bytesz),"b64size",p.stat().st_size,flush=True)
m=OUT/"P103_FULL_SOURCE_TAPE_LEDGER_ZIP_SHA_AND_LOCAL_5MIN_EQUITY_PROVENANCE_MANIFEST_20261122.json"
equi={}
for rname,folder in (
 ("ownerPENGU5m_BASE",P92/"BIN5M_CAPS"),
 ("P100_SELECTED_TRIPLE",P100/"IDLE_Q102BRKPB_RESIDUAL")):
 for fee in (10,30):
  files=list(folder.glob(f"*_{fee}BPS_EQUITY_5MIN.csv"))
  assert len(files)==1
  p=files[0]
  equi[f"{rname}_{fee}"]={"ownerPCPath":str(p),"fileBytes":p.stat().st_size,
      "sha256":sha(p.read_bytes()),"reproducibleFromGitHubNativeScript":True}
man={
 "schema":"prism7-p103-portable-5TF-signed-crossvenue-2715-signals-19-paired-model-allrunner-source-funding-fills/v1",
 "researchOnlyAndNoProductionMutation":True,
 "sourcePortfolioTimePeriod":"2025-10-01T00:00:00Z to 2026-10-01T00:00:00Z exclusive",
 "officialBinanceUSDMSHA315AlreadyVerified":True,
 "allNativeSignalScores2715FromAsOfBothVenues":True,
 "previousPENGUOwnerV20EntryUnchanged":True,
 "all19ModesAndSelected10_30BpsResultsArchived":True,
 "fullFiveMinuteEquityRetainedLocallySHA":equi,
 "archives":packs,
 "decodeInstruction":"base64 decode ASCII .zip.b64 to .zip, verify zipSHA256, extract all source files, verify sourceFilesSHA256. Full 5-minute equity stored on owner PC, SHA file here, rebuild with P92/P100 scripts from GitHub research branch.",
 "insampleCombinationDoesNotEstablishFutureDD20OrWinRate":True,
 "noV52Scoring":True
}
m.write_text(json.dumps(man,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf8")
print("P103_PORTABLE_EVIDENCE_MANIFEST_COMPLETE",m,m.stat().st_size,flush=True)
