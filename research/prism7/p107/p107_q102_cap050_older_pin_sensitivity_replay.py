#!/usr/bin/env python3
"""P107 research-only economic sensitivity:
replay archived older-pin 2026-11-13 BT with effective Q102 per-runner gross 0.50x.
This is NOT current STABLE4 native signal / exit parity. No VPS/exchange calls.
"""
from pathlib import Path
import csv,hashlib,json,math
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
SOURCE=ROOT/"DIRECTION_RESEARCH_20261109"/"STABLE3_REPRO_RECOVERED_20261113"/"canonical_generated_sim_ON_20261113.py"
EXPECTED_SOURCE_SHA256="e96d9cdb199e7d1e40f91b13a42569a3a6a83f22729d840c5da0e5bb577d932e"
WORK=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
DIR=WORK/"P107_OLDER_PIN_Q102_RUNTIME_CAP050_SENSITIVITY_V2_20261122"
BASE=ROOT/"VPS_EFFECTIVE_CURRENT_CANONICAL_PARITY_Q102_ADOPTED_ON_20261111"
OLD_OUTPUT='O=R/"VPS_EFFECTIVE_CURRENT_CANONICAL_PARITY_Q102_ADOPTED_ON_20261111";O.mkdir(exist_ok=True)'
ENTRY_ANCHOR='s=c["s"];g=c["gross"];reason=""'
ENTRY_REPLACE='s=c["s"];g=c["gross"];reason=""\n   if s=="Q102":g=min(g,0.50) # P107 research: VPS Q102 env maximumGross 0.50'
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def read_csv(path):
 with path.open(newline="",encoding="utf-8-sig") as f:return list(csv.DictReader(f))
def run():
 assert sha(SOURCE)==EXPECTED_SOURCE_SHA256,"SOURCE_SHA_CHANGED"
 text=SOURCE.read_text(encoding="utf-8")
 assert text.count(OLD_OUTPUT)==1,"OUTPUT_ANCHOR_CHANGED"
 assert text.count(ENTRY_ANCHOR)==1,"ENTRY_GROSS_ANCHOR_CHANGED"
 assert not DIR.exists(),"EXPLICIT_REPLAY_OUTPUT_ALREADY_EXISTS; fail closed to prevent overwrite"
 DIR.parent.mkdir(parents=True,exist_ok=True)
 patch=text.replace(OLD_OUTPUT,f'O=pathlib.Path(r"{str(DIR)}");O.mkdir(parents=True,exist_ok=False)',1)
 patch=patch.replace(ENTRY_ANCHOR,ENTRY_REPLACE,1)
 assert patch.count("if s==\"Q102\":g=min(g,0.50)")==1
 # Preflight compilation prior to any output
 compiled=compile(patch,str(SOURCE)+"::Q102_CAP050_READONLY_REPLAY","exec")
 exec(compiled,{"__name__":"__main__"})
 assert sha(SOURCE)==EXPECTED_SOURCE_SHA256,"SOURCE_CHANGED_DURING_REPLAY"
 results={}
 for bps in (10,30):
  manifest=json.loads((DIR/"RUN_MANIFEST.json").read_text(encoding="utf-8-sig"))
  by_bps={m["cost_bps_roundtrip"]:m for m in manifest["results"]}
  m=by_bps[bps]
  prior=json.loads((BASE/next(x.name for x in BASE.glob(f"*_{bps}BPS_SUMMARY.json"))).read_text(encoding="utf-8-sig"))
  fills=read_csv(next(DIR.glob(f"*_{bps}BPS_FILLS.csv")))
  previous_fills=read_csv(next(BASE.glob(f"*_{bps}BPS_FILLS.csv")))
  q=[f for f in fills if f["strategy"]=="Q102"]
  assert len(fills)==int(m["modeled_fills"]),"FILL_COUNT_MISMATCH"
  assert all(float(x["gross_x"])<=0.50000001 for x in q),"LIVE_RUNTIME_Q102_0P5_CAP_VIOLATION"
  assert all(str(f.get("signed_execution_verified","")).strip().lower() in ("","false","0","no") for f in fills),"MODEL_SPURIOUS_SIGNED_FILLS"
  results[str(bps)]={
   "reference_scenario":"ARCHIVED_20261113_OLD_SOURCE",
   "baseline_gross":"OLD_Q102_FAMILY_GROSS",
   "corrected_q102_cap_gross":0.5,
   "baseline_nav":prior["final_compounded_jpy"],
   "corrected_nav":m["final_compounded_jpy"],
   "baseline_signed_max_dd_pct":prior["max_hourly_dd_pct"],
   "corrected_signed_max_dd_pct":m["max_hourly_dd_pct"],
   "baseline_wins_pct":prior["win_rate_pct"],
   "corrected_wins_pct":m["win_rate_pct"],
   "baseline_fills":len(previous_fills),
   "corrected_fills":len(fills),
   "q102_gross_max_in_corrected_fills":max([float(x["gross_x"]) for x in q],default=0),
   "q102_fills":len(q),
   "v4_dd21_blocks":m["blocked_by_reason"].get("V4_MAX_DRAWDOWN_21PCT_HOLD"),
  }
 report={
  "status":"RESEARCH_ONLY_RUNTIME_Q102_CAP050_SENSITIVITY_NOT_FULL_STABLE4_PARITY",
  "production_modified":False,"requests_to_exchange":0,"source_sha256":EXPECTED_SOURCE_SHA256,
  "script_patch_anchor_sha256":hashlib.sha256(patch.encode("utf-8")).hexdigest(),
  "source_runner_pin_mismatch":True,
  "extra_unresolved":["OLD_V4_PIN","OLD_Q102_PIN","OLD_HYPE_PIN","OLD_V52_PIN","V52_H1_PRICE_PROXY","H48_EXIT_SOURCE_MISMATCH","H1_APPROX_EXIT","NO_VENUE_EXECUTION_BOOK"],
  "gross_policy":"P107 research only: Q102 candidate gross capped at 0.50 before order admission and exposure reservation; old other route/model policy unchanged",
  "results":results,
  "output_sha256":{p.name:sha(p) for p in sorted(DIR.glob("*")) if p.is_file()}
 }
 out=WORK/"P107_OLD_PIN_Q102_CAP050_FULL_LEDGER_REPLAY_RESULT_20261122.json"
 out.write_text(json.dumps(report,indent=2,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf-8")
 print("REPLAY_PASS",json.dumps(results,ensure_ascii=False),flush=True)
 print("REPORT_SHA",sha(out),flush=True)
if __name__=="__main__":run()
