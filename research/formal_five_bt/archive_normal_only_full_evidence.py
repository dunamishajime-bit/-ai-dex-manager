"""Archive every input, candidate, modeled fill, event and accounting row of the anchored 5-logic research BT. Never live fills."""
from __future__ import annotations
import argparse, hashlib, json, subprocess, tarfile
from collections import Counter
from pathlib import Path
from math import isclose

TAG="bt-v12-score100-volume080-normalonly-20260928"
ORIG="a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"
SELECTED="dbf84542311c15f69508f91a0e7311ff7e686d96"
CASE="BRK0P75_MR0P75_FET1_DUAL_GATE"
ANCHORS={
"PRICE_MODEL_10BPS":{"original":[130287867.06655651,-.22944963848991073,2.4176125792561076,1046],
                     "selected":[141845207.7243423,-.22873351303266531,2.0771737482823114,1284]},
"PRICE_MODEL_8BPS":{"original":[155417832.2837019,-.2283242854192271,2.464228135438672,1046],
                    "selected":[175059528.3889343,-.22742907668802037,2.124076416274601,1284]}}
def sha(p:Path)->str:
 h=hashlib.sha256()
 with p.open("rb") as f:
  for part in iter(lambda:f.read(1024*1024),b""): h.update(part)
 return h.hexdigest()
def read(p):return json.loads(p.read_text(encoding="utf-8"))
def write(p,d):
 p.parent.mkdir(parents=True,exist_ok=True)
 p.write_text(json.dumps(d,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf-8")
def checked_scenario(root,scenario,label):
 summary=read(root/"requested-combo-summary.json")
 case=summary["cases"][CASE]
 assert case["status"]=="ALL_FIVE_H1_PRICE_MODEL_NOT_FORMAL_L2_VERIFIED" and case["v52_model_complete"] is True
 row=next(r for r in case["scenarios"] if r["scenario_id"]==scenario)
 actual=[row["final_equity_jpy"],row["maximum_mtm_drawdown"],row["profit_factor"],row["closed_trades"]]
 for name,value,expected in zip(("equity","dd","pf","trades"),actual,ANCHORS[scenario][label]):
  if not isclose(value,expected,abs_tol=.1 if name=="equity" else 1e-9,rel_tol=0):
   raise ValueError("ANCHOR_MISMATCH:"+label+":"+scenario+":"+name+":"+str(value))
 assert row["accounting_reconciliation"]["status"]=="PASS"
 d=root/CASE/scenario
 required=("portfolio-trades.jsonl","candidate-decisions.jsonl","portfolio-events.jsonl","metrics.json")
 for fname in required:
  if not (d/fname).is_file() or (d/fname).stat().st_size==0:raise ValueError("MISSING_FULL_MODEL_LEDGER:"+str(d/fname))
 if sum(1 for line in (d/"portfolio-trades.jsonl").open() if line.strip())!=row["closed_trades"]:
  raise ValueError("TRADE_LEDGER_COUNT_MISMATCH:"+scenario+":"+label)
 return actual
def main():
 p=argparse.ArgumentParser()
 for name in ("data","base_scans","base_candidates","selected_scans","selected_candidates","v52_ledger","v52_source_archive",
              "base_report","selected_report","reports","repo","output"):
  p.add_argument("--"+name.replace("_","-"),required=True,type=Path)
 a=p.parse_args()
 comparison=read(a.reports/"selected-v12-five-logic-comparison.json")
 parity=read(a.reports/"original-baseline-parity.json")
 proof=read(a.reports/"research-source-provenance.json")
 v52=read(a.v52_ledger/"restore-provenance.json")
 if comparison["status"]!="RESEARCH_5LOGIC_SELECTED_V12_COMPARISON_COMPLETE_NOT_L2_VERIFIED" or parity["status"]!="ORIGINAL_5LOGIC_BASELINE_EXACT_PARITY_PASS":
  raise ValueError("PAIRWISE_CERTIFICATION_MISSING")
 if proof["status"]!="RESEARCH_PATCHED_1_OF_90_ONLY_NOT_PRODUCTION" or proof["unchanged_source_count"]!=89 or not proof["source_data_identical"]:
  raise ValueError("OTHER_SOURCE_MODIFIED")
 if proof["research_source_commit"]!=SELECTED or proof["original_commit"]!=ORIG or proof["live_updated"] or set(proof["changed_sources"])!={"config/v12X1AllRuntime.ts"}:
  raise ValueError("NOT_NORMAL_GATE_ONLY")
 if v52["status"]!="ARCHIVED_ORIGINAL_V52_TAPE_RESTORED_EXACT_SHA256" or (v52["model_closed"],v52["model_skipped"])!=(88,11):
  raise ValueError("V52_NOT_SHA_PINNED")
 for scenario in ANCHORS:
  checked_scenario(a.base_report,scenario,"original")
  checked_scenario(a.selected_report,scenario,"selected")
 original_config=subprocess.run(["git","show",ORIG+":config/v12X1AllRuntime.ts"],cwd=a.repo,check=True,capture_output=True).stdout
 selected_config=a.repo/"research/formal_five_bt/runtime_source_snapshot/config/v12X1AllRuntime.ts"
 if hashlib.sha256(original_config).hexdigest()!=proof["changed_sources"]["config/v12X1AllRuntime.ts"]["original_sha256"]:
  raise ValueError("ORIGINAL_CONFIG_HASH_FAILED")
 if sha(selected_config)!=proof["changed_sources"]["config/v12X1AllRuntime.ts"]["research_sha256"]:
  raise ValueError("SELECTED_CONFIG_HASH_FAILED")
 a.output.mkdir(parents=True,exist_ok=True)
 extra=a.output/"source-original-versus-selected"
 extra.mkdir(exist_ok=True)
 (extra/"original-v12-config.ts").write_bytes(original_config)
 (extra/"adopted-v12-config.ts").write_bytes(selected_config.read_bytes())
 market=read(a.data/"acquisition-manifest.json")
 restored=dict(market)
 restored["runtime_sha"]=proof["original_runtime_sha"]
 restored.pop("research_data_manifest_parent_sha256",None)
 blob=(json.dumps(restored,sort_keys=True,indent=2,ensure_ascii=False,allow_nan=False)+"\n").encode()
 if hashlib.sha256(blob).hexdigest()!=proof["original_market_manifest_sha256"]:
  raise ValueError("ORIGINAL_MARKET_MANIFEST_NOT_RECONSTRUCTIBLE")
 (extra/"original-acquisition-manifest.json").write_bytes(blob)
 roots={
 "market-Aster-H1-funding-and-manifests":a.data,
 "baseline-complete-signal-and-gate-decisions":a.base_scans,
 "selected-complete-signal-and-gate-decisions":a.selected_scans,
 "baseline-crypto-modeled-entry-exit-ledgers":a.base_candidates,
 "selected-crypto-modeled-entry-exit-ledgers":a.selected_candidates,
 "v52-SHA-verified-original-ledger":a.v52_ledger,
 "v52-SHA-verified-source-evidence":a.v52_source_archive,
 "baseline-five-logic-all-cases-all-costs":a.base_report,
 "selected-five-logic-all-cases-all-costs":a.selected_report,
 "certification-and-paired-monthly-equity":a.reports,
 "all-reconstruction-code-plus-90-file-audited-source":a.repo/"research/formal_five_bt",
 "original-versus-selected-V12-config":extra,
 }
 excluded={".git",".env","secrets","credentials","node_modules","__pycache__"}
 files=[]
 for category,root in roots.items():
  if not root.is_dir():raise ValueError("ARCHIVE_CATEGORY_ABSENT:"+category)
  for f in sorted(root.rglob("*")):
   if not f.is_file():continue
   if f.is_symlink():raise ValueError("ARCHIVE_SYMLINK_UNSAFE:"+str(f))
   if any(part in excluded or part.startswith(".env") for part in f.relative_to(root).parts):continue
   if f.name.endswith((".pyc",".lock")):continue
   files.append({"path":category+"/"+f.relative_to(root).as_posix(),"sha256":sha(f),"bytes":f.stat().st_size,
                 "category":category,"local":f})
 counts=dict(Counter(r["category"] for r in files))
 if len(files)<60 or any(counts.get(category,0)==0 for category in roots):raise ValueError("INCOMPLETE_ARCHIVE")
 for sc in ANCHORS:
  for fname in ("portfolio-trades.jsonl","candidate-decisions.jsonl","portfolio-events.jsonl","metrics.json"):
   need="selected-five-logic-all-cases-all-costs/"+CASE+"/"+sc+"/"+fname
   if need not in {f["path"] for f in files}:raise ValueError("MISSING_CRITICAL_LEDGER:"+need)
 idx={"status":"FULL_FROZEN_REPLAY_BUNDLE_VERIFIED_NOT_REAL_FILLS","tag":TAG,"original_source_sha":ORIG,
      "adopted_normal_gate_source_sha":SELECTED,"year":"2025-08-10..2026-08-10",
      "initial_jpy":10000,"monthly_deposit_jpy":10000,"monthly_deposits":12,
      "normal_score_min":1.00,"minimum_volume_ratio":.80,"both_rescue_routes":"ORIGINAL_UNCHANGED",
      "v52_original_source_sha256":v52["archive_decisions_sha256"],
      "v52_restored_ledger_sha256":v52["reconstructed_v52_ledger_sha256"],
      "scenario_anchors":ANCHORS,"file_counts":counts,"files":[{k:v for k,v in f.items() if k!="local"} for f in files],
      "limitations":["Every recorded fill is simulated using H1 price models, NEVER a real Aster order execution",
                     "ECB FX reference not actual USDTJPY", "No order-book execution/liquidation path evidence",
                     "In-sample 1-year replay only; no independently verified out-of-sample period"]}
 index=a.output/"REPLAY_INDEX.json";write(index,idx)
 usage=a.output/"HOW_TO_REUSE.md"
 usage.write_text(
  "# Immutable V12 Score1.00 / Volume0.80 yearly five-strategy research BT\n\n"
  "PRIMARY ADOPTED SCENARIO (10bps): selected-five-logic-all-cases-all-costs/"+CASE+"/PRICE_MODEL_10BPS/\n"
  "The portfolio-trades.jsonl file is EVERY simulated closed fill; candidate-decisions.jsonl records every accepted/rejected candidate; "
  "portfolio-events.jsonl records allocation, funding, deposits, MTM/cashflows; metrics.json includes monthly equity.\n"
  "8bps sensitivity is sibling PRICE_MODEL_8BPS. Original baseline is baseline-five-logic-all-cases-all-costs.\n"
  "All original/selected V12/PENGU/FET/Q102 scans, V52 SHA-pinned ledger/source tape, historical Aster H1/funding "
  "and all source/replay code are included. REPLAY_INDEX.json lists SHA256 and byte sizes for EVERY file.\n"
  "Original Score1.4649/volume0.9845 -> selected Score1.00/volume0.80. Strong Regime and Momentum rescue unchanged. "
  "Q102 BRK/MR 0.75x, FET 1.0x with two FET entry blocks, PENGU unchanged. Annual 2025-08-10..2026-08-10 "
  "JPY10,000 initial and monthly JPY10,000 x12, full integrated capital conflict.\n"
  "ALL RECORDED FILLS ARE HISTORICAL H1 SIMULATIONS, NOT LIVE ASTER EXECUTIONS.\n",encoding="utf-8")
 out=a.output/(TAG+".tar.gz")
 with tarfile.open(out,"w:gz",compresslevel=5) as tar:
  for f in files:tar.add(f["local"],arcname=TAG+"/"+f["path"],recursive=False)
  for path in (index,usage):tar.add(path,arcname=TAG+"/"+path.name,recursive=False)
 checksum=sha(out)
 (a.output/(TAG+".sha256")).write_text(checksum+"  "+out.name+"\n",encoding="utf-8")
 release={"tag":TAG,"archive_filename":out.name,"archive_sha256":checksum,"archive_bytes":out.stat().st_size,
          "verified_file_count":len(files),"category_counts":counts,
          "original_10bps":ANCHORS["PRICE_MODEL_10BPS"]["original"],
          "adopted_10bps":ANCHORS["PRICE_MODEL_10BPS"]["selected"],
          "modeled_not_live_fills":True,"provenance_sha_verified":True}
 write(a.output/"RELEASE_MANIFEST.json",release)
 print("FULL_YEAR_ALL_FILLS_ALL_LEDGER_BUNDLE_COMPLETE",json.dumps(release,sort_keys=True),flush=True)
if __name__=="__main__":main()
