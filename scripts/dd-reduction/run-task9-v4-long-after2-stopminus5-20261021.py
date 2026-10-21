#!/usr/bin/env python3
"""Research-only +2% MFE arm -> negative-5% stop, layered with +3 -> +1 H1 bearish confirmation."""
from __future__ import annotations
import importlib.util,argparse
from pathlib import Path
HERE=Path(__file__).resolve().parent
f=HERE/"run-task9-v4-long-time37-profit-stop-20261021.py"
s=importlib.util.spec_from_file_location("alltime",f)
assert s and s.loader
m=importlib.util.module_from_spec(s)
s.loader.exec_module(m)
# +3% to +1% bearish H1 exit rule remains constant.
# -5% is a threshold relative to INITIAL ENTRY, NOT relative to the +2% peak:
# the raw price path from +2% to -5% gives back SEVEN percentage points.
OPTIONS=[
  ("X3_AFTER2_STOP_MINUS5",m.old.ROUTES_X,-.05),
  ("TIME37_AFTER2_STOP_MINUS5",m.TIME_ROUTES,-.05),
  ("X3_AFTER2_STOP_MINUS4",m.old.ROUTES_X,-.04),
  ("X3_AFTER2_STOP_MINUS6",m.old.ROUTES_X,-.06),
]
RULES={name:{
 "id":name,"mode":"layered_h1_and_m5_stop","strategy":"V12","sides":["LONG"],
 "routes":routes,"mfe_gte":.03,"close_floor":.01,"bear_bars":2,
 "pre_arm_mfe":.02,"m5_floor":floor,
} for name,routes,floor in OPTIONS}
assert len(RULES)==4
assert RULES["X3_AFTER2_STOP_MINUS5"]["m5_floor"]==-.05
assert RULES["TIME37_AFTER2_STOP_MINUS5"]["m5_floor"]==-.05
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--output",type=Path,default=m.old.ROOT/"2026-10-21_v4_long_after2_minus5_study")
 ap.add_argument("--candidates",nargs="*",default=list(RULES))
 args=ap.parse_args()
 if len(args.candidates)!=len(set(args.candidates)) or not set(args.candidates).issubset(RULES):
  raise RuntimeError("CASE_NOT_AUTHORIZED")
 m.old.RULES.update(RULES)
 m.old.protected_h1_exit=m.apply_layered
 m.old.run(args)
if __name__=="__main__":main()
