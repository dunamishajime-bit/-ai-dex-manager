#!/usr/bin/env python3
"""Research native full8 with NORMAL 12h -4 / MFE<1 + 24h PENGU cooldown and
RECOVERY V8 24h -3 / MFE<1 ordinary exit. Preserves SHORT dual and profit2 floor.
A 60h same-route quarantine is also attached to the NORMAL early risk event.
"""
from __future__ import annotations
import inspect,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(n,p):
 sp=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
rec=load('pengu_combined_recovery_module',HERE/'research-pengu-recovery-initial-native-full8-20261024.py')
base=rec.base
native=base.native_wrapper
parent=rec.previous_find
orig_rfind=rec.find
base.CASES={'NORMAL_12H_HARDCOOL_PLUS_RECOVERY_24H_3P':{'longRules':[],'longScope':'BOTH'}}
def find(row,source,settings,*,stats=None):
 if row.get('strategy_id')=='PENGU' and row.get('side')=='LONG' and row.get('entry_version')=='LONG_V2_FINAL':
  return parent(row,source,{'longRules':['PEAK2_FLOOR_MINUS5','INITIAL_AT12_NEG4_MFE1'],'longScope':'NORMAL'},stats=stats)
 return orig_rfind(row,source,settings,stats=stats)
base.combined_find=find
function=native.main
src=inspect.getsource(function)
old='exit_reason="RESEARCH_PENGU_TIMED_NEGATIVE_"+current+"_"+row["side"],'
new='exit_reason=("RESEARCH_PENGU_INITIAL_ADVERSE_HARD_STOP_COOLDOWN_PROXY" if (row["side"]=="LONG" and row.get("entry_version")=="LONG_V2_FINAL" and "INITIAL_" in str(candidate.get("reason",""))) else "RESEARCH_PENGU_TIMED_NEGATIVE_"+current+"_"+row["side"]),'
assert src.count(old)==1,('UNEXPECTED_BACKTEST_ENGINE_SOURCE',src.count(old))
loc={}
exec(compile(src.replace(old,new),str(HERE/'PENGU_COMBINED_INITIAL_RISK_RESEARCH_ONLY'),"exec"),function.__globals__,loc)
native.main=loc['main']
def main():
 print('RESEARCH_PENGU_COMBINED_NORMAL_12H_COOLDOWN_PLUS_RECOVERY_24H',flush=True)
 base.main()
if __name__=='__main__':main()
