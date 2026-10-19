#!/usr/bin/env python3
"""Rerun 2026-10-17 frozen full8 latest-confirmed exit baseline research only.
Read-only canonical source/ZIP inputs; output in isolated research tree.
One script to handle historical 5m trajectories and two separate LONG exit gates.
DO NOT IMPORT THIS INTO LIVE. No change to original worktree.
"""
import os,sys,types,hashlib,importlib,json,math,functools,bisect
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
UPSTREAM=Path(r"C:/Users/dis/Desktop/disdex-exit-overlay-handoff-20261017/research/exit_overlays_20261017/scripts")
FROZEN=Path(r"C:/Users/dis/DisDex-five-improvements-20261008")
ARCHIVE=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/Previous_Projects/idle-exit-deep-research-20261016/bt120_5m_20261017")
REFERENCE=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-17_qh_idle_overlay/dot_render_trail/DOT_RENDER_TRAIL_3")
OUT=ROOT/"research_runs/long_two_axis_latest_full8_20261019"
COMPARE=ROOT/"docs/research/results/long-loss-research-20261019"
OUT.mkdir(parents=True,exist_ok=True)
COMPARE.mkdir(parents=True,exist_ok=True)

def bootstrap():
 if not ARCHIVE.joinpath("bt120_predeclared_profiles.json").is_file():
  raise FileNotFoundError("latest 2026-10-17 M5 archive is missing")
 os.environ["DISDEX_V4_FROZEN_RESEARCH_ROOT"]=str(FROZEN)
 os.environ["DISDEX_EXIT_RESEARCH_OUTPUT"]=str(OUT)
 sys.path.insert(0,str(UPSTREAM))
 path=UPSTREAM/"bt120_integrated_5minute_full8_20261017.py"
 original=path.read_text("utf8")
 find='ROOT=Path.home()/"Desktop"/"idle-exit-deep-research-20261016"/"bt120_5m_20261017"'
 assert original.count(find)==1
 modified=original.replace(find,"ROOT=Path("+repr(str(ARCHIVE))+")")
 findout='OUT=ROOT/"integrated_full8"'
 assert modified.count(findout)==1
 modified=modified.replace(findout,"OUT=Path("+repr(str(OUT/"discarded_study_integration"))+")")
 name="bt120_integrated_5minute_full8_20261017"
 obj=types.ModuleType(name)
 obj.__file__=str(path)
 sys.modules[name]=obj
 exec(compile(modified,str(path),"exec"),obj.__dict__)
 import bt120_idle_gross_q102hype_20261017 as original_helper
 original_helper.OUT=OUT
 original_helper.base.OUTROOT=OUT
 return obj,original_helper

def orig_provenance():
 names=["idle_profit_trailing_full8_20261016.py",
  "bt120_integrated_5minute_full8_20261017.py",
  "bt120_combined_and_slippage_stress_20261017.py",
  "bt120_idle_gross_q102hype_20261017.py",
  "idle_gross_fractional_isolated_full8_20261016.py"]
 return {n:hashlib.sha256((UPSTREAM/n).read_bytes()).hexdigest() for n in names}

def ensure_baseline(p):
 p.POLICIES["LATEST_20261017_BASELINE"]={"sizes":{"DOTUSDT":.25,"RENDERUSDT":.25},
    "exit":"IDLE_13_TRAIL_3_GIVEBACK_1p5","symbols":{"DOTUSDT","RENDERUSDT"}}

def run_baseline(costs=(10,30)):
 r,p=bootstrap()
 ensure_baseline(p)
 out=[]
 for cost in costs:
  got=p.run("LATEST_20261017_BASELINE",cost)
  orig=json.loads((REFERENCE/f"{cost}bps"/"integrated-summary.json").read_text("utf8"))["output"]
  for name,k in [("final_jpy","final_equity_jpy"),("pf","profit_factor"),("max_dd_pct","maximum_mtm_drawdown"),("annual_trades","closed_trades")]:
   val=got[name]
   expected=orig[k]*100 if name=="max_dd_pct" else orig[k]
   if not math.isclose(val,expected,rel_tol=2e-10,abs_tol=(1e-4 if name=="max_dd_pct" else 1e-6)):raise AssertionError(f"NEW_BASELINE_MISMATCH {cost} {name}: {val} != {expected}")
  if got["accounting"]!="PASS":raise AssertionError("ACCOUNTING_NOT_PASS")
  out.append({"cost":cost,"final_jpy":got["final_jpy"],"max_dd_pct":got["max_dd_pct"],"trades":got["annual_trades"],"passed":True})
 print("LATEST_BASELINE_8_LOGIC_EXACT_PASS",json.dumps(out,ensure_ascii=False),flush=True)
 (COMPARE/"LATEST_8LOGIC_SOURCE_BASELINE_PROOF_20261019.json").write_text(
  json.dumps({"status":"LATEST_20261017_EXACT_FULL8_REPLAY","frozen_sha256":orig_provenance(),
   "latest_baseline":out,"baseline":str(REFERENCE),"market_source":str(ARCHIVE),
   "source_code":str(UPSTREAM),"research_only":True},ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 return out

if __name__=="__main__":
 import argparse
 parser=argparse.ArgumentParser()
 parser.add_argument("--baseline",action="store_true")
 parser.add_argument("--costs",default="10")
 a=parser.parse_args()
 if a.baseline:run_baseline(tuple(int(c) for c in a.costs.split(",")))
