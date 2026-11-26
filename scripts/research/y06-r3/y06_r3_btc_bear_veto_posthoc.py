from __future__ import annotations
import pathlib,hashlib,json,importlib.util,collections,statistics
import numpy as np
ROOT=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
PR=ROOT/'Y06_R3_POSTHOC_BTC_BEAR_VETO_PROTOCOL_20261126.json'
assert hashlib.sha256(PR.read_bytes()).hexdigest()=='fb2840efeace7b1b3f1bb795f9f9a6ca4ab2d7ffe26e2a3c2e1213c68cac9fb0'
SRC=ROOT/'y06_r3_bear_retest_research_v2.py'
sp=importlib.util.spec_from_file_location('y06r3_btc_veto_source',SRC)
r3=importlib.util.module_from_spec(sp);sp.loader.exec_module(r3)
bt=r3.bt
OUT=ROOT/'Y06_R3_POSTHOC_BTC_BEAR_VETO_REAL_BT_20261126.json'
assert not OUT.exists()
H=bt.H
def btc_ret(h,t,hours):
 boundary=t//(hours*H)*(hours*H)
 k=(boundary-bt.HS)//H
 if k-hours-1<0 or k>=len(h):return None
 a=h[k-1,3];b=h[k-hours-1,3]
 if not np.isfinite(a*b) or b<=0:return None
 return float(a/b-1)
def mask(x,h,gate):
 if gate=='BASE':return True
 k12=btc_ret(h,x['entryTs'],12)
 if k12 is None:return False
 if gate=='BTC12_NEG':return k12<0
 if gate=='BTC_D24_AND12_NEG':
  d=btc_ret(h,x['entryTs'],24)
  return k12<0 and d is not None and d<0
 raise RuntimeError('UNKNOWN_GATE')
mkt={};raw=[]
btc,_=bt.data('BTC','1h')
for symbol in bt.SYMS[1:]:
 h,_=bt.data(symbol,'1h');m,_=bt.data(symbol,'5m')
 signals,counts,quality=r3.generate(symbol,h,m,btc)
 mkt[symbol]=m
 raw.extend(signals)
 print('GENERATED',symbol,len(signals),flush=True)
summary={}
for policy in r3.POLICIES:
 sigs=[x for x in raw if x['policy']==policy]
 for gate in ['BASE','BTC12_NEG','BTC_D24_AND12_NEG']:
  aa=[x for x in sigs if mask(x,btc,gate)]
  tt=[y for y in (r3.calc_trade(x,mkt[x['symbol']],'STOP8_TIME24') for x in aa) if y]
  key=policy+'/'+gate
  summary[key]={'raw_signals':len(sigs),'eligible':len(aa),'by_period':{}}
  for period in bt.PERIODS:
   rows=[x for x in tt if x['period']==period]
   result={}
   for fee in (10,30):
    q=bt.wallet(rows,period,fee,mkt)
    result[str(fee)]={k:v for k,v in q.items() if k!='accepted'}
   summary[key]['by_period'][period]=result
   q=result['30']
   print('GATE',key,period,'CAND',len(rows),'N',q['n'],'EQUITY',round(q['terminal_jpy']),
    'DD',round(q['max_dd_pct'],2),'WR',round(q['win_pct'],2) if q['win_pct'] is not None else None,
    'PF',round(q['profit_factor'],3) if q['profit_factor'] else None,flush=True)
OUT.write_text(json.dumps({
 'meta':{'status':'POSTHOC_EXPLORATORY_NOT_ELIGIBLE_FOR_LIVE_APPROVAL',
 'protocol_sha256':hashlib.sha256(PR.read_bytes()).hexdigest(),
 'r3_generator_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),
 'description':'BTC12 and BTC D+12 closed-bar bearish gate applied only at actual candidate entry; 3 candidate families, STOP8/TIME24, original 2-slot full history portfolio',
 'warning':'All periods and prior 24 synthetic prices already reviewed; positive outcomes do not imply out-of-sample evidence',
 'model_limit':'No funding or full 7-runner or signed venue fill; no production change'},
 'summary':summary},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('SAVED',OUT,'SHA256',hashlib.sha256(OUT.read_bytes()).hexdigest())
