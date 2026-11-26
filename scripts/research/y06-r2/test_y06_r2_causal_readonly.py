from __future__ import annotations
import pathlib,importlib.util,hashlib,numpy as np
R=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
src=R/'y06_r2_bt_engine_v2.py'
sp=importlib.util.spec_from_file_location('y06_r2_causal_under_test',src)
bt=importlib.util.module_from_spec(sp);sp.loader.exec_module(bt)
assert hashlib.sha256(bt.PR.read_bytes()).hexdigest()=='e10cc8b66b2b934c0d20fc4572e0362f7f56ed9b02b78bef87f5c27f2f547309'
h,qa=bt.data('ETH','1h');m,qm=bt.data('ETH','5m');btc,_=bt.data('BTC','1h')
base_a,_=bt.generate(h,m,btc,'A','ETH',{})
base_b,_=bt.generate(h,m,btc,'B','ETH',{})
assert base_a and base_b
for cand in base_a+base_b:
 assert cand['direction'] in ('LONG','SHORT')
 assert cand['entryTs']>cand['setupTs']
 assert cand['entryTs']-cand['setupTs']<=8*bt.H
 assert .015-1e-10<=cand['riskFraction']<=.08+1e-10
 assert cand['entry']>0 and cand['atr14h']>0
 assert cand['period'] in bt.PERIODS
 assert (cand['entryTs']-bt.MS)%(3*bt.M)==0
assert len({(c['strategy'],c['setupTs'],c['entryTs']) for c in base_a+base_b})==len(base_a+base_b)
print('PASS: native independent LONG/SHORT decision timestamps, risk bounds, one setup-one trade',
      'A',len(base_a),'B',len(base_b))
# Future candles cannot alter signals before a fixed cutoff.
cut=bt.T('2026-11-12T00:00:00Z')
cut_h=(cut-bt.HS)//bt.H;cut_m=(cut-bt.MS)//bt.M
h2=h.copy();m2=m.copy()
h2[cut_h:,:4]*=1.05
m2[cut_m:,:4]*=1.05
for mode,expected in [('A',base_a),('B',base_b)]:
 got,_=bt.generate(h2,m2,btc,mode,'ETH',{})
 canon=lambda rows:[(x['strategy'],x['direction'],x['entryTs'],round(x['entry'],8),
                      round(x['riskFraction'],8)) for x in rows if x['entryTs']<cut]
 assert canon(got)==canon(expected),('FUTURE_LOOKAHEAD',mode)
 print('PASS: future bar mutation preserves all past signals',mode,len(canon(got)))
# Explicit same-M5 high-target + low-stop ambiguity must settle STOP, not TARGET.
t=bt.T('2025-04-01T00:00:00Z')
index=(t-bt.MS)//bt.M
samples=np.full((index+24*12+10,5),np.nan)
samples[index:index+24*12+10,:]=[100,100,100,100,1000]
samples[index,:]=[100,106,97,100,1000]
for direction in ('LONG','SHORT'):
 cand={'entryTs':t,'entry':100.0,'riskFraction':.02,'direction':direction}
 loss=bt.exit_trade(cand,samples,24)
 assert loss['exitReason']=='STRUCTURAL_STOP' and loss['rawReturn']<0,loss
 print('PASS: intrabar ambiguous stop has priority',direction,loss['rawReturn'])
# Source-invalid BTC H1 quarantined, not silently repaired or copied.
_,q=bt.data('BTC','1h')
assert q['quarantined_invalid_bars']>=1
assert q['coverage']<q['expected']
print('PASS: invalid archived OHLC quarantined',q['invalid_examples'][:1])
print('ALL_Y06_R2_CAUSAL_SOURCE_TESTS_PASS')
