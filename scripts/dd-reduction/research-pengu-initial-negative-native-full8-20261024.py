#!/usr/bin/env python3
"""Native eight-strategy initial-loss LONG validation after approved SHORT dual and recommended LONG profit floor.
Research-only, do not mutate LIVE/Production.
"""
from __future__ import annotations
import argparse,importlib.util,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(n,p):
 sp=importlib.util.spec_from_file_location(n,p)
 x=importlib.util.module_from_spec(sp);sp.loader.exec_module(x);return x
base=load('pengu_initial_native_base',HERE/'research-pengu-long-native-full8-after-short-dual-20261024.py')
screen=load('pengu_initial_screen',HERE/'research-pengu-initial-negative-screen-20261024.py')
profit=base.policy_firstpass
original=profit.early_exit
CASES={
 'PROFIT2_BASE':{'longRules':['PEAK2_FLOOR_MINUS5'],'longScope':'NORMAL'},
 'PROFIT2_PLUS_AT8_NEG5_MFE1':{'longRules':['PEAK2_FLOOR_MINUS5','INITIAL_AT8_NEG5_MFE1'],'longScope':'NORMAL'},
 'PROFIT2_PLUS_ARM35_WATCH2_MFE1':{'longRules':['PEAK2_FLOOR_MINUS5','INITIAL_ARM35_WATCH2_MFE1'],'longScope':'NORMAL'},
 'PROFIT2_PLUS_SUSTAINNEG3_120_MFE1':{'longRules':['PEAK2_FLOOR_MINUS5','INITIAL_SUSTAINNEG3_120_MFE1'],'longScope':'NORMAL'},
 'PROFIT2_PLUS_TOUCH5_AFTER2_MFE1':{'longRules':['PEAK2_FLOOR_MINUS5','INITIAL_TOUCH5_AFTER2_MFE1'],'longScope':'NORMAL'},
 'PROFIT2_PLUS_AT12_NEG4_MFE1':{'longRules':['PEAK2_FLOOR_MINUS5','INITIAL_AT12_NEG4_MFE1'],'longScope':'NORMAL'},
 'PROFIT2_PLUS_H1X2_NEG4_MIN6_MFE1':{'longRules':['PEAK2_FLOOR_MINUS5','INITIAL_H1X2_NEG4_MIN6_MFE1'],'longScope':'NORMAL'},
}
INITIAL={
 'INITIAL_AT8_NEG5_MFE1':'AT8_NEG5_MFE1',
 'INITIAL_ARM35_WATCH2_MFE1':'ARM3.5_WATCH2_MFE1',
 'INITIAL_SUSTAINNEG3_120_MFE1':'NEG3_SUSTAIN120_MFE1',
 'INITIAL_TOUCH5_AFTER2_MFE1':'TOUCH5_AFTER2_MFE1',
 'INITIAL_AT12_NEG4_MFE1':'AT12_NEG4_MFE1',
 'INITIAL_H1X2_NEG4_MIN6_MFE1':'H1X2_NEG4_MIN6_MFE1',
}
assert set(INITIAL.values())<=set(screen.POLICIES)
for k,src in INITIAL.items():
 profit.CASES[k]={'mode':'INITIAL_RISK','policy':screen.POLICIES[src]}
def find_early(path,settings,t0):
 if settings['mode']=='INITIAL_RISK':
  return screen.find_stop(path,settings['policy'],t0)
 return original(path,settings,t0)
profit.early_exit=find_early
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--output',required=True,type=Path)
 ap.add_argument('--cases',nargs='+',required=True)
 args=ap.parse_args()
 assert set(args.cases)<=set(CASES) and len(args.cases)==len(set(args.cases))
 assert base.REPO not in (args.output.resolve(),*args.output.resolve().parents)
 base.CASES={k:CASES[k] for k in args.cases}
 origin=sys.argv
 try:
  sys.argv=[str(HERE/'research-pengu-long-native-full8-after-short-dual-20261024.py'),'--output',str(args.output),'--cases',*args.cases]
  base.main()
 finally:sys.argv=origin
if __name__=='__main__':main()
