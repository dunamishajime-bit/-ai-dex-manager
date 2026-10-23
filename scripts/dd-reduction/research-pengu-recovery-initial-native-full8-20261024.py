#!/usr/bin/env python3
"""Native all8: Recovery V8 initial negative stop, preserve ordinary LONG profit2 and adopted SHORT dual.
One Recovery-only 24h -3%, never MFE +1%; separate from normal LONG.
Research only.
"""
from __future__ import annotations
import importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(n,p):
 sp=importlib.util.spec_from_file_location(n,p)
 x=importlib.util.module_from_spec(sp);sp.loader.exec_module(x);return x
m=load('pengu_recovery_initial_native_modules',HERE/'research-pengu-initial-negative-native-full8-20261024.py')
base=m.base
previous_eligible=base.eligible
previous_find=base.combined_find
first=base.policy_firstpass
first.CASES['INITIAL_REC_AT24_NEG3_MFE1']={'mode':'INITIAL_RISK','policy':m.screen.POLICIES['AT24_NEG3_MFE1']}
CASES={'NORMAL_PROFIT2_RECOVERY_AT24_NEG3':{'longRules':[],'longScope':'BOTH'}}
def eligible(row,setting):
 if setting is not None and setting.get('longScope')=='BOTH':
  return row.get('strategy_id')=='PENGU' and row.get('symbol')=='PENGUUSDT' and (
   (row.get('side')=='SHORT' and row.get('entry_version')=='SHORT_V20') or
   (row.get('side')=='LONG' and row.get('entry_version') in ('LONG_V2_FINAL','RECOVERY_V8')))
 return previous_eligible(row,setting)
def find(row,source,setting,*,stats=None):
 if row.get('strategy_id')!='PENGU':return None
 if row.get('side')=='SHORT':
  return previous_find(row,source,{'longRules':[],'longScope':'NORMAL'},stats=stats)
 if row.get('entry_version')=='LONG_V2_FINAL':
  return previous_find(row,source,{'longRules':['PEAK2_FLOOR_MINUS5'],'longScope':'NORMAL'},stats=stats)
 if row.get('entry_version')=='RECOVERY_V8':
  return previous_find(row,source,{'longRules':['INITIAL_REC_AT24_NEG3_MFE1'],'longScope':'RECOVERY'},stats=stats)
 return None
base.eligible=eligible
base.combined_find=find
base.CASES=CASES
def main():
 print('RESEARCH_NATIVE_PENGU_RECOVERY_V8_INITIAL_NEGATIVE',flush=True)
 base.main()
if __name__=='__main__':main()
