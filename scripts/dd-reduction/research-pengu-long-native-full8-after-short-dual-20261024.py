#!/usr/bin/env python3
"""Native all-8 dynamic wallet PENGU LONG after the USER-ADOPTED SHORT dual-stop.
Research-only: preserves SHORT (3h -2.5%, 8h -4%); AVAX6 unchanged.
No venue, LIVE/Production or order mutations.
"""
from __future__ import annotations
import importlib.util,json,sys,argparse
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
def load(name,p):
 spec=importlib.util.spec_from_file_location(name,p)
 assert spec and spec.loader
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module
native_wrapper=load("native_pengu_long_study_base",HERE/"research-pengu-timed-negative-native-full8-20261023.py")
policy_firstpass=load("pengu_long_firstpass",HERE/"research-pengu-long-firstpass-20261024.py")
shortPolicy=native_wrapper.policy
orig_find=shortPolicy.find_time_stop
DUAL={
 "mode":"MULTI_CHECKPOINT","scope":"SHORT","checks":[
 {"mode":"AT_HOURS","holdHours":3,"lossPct":2.5,"maxMfePct":None,"scope":"SHORT"},
 {"mode":"AT_HOURS","holdHours":8,"lossPct":4.0,"maxMfePct":None,"scope":"SHORT"}]}
CASES={
 "BASE":None,
 "SHORT_DUAL_BASE":{"longRules":[],"longScope":"NORMAL"},
 "LONG_PEAK2_FLOOR_MINUS5":{"longRules":["PEAK2_FLOOR_MINUS5"],"longScope":"NORMAL"},
 "LONG_PEAK2_FLOOR_MINUS4":{"longRules":["PEAK2_FLOOR_MINUS4"],"longScope":"NORMAL"},
 "LONG_PEAK3_FLOOR_MINUS3":{"longRules":["PEAK3_FLOOR_MINUS3"],"longScope":"NORMAL"},
 "LONG_PEAK3_FLOOR_MINUS3P5":{"longRules":["PEAK3_FLOOR_MINUS3P5"],"longScope":"NORMAL"},
 "LONG_INITIAL2_NEG3_MFE05":{"longRules":["FIRST2_NEG3_MFE05"],"longScope":"NORMAL"},
 "LONG_COMBO_PROFIT2_INITIAL2":{"longRules":["PEAK2_FLOOR_MINUS5","FIRST2_NEG3_MFE05"],"longScope":"NORMAL"},
 "LONG_PEAK4_FLOOR_MINUS2":{"longRules":["PEAK4_FLOOR_MINUS2"],"longScope":"NORMAL"},
 "RECOVERY_PEAK2_FLOOR_MINUS5":{"longRules":["PEAK2_FLOOR_MINUS5"],"longScope":"RECOVERY"},
}
def eligible(row,setting):
 if row.get("strategy_id")!="PENGU" or row.get("symbol")!="PENGUUSDT":return False
 if row.get("side")=="SHORT":return row.get("entry_version")=="SHORT_V20"
 if row.get("side")!="LONG":return False
 if not setting or not setting.get("longRules"):return False
 if setting["longScope"]=="NORMAL":return row.get("entry_version")=="LONG_V2_FINAL"
 if setting["longScope"]=="RECOVERY":return row.get("entry_version")=="RECOVERY_V8"
 return False
def combined_find(row,source,settings,*,stats=None):
 if row['side']=="SHORT":
  options=[orig_find(row,source,check,stats=stats) for check in DUAL["checks"]]
  actual=[z for z in options if z is not None]
  return min(actual,key=lambda z:z["ts"]) if actual else None
 if not eligible(row,settings):return None
 bars,times=source.getdata("PENGUUSDT")
 path,gap=policy_firstpass.make_path(row,bars,times)
 options=[]
 for name in settings["longRules"]:
  found=policy_firstpass.early_exit(path,policy_firstpass.CASES[name],row["entry_ts_ms"])
  if found:options.append((found["ts"],name,found))
 if not options:return None
 ts,name,at=min(options)
 return {"ts":ts,"fill":at["price"],"reason":"PENGU_LONG_"+name,
  "entryTs":row["entry_ts_ms"],"entryVersion":row["entry_version"],"side":"LONG",
  "initialHardStopPct":8 if row["entry_version"]!="RECOVERY_V8" else 6,
  "thresholdPct":None,"holdHours":None,"mfeGatePct":None,
  "mfeAtStopPct":at["mfeBefore"],"minAdversePct":None,
  "closedPriceChangePct":at["closeRet"],"modeledExitReturnPct":at["fillRet"],
  "modelAnchorGapPct":gap}
def main():
 pa=argparse.ArgumentParser()
 pa.add_argument("--output",type=Path,required=True)
 pa.add_argument("--cases",nargs="+",default=list(CASES))
 args=pa.parse_args()
 assert args.cases and set(args.cases)<=set(CASES)
 # Read-only source, output must not be within repo source.
 assert REPO not in (args.output.resolve(),*args.output.resolve().parents)
 native_wrapper.CASES={k:CASES[k] for k in args.cases}
 shortPolicy.eligible=eligible
 shortPolicy.find_time_stop=combined_find
 origargs=sys.argv
 try:
  sys.argv=[str(HERE/"research-pengu-timed-negative-native-full8-20261023.py"),
   "--output",str(args.output),"--cases",*args.cases]
  native_wrapper.main()
 finally:sys.argv=origargs
if __name__=="__main__":main()
