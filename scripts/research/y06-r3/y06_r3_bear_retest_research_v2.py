from __future__ import annotations
import pathlib,json,hashlib,importlib.util,collections,math,time,statistics
import numpy as np

ROOT=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
PR=ROOT/'Y06_R3_FROZEN_BREAK_RETEST_PROTOCOL_20261126.json'
assert hashlib.sha256(PR.read_bytes()).hexdigest()=='fbb987417e3b61eac147348a8f154aa0caed9f0513ee123336d130c1f678d40e'
BASE=ROOT/'y06_r2_bt_engine_v2.py'
spec=importlib.util.spec_from_file_location('disdex_y06r2_data_and_account',BASE)
bt=importlib.util.module_from_spec(spec);spec.loader.exec_module(bt)
assert bt.HS==bt.T('2025-03-01T00:00:00Z')
H,M=bt.H,bt.M
PERIODS=bt.PERIODS
POLICIES=('DIRECT_CONTROL','RETEST_H1','RETEST_M15')
EXITS=('STOP8_TIME24','STRUCT_2R_TIME24','STOP8_TIME48')
OUTPUT=ROOT/'Y06_R3_BEAR_RETEST_REAL_M5_BT_V2_20261126.json'

def is_bear(h,i):
 t=bt.HS+i*H
 for hours in (24,12,6):
  j=(t//(hours*H)*hours*H-bt.HS)//H
  if j-hours-1<0 or j>=len(h):return False
  a,b=h[j-1,3],h[j-hours-1,3]
  if not (np.isfinite(a*b) and b>0 and a/b<1):return False
 return True

def calc_atr(h,i):
 # At entry index i, only bars [i-14, i) and their preceding closes used.
 if i<15:return None
 bar=h[i-14:i,:4];prior=h[i-15:i-1,3]
 if len(bar)!=14 or len(prior)!=14 or not(np.isfinite(bar).all() and np.isfinite(prior).all()):return None
 tr=np.maximum(bar[:,1]-bar[:,2],np.maximum(abs(bar[:,1]-prior),abs(bar[:,2]-prior)))
 return float(tr.mean())

def prepare_qa(h,m):
 hN=len(h)
 good=np.zeros(hN,dtype=np.bool_)
 if len(m)!=bt.N_M:raise RuntimeError('M5_PRICE_LENGTH')
 active=np.r_[0,np.cumsum((m[:,4]>0)&np.isfinite(m[:,4]))]
 # pre-compute a single H1-vs-M5 mismatch measure per H1 closing block
 mismatch=np.zeros(hN,dtype=np.bool_)
 for i in range(hN):
  k=(bt.HS+i*H-bt.MS)//M
  if k<0 or k+12>len(m):mismatch[i]=True;continue
  b=m[k:k+12,:4]
  if not np.isfinite(b).all() or not np.isfinite(h[i,:4]).all():mismatch[i]=True;continue
  vals=(b[0,0],float(np.max(b[:,1])),float(np.min(b[:,2])),b[-1,3])
  mismatch[i]=any(abs(h[i,j]/v-1)>.001 for j,v in enumerate(vals))
 badprefix=np.r_[0,np.cumsum(mismatch)]
 for i in range(60,hN):
  t=bt.HS+i*H;k=(t-bt.MS)//M
  if k<576 or k>=len(m):continue
  if not np.isfinite(h[i-48:i,:4]).all():continue
  if not np.isfinite(m[k-576:k,:]).all():continue
  if active[k]-active[k-576]<.75*576:continue
  if badprefix[i]-badprefix[i-6]>0:continue
  good[i]=True
 return good,{'n_qualified_hours':int(good.sum()),'n_possible_hours':hN,
              'h1_m5_mismatched_hours':int(mismatch.sum())}

def generate(sym,h,m,btc):
 good,quality=prepare_qa(h,m)
 cand=[];count=collections.Counter();armed=None
 for i in range(220,len(h)):
  t=bt.HS+i*H;period=next((k for k,(beg,end) in PERIODS.items() if beg<=t<end),None)
  if not period:armed=None;continue
  if not good[i] or not np.isfinite(btc[i-48:i,:4]).all():
   armed=None;count[period+'/QA_FAIL']+=1;continue
  if not is_bear(h,i):armed=None;count[period+'/REGIME_NOT_BEAR']+=1;continue
  atr=calc_atr(h,i)
  if atr is None or atr<=0:armed=None;continue
  c=h[i-1];prev=h[i-2];floor=float(np.min(h[i-13:i-1,2]))
  rel6=c[3]/h[i-7,3]-btc[i-1,3]/btc[i-7,3]
  live=rel6<0
  # Every direct break has its own independent candidate. This is the unmodified
  # source hypothesis, not a historically cherry-picked position tape.
  direct=live and c[3]<floor-.1*atr
  if direct:
   cand.append(dict(symbol=sym,policy='DIRECT_CONTROL',period=period,
     entryTs=t,setupTs=t,breakFloor=floor,breakAtr=atr,
     swingHigh=float(max(h[i-6:i,1])),h1ConfirmTs=t))
   count[period+'/DIRECT_CONTROL']+=1
  # One setup at a time, expires after 12h.
  if armed is not None:
   if t-armed['setupTs']>12*H:armed=None
   else:
    if armed['retestTs'] is None and t>armed['setupTs'] and c[1]>=armed['breakFloor']-.25*armed['breakAtr']:
     armed['retestTs']=t;armed['retestHigh']=float(c[1]);count[period+'/RETEST_OBSERVED']+=1
    elif armed['retestTs'] is not None and t>armed['retestTs']:
     armed['retestHigh']=max(armed['retestHigh'],float(c[1]))
     if c[3]<armed['breakFloor']-.1*armed['breakAtr'] and c[3]<prev[3] and c[3]<c[0] and live:
      r=dict(symbol=sym,policy='RETEST_H1',period=period,entryTs=t,
           setupTs=armed['setupTs'],breakFloor=armed['breakFloor'],
           breakAtr=armed['breakAtr'],swingHigh=armed['retestHigh'],h1ConfirmTs=t)
      cand.append(r)
      count[period+'/RETEST_H1']+=1
      # RETEST_M15 search uses ONLY future 5m closes; max two hours after H1 confirmation.
      k=(t-bt.MS)//M
      for q in range(k+3,k+2*12+1,3):
       if q>=len(m) or q-9<0 or not np.isfinite(m[q-9:q,:4]).all():break
       # Last completed m15: [q-3:q]; prior 2 m15: [q-9:q-3]
       prev2=m[q-9:q-3]
       candle=m[q-3:q]
       if candle[-1,3]<candle[0,0] and candle[-1,3]<float(np.min(prev2[:,2])):
        tm=bt.MS+q*M
        hi=(tm-bt.HS)//H
        if hi<len(h) and good[hi] and is_bear(h,hi):
         z=dict(r);z['policy']='RETEST_M15';z['entryTs']=tm
         cand.append(z);count[period+'/RETEST_M15']+=1
        break
      armed=None
  # A second fresh direct break never resets an active retest setup.
  if armed is None and direct:
   armed={'setupTs':t,'breakFloor':floor,'breakAtr':atr,
          'retestTs':None,'retestHigh':float(c[1])}
 return cand,count,quality

def calc_trade(signal,m,mode,extra_slip=.0):
 ent=signal['entryTs'];k=(ent-bt.MS)//M
 hours=48 if mode=='STOP8_TIME48' else 24
 stop_idx=k+hours*12
 if k<0 or stop_idx>=len(m) or not np.isfinite(m[k:stop_idx+1,:4]).all():return None
 ep=float(m[k,0]);risk=.08
 if mode=='STRUCT_2R_TIME24':
  # Breakout-retest local invalidation, capped by protected resident STOP8.
  a=signal['breakAtr'];s=signal['swingHigh']
  risk=float(np.clip(max(1.2*a,s+.25*a-ep)/ep,.015,.08))
 stop=ep*(1+risk);hard=ep*1.08
 target=ep*(1-2*risk)
 e=bt.MS+stop_idx*M;xp=float(m[stop_idx,0]);reason='TIME'+str(hours)
 for j in range(k,stop_idx):
  o,hi,lo,c=m[j,:4]
  if hi>=stop or hi>=hard:
   threshold=min(stop,hard)
   xp=float(max(o,threshold)+extra_slip*ep)
   reason='HARD_STOP8' if risk>=.08-1e-7 else 'STRUCT_STOP'
   e=bt.MS+(j+1)*M
   break
  if mode=='STRUCT_2R_TIME24' and lo<=target:
   xp=float(target);e=bt.MS+(j+1)*M;reason='TARGET_2R';break
 return {**signal,'exitTs':e,'entry':ep,'exitPrice':xp,
         'direction':'SHORT','rawReturn':1-xp/ep,'riskFraction':risk,
         'exitReason':reason,'mode':mode}

def evaluate(trades,prices,name):
 out={}
 for period in PERIODS:
  zz=[x for x in trades if x['period']==period]
  split={'candidate_trades':len(zz)}
  for fee in (10,30):
   trade=bt.metrics(zz,fee)
   wallet=bt.wallet(zz,period,fee,prices)
   split[str(fee)]={'trade':trade,'portfolio':wallet}
  # +0.5% adverse extra stop fill relative to entry, with exact same fills/exit times
  stress=[]
  for x in zz:
   if 'STOP' not in x['exitReason']:stress.append(x);continue
   y=dict(x);y['exitPrice']=x['exitPrice']+.005*x['entry'];y['rawReturn']=1-y['exitPrice']/x['entry']
   stress.append(y)
  split['30_stress_stop_slip05']=bt.wallet(stress,period,30,prices)
  out[period]=split
  p=split['30']['portfolio'];print('RESULT',name,period,
        'N',p['n'],'WINS',p['wins'],'TERM',round(p['terminal_jpy'],1),
        'DD',round(p['max_dd_pct'],2),
        'PF',round(p['profit_factor'],3) if p['profit_factor'] else None,
        'STRESS',round(split['30_stress_stop_slip05']['terminal_jpy'],1),flush=True)
 return out

def main():
 assert not OUTPUT.exists()
 started=time.monotonic()
 symbols=bt.SYMS;prices={};native=[];counts=collections.Counter();qa={}
 btc,_=bt.data('BTC','1h')
 for sym in symbols[1:]:
  h,dqa=bt.data(sym,'1h');m,mqa=bt.data(sym,'5m')
  prices[sym]=m
  cs,cc,q=generate(sym,h,m,btc)
  native.extend(cs);counts.update(cc);qa[sym]={'H1':dqa,'M5':mqa,'screen':q}
  print('LOADED',sym,'SIGNALS',len(cs),'BY_POLICY',dict(collections.Counter(x['policy'] for x in cs)),flush=True)
 summaries={}
 for policy in POLICIES:
  cc=[x for x in native if x['policy']==policy]
  for mode in EXITS:
   key=policy+'/'+mode
   ff=[x for x in (calc_trade(y,prices[y['symbol']],mode) for y in cc) if x is not None]
   # Eliminate trades that cross a period boundary, but do not tune any rule.
   summaries[key]={'raw_candidate_count':len(cc),'modeled_fills':len(ff),
                   'period':evaluate(ff,prices,key)}
 info={
 'status':'RESEARCH_ONLY_NOT_FOR_RELEASE',
 'periods':PERIODS,'protocol_sha256':hashlib.sha256(PR.read_bytes()).hexdigest(),
 'source_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
 'source_caveats':['This is newly designed Python research SHORT runner, not exact deployed V4 engine or unsigned trade permission',
                  'Previously studied PRE/TARGET/FORWARD are not pristine out-of-sample',
                  'Standalone 0.30 gross 2-slot, not true 7-runner Shared Risk, Funding not modeled',
                  'Risk exit assumes intrabar high-first STOP and target price fill if touched; stop gap adverse fill',
                  'Historical ASTER zero-volume / M5-vs-H1 discrepancies rejected at entry; no venue order-book data'],
 'candidate_by_policy':dict(collections.Counter(x['policy'] for x in native)),
 'symbol_quality':qa,
 'decision_counts':dict(counts),
 'strategies':summaries,
 'raw_candidate_intentions':native}
 assert not OUTPUT.exists()
 OUTPUT.write_text(json.dumps(info,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8')
 print('FILE',OUTPUT,'SHA256',hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
       'TOTAL_SEC',round(time.monotonic()-started,1),flush=True)
if __name__=='__main__':main()
