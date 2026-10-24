#!/usr/bin/env python3
"""Minimal deterministic guards; no external service or broker."""
import importlib.util
from pathlib import Path
H=Path(__file__).resolve().parent
def imp(n,p):
 spec=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
e=imp('render_multi_test',H/'render-multiregime-ensemble-screen-20261024.py')
x=imp('render_exit_test',H/'render-multiregime-exit-ablation-20261024.py')
def bar(t,op,hi,lo,cl):return (t,op,hi,lo,cl,1)
bars=[bar(i*300000,100,100,100,100) for i in range(80)]
bars[1]=bar(300000,100,103,97,100)
r=x.replay(bars,0,(1.5,2.0,2,True,True),300000)
assert r['reason']=='STOP',r
assert abs(r['netPct']-(-2.3))<1e-9,r
bars=[bar(i*300000,100,100,100,100) for i in range(80)]
bars[1]=bar(300000,100,100,98.4,99)
bars[2]=bar(600000,99.4,99.4,99,99.2)
r=x.replay(bars,0,(3.0,2.5,2,True,False),300000)
assert r['reason']=='STOP' and abs(r['netPct']-0.30)<1e-9,r
f={'ret24':-5,'btc24':-2,'hourRange':2.2,'last15':-.2,'hourWick':.5,'rangePos1':.5,'last30':-.1,'ret3':1,'priorRebound':1,'rel6':1.3,'ret1':-.4,'btc1':.5}
reg=e.regime(f)
assert reg==('BTC_BEAR','RENDER_DUMP','VOL_HIGH'),reg
tags=e.triggers(f,dict(f))
assert tags['two_stage'] and tags['bear_break'] and tags['relative_top'],tags
print('PASS: stop-first, staged next-bar, regime and multi-stage causal conditions')
