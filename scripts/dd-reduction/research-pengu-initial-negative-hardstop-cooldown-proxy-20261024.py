#!/usr/bin/env python3
"""RESEARCH ONLY: test 24h cooldown / 60h route quarantine on early LONG soft STOP.
The historical model keys PENGU cooldown on 'HARD_STOP' in exit reason; this
injects an explicit reason suffix for the EARLY negative LONG exit *only*.
This is a scenario test, NOT a claim that a venue hard stop was hit.
"""
from __future__ import annotations
import inspect,sys,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(n,p):
 sp=importlib.util.spec_from_file_location(n,p)
 x=importlib.util.module_from_spec(sp);sp.loader.exec_module(x);return x
original=load('pengu_initial_hardcooldown_mod',HERE/'research-pengu-initial-negative-native-full8-20261024.py')
wrapper=original.base.native_wrapper
f=wrapper.main
src=inspect.getsource(f)
target='exit_reason="RESEARCH_PENGU_TIMED_NEGATIVE_"+current+"_"+row["side"],'
replacement='exit_reason=("RESEARCH_PENGU_INITIAL_ADVERSE_HARD_STOP_COOLDOWN_PROXY" if (row["side"]=="LONG" and "INITIAL_" in str(candidate.get("reason",""))) else "RESEARCH_PENGU_TIMED_NEGATIVE_"+current+"_"+row["side"]),'
assert src.count(target)==1,('EXPECTED_EXIT_REASON_CONTRACT_CHANGED',src.count(target))
src=src.replace(target,replacement)
local={}
exec(compile(src,str(HERE/'PENGU_INITIAL_RESEARCH_COOLDOWN_PROXY'),"exec"),f.__globals__,local)
wrapper.main=local['main']
def main():
 # The nominal --cases are exactly as specified by initial negative native wrapper;
 # case output is not a venue hard STOP but a pre-registered cooldown policy proxy.
 print('RESEARCH_PROXY_MODE_INITIAL_LONG_24H_COOLDOWN_AND_60H_ROUTE_HOLD',flush=True)
 original.main()
if __name__=='__main__':main()
