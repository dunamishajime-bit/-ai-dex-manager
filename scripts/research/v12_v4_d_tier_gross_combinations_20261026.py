#!/usr/bin/env python
"""Recompute multi-route D-tier allocation portfolios after single-route sweeps.
Research only, not an order route.
"""
import time, json, hashlib, collections, argparse
from pathlib import Path
import v12_v4_d_tier_gross_sweep_20261026 as b
s=b.s
ROOT=b.ROOT
CASES={
 "COMBO_G3_20_X13_25_CONT_20":{
  "REC_G3_LATE_BTC_REL":.20,"REC_X13_TP1.5_SL1_H24":.25,"CONT_SHORT_MID_AGE24_48":.20},
 "COMBO_G3_25_X13_25_CONT_25":{
  "REC_G3_LATE_BTC_REL":.25,"REC_X13_TP1.5_SL1_H24":.25,"CONT_SHORT_MID_AGE24_48":.25},
 "COMBO_G3_15_X13_15_CONT_15":{
  "REC_G3_LATE_BTC_REL":.15,"REC_X13_TP1.5_SL1_H24":.15,"CONT_SHORT_MID_AGE24_48":.15},
 "COMBO_G3_20_X13_15_CONT_15":{
  "REC_G3_LATE_BTC_REL":.20,"REC_X13_TP1.5_SL1_H24":.15,"CONT_SHORT_MID_AGE24_48":.15},
 "COMBO_G3_25_X13_15_CONT_15":{
  "REC_G3_LATE_BTC_REL":.25,"REC_X13_TP1.5_SL1_H24":.15,"CONT_SHORT_MID_AGE24_48":.15},
 "COMBO_G3_20_X13_20_CONT_20":{
  "REC_G3_LATE_BTC_REL":.20,"REC_X13_TP1.5_SL1_H24":.20,"CONT_SHORT_MID_AGE24_48":.20},
 "COMBO_G3_15_X13_15_CONT_15_X14_15":{
  "REC_G3_LATE_BTC_REL":.15,"REC_X13_TP1.5_SL1_H24":.15,"CONT_SHORT_MID_AGE24_48":.15,
  "REC_X14_TIME_48H":.15},
 "COMBO_G3_20_X13_20_CONT_20_X14_15":{
  "REC_G3_LATE_BTC_REL":.20,"REC_X13_TP1.5_SL1_H24":.20,"CONT_SHORT_MID_AGE24_48":.20,
  "REC_X14_TIME_48H":.15},
}
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--cases",default="all",type=str)
 ns=ap.parse_args()
 chosen=CASES if ns.cases=="all" else {k:v for k,v in CASES.items() if k in ns.cases.split(",")}
 assert chosen
 s.w.OUT=ROOT;s.w.setup();b.v4.install_virtual_leg_study_adapter();b.final.install_final_routes()
 b.v3.stage3_transform=b.final.stage3_candidate_all
 b.v3.FAILED=b.ml.failed_candidates();b.v3.v2.FAILED=b.v3.FAILED
 s.w.base.source_batch=b.ind.custom_source_batch;s.w.base.read_table=b.v3.v2.read_table
 original=s.w.base.patch_admission
 for name,overrides in chosen.items():
  b.v3.CASE[name]={"family_cap":b.CAP["family"],"gross":.10,"slots":16}
  b.ind.ACTIVE_RECOVERY_CAP=b.CAP["family"]
  b.mlift.MAX_LIFT_GROSS=.30;b.ind.ORIG_PATCH=original
  s.w.base.patch_admission=b.sweep.patch;b.COUNTS.clear()
  s.w.base._study_filter=b.make_filter(overrides)
  started=time.monotonic()
  print("COMBO_START",name,flush=True)
  raw=s.w.base.run_study(name,"10,30")
  a=b.outcome(name,overrides,raw,time.monotonic()-started)
  print("COMBO_DONE",name,[(k,round(v["finalEquityJpy"]),round(v["maximumDrawdownPct"],4),v["closedTrades"]) for k,v in a["cases"].items()],flush=True)
 print("FINISHED",len(chosen),flush=True)
if __name__=="__main__":main()
