import pathlib,hashlib,importlib.util,numpy as np,datetime
P=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
S=P/'y06_r3_bear_retest_research_v2.py'
sp=importlib.util.spec_from_file_location('y06_r3_test_source',S)
r3=importlib.util.module_from_spec(sp);sp.loader.exec_module(r3)
assert hashlib.sha256(r3.PR.read_bytes()).hexdigest()=='fbb987417e3b61eac147348a8f154aa0caed9f0513ee123336d130c1f678d40e'
bt=r3.bt
h,_=bt.data('ETH','1h');btc,_=bt.data('BTC','1h')
m,_=bt.data('ETH','5m')
original,counts,qa=r3.generate('ETH',h,m,btc)
assert original
for x in original:
 assert x['policy'] in r3.POLICIES and x['symbol']=='ETH'
 assert x['entryTs']>=x['setupTs']
 if x['policy'] in ('RETEST_H1','RETEST_M15'):assert x['entryTs']>x['setupTs']
 if x['policy']=='RETEST_M15':assert x['entryTs']>x['h1ConfirmTs']
 assert x['breakAtr']>0 and x['breakFloor']>0 and x['swingHigh']>0
 assert (x['entryTs']-bt.MS)%bt.M==0
 print('CHECKED',x['policy'],end=' ') if False else None
print('PASS',len(original),'ETH RAW SOURCE CANDIDATES','REGIME_CONSISTENCY',qa['n_qualified_hours'])
# mutate all future bars *after* a cut. Do not repair bad source rows.
cut=bt.T('2026-06-01T00:00:00Z')
ih=(cut-bt.HS)//bt.H;im=(cut-bt.MS)//bt.M
h2=h.copy();m2=m.copy()
h2[ih:,:4]*=1.025;m2[im:,:4]*=1.025
z,cc,qa2=r3.generate('ETH',h2,m2,btc)
def canonical(a):
 return [(v['policy'],v['entryTs'],v['setupTs'],round(v['breakFloor'],7),
          round(v['breakAtr'],7),round(v['swingHigh'],7))
         for v in a if v['entryTs']<cut]
assert canonical(z)==canonical(original),(len(canonical(z)),len(canonical(original)))
print('PASS','FUTURE_CANDLE_MUTATION_CANNOT_CHANGE_PRIOR_SIGNALS',len(canonical(z)))
# Stop is always chosen before target in an ambiguous same M5 bar.
t=bt.T('2026-06-02T00:00:00Z')
k=(t-bt.MS)//bt.M
q=np.full((k+48*12+10,5),np.nan)
q[k:k+48*12+10]=[100,100,100,100,1000]
q[k,:]=[100,109,97,100,1000]
x={'entryTs':t,'symbol':'ETH','direction':'SHORT','breakAtr':1.0,'swingHigh':102.0}
for kind in r3.EXITS:
 out=r3.calc_trade(x,q,kind)
 assert out['exitReason'] in ('STRUCT_STOP','HARD_STOP8'),out
 assert out['rawReturn']<0,out
 assert .015<=out['riskFraction']<=.08
 print('PASS','STOP_PRIORITY',kind,out['exitReason'],round(out['rawReturn']*100,2))
print('R3_ALL_TESTS_PASS')
