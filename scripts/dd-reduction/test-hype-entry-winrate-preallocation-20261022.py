#!/usr/bin/env python3
"""HYPE-only feature filter, completed M5 timestamp, no future leakage."""
import importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('hype_gate',HERE/'run-hype-entry-winrate-after-v4-q102adopted3-20261022.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
x=mod;M5=x.M5
p=x.POLICIES['HYPE_BTC3H_LE0P6_REL3H_GE2P0']
class Feed:
 def __init__(self):
  self.data={}
  for sym,part in [('BTCUSDT',.0035),('HYPEUSDT',.031)]:
   b=[]
   for i in range(54):
    v=100*(1+part*i/36)
    b.append((i*M5,v,v+.05,v-.05,v,1.))
   self.data[sym]=(b,[z[0] for z in b])
 def getdata(self,sym):return self.data[sym]
feed=Feed();ts=37*M5
x.ACTIVE['lookups'].clear();x.ACTIVE['missing'].clear()
features=x.pre_entry_features(feed,ts)
assert abs(features['BTC3hPct']-.35)<1e-8,features
assert abs(features['HYPE3hPct']-3.1)<1e-8,features
assert features['REL3hPct']>2
hype={'strategy_id':'HYPE_LONG','entry_ts_ms':ts,'candidate_id':'H1'}
assert x.gate_hype(hype,p,feed) is True
assert x.gate_hype({'strategy_id':'Q102'},p,feed) is True
# Future bars cannot affect already closed 5m decision.
baseline=features.copy()
btc,_=feed.getdata('BTCUSDT');h,_=feed.getdata('HYPEUSDT')
btc[37]=(37*M5,999,999,999,999,1.)
h[37]=(37*M5,.01,.01,.01,.01,1.)
x.ACTIVE['lookups'].clear()
assert x.pre_entry_features(feed,ts)==baseline
# Entry frame at minute0 must exclude current 5m candle, rule has no previous data->fail closed.
x.ACTIVE['lookups'].clear()
assert x.pre_entry_features(feed,36*M5) is None
assert x.gate_hype({'strategy_id':'HYPE_LONG','entry_ts_ms':36*M5,'candidate_id':'H2'},p,feed) is False
# Single BTC gate blocks larger 3h BTC rise
btc[36]=(36*M5,100.99,101,100.98,100.99,1)
x.ACTIVE['lookups'].clear()
assert x.gate_hype(hype,p,feed) is False
# And high BTC phase cannot leak across symbols: no Q102 denial
assert x.gate_hype({'strategy_id':'V12'},p,feed) is True
print('PASS pre-entry only completed M5 BTC/HYPE 3h relative strength; no current candle/future data; fail-closed source; only HYPE veto')
