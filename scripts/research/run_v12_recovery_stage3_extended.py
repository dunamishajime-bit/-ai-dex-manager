"""Research-only V12 stage-3 recovery search toward ~1,000 trades.

Searches only the 482 baseline V12 opportunities not covered by the current 707-candidate
multi-logic architecture. Unlike earlier stages, permits either:
- original-side recovery, or
- opposite-side reversal at the same causal entry timestamp,
with dedicated exits.

Selection guard:
- incremental uncovered subset only,
- 20bps PF > 1.03,
- both temporal halves 10bps PF > 1.03 when sample is large enough,
- no symbol-specific predicates,
- no LIVE/Production changes.
"""
from pathlib import Path
import json,itertools,re
ROOT=Path(__file__).resolve().parents[2]
FP=ROOT/'docs/research/results/v12-missed-route-decomposition-20261008/feature-table.jsonl'
BASE=ROOT/'docs/research/results/v12-multiroute-rescue-20261008/cases/BASELINE_Q_RET14/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl'
CORE=ROOT/'docs/research/results/v12-robust-complement-20261008/cases/AGE24_48_CAP025/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl'
STAGE2=ROOT/'docs/research/results/v12-recovery-stage2-search-20261008/selected-stage2-routes.json'
OUT=ROOT/'docs/research/results/v12-recovery-stage3-extended-20261009'
MARKET=Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines')
H=3600000
MID=1778457600000

def rows(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
A=rows(FP)
BASE_ROWS=[x for x in rows(BASE) if x['strategy_id']=='V12']
CORE_ROWS=[x for x in rows(CORE) if x['strategy_id']=='V12']
K=lambda x:(x['symbol'],x['side'],int(x['entry_ts_ms']))
B={K(x):x for x in BASE_ROWS}

# Rebuild stage-1 GOOD5 membership exactly as V2.
P={
 'SIDE_SHORT':lambda x:x['side']=='SHORT','SIDE_LONG':lambda x:x['side']=='LONG',
 'AGE_0_12':lambda x:isinstance(x.get('age'),(int,float)) and 0<=x['age']<12,
 'AGE_12_24':lambda x:isinstance(x.get('age'),(int,float)) and 12<=x['age']<24,
 'AGE_24_48':lambda x:isinstance(x.get('age'),(int,float)) and 24<=x['age']<48,
 'AGE_48_72':lambda x:isinstance(x.get('age'),(int,float)) and 48<=x['age']<72,
 'AGE_72_97':lambda x:isinstance(x.get('age'),(int,float)) and 72<=x['age']<97,
 'RET6_NEG':lambda x:isinstance(x.get('sret6'),(int,float)) and x['sret6']<0,
 'RET6_0_05':lambda x:isinstance(x.get('sret6'),(int,float)) and 0<=x['sret6']<.005,
 'RET6_05_15':lambda x:isinstance(x.get('sret6'),(int,float)) and .005<=x['sret6']<.015,
 'RET6_15_30':lambda x:isinstance(x.get('sret6'),(int,float)) and .015<=x['sret6']<.03,
 'RET6_GE30':lambda x:isinstance(x.get('sret6'),(int,float)) and x['sret6']>=.03,
 'EMA_LT0':lambda x:isinstance(x.get('ema12_dist'),(int,float)) and x['ema12_dist']<0,
 'EMA_0_05':lambda x:isinstance(x.get('ema12_dist'),(int,float)) and 0<=x['ema12_dist']<.5,
 'EMA_05_10':lambda x:isinstance(x.get('ema12_dist'),(int,float)) and .5<=x['ema12_dist']<1,
 'EMA_10_20':lambda x:isinstance(x.get('ema12_dist'),(int,float)) and 1<=x['ema12_dist']<2,
 'EMA_GE20':lambda x:isinstance(x.get('ema12_dist'),(int,float)) and x['ema12_dist']>=2,
 'BTC6_ALIGNED':lambda x:isinstance(x.get('btc6'),(int,float)) and x['btc6']>=0,
 'BTC6_OPPOSE':lambda x:isinstance(x.get('btc6'),(int,float)) and x['btc6']<0,
 'BTC24_ALIGNED':lambda x:isinstance(x.get('btc24'),(int,float)) and x['btc24']>=0,
 'BTC24_OPPOSE':lambda x:isinstance(x.get('btc24'),(int,float)) and x['btc24']<0,
 'REL12_POS':lambda x:isinstance(x.get('rel12'),(int,float)) and x['rel12']>0,
 'REL12_NEG':lambda x:isinstance(x.get('rel12'),(int,float)) and x['rel12']<=0,
 'REL24_POS':lambda x:isinstance(x.get('rel24'),(int,float)) and x['rel24']>0,
 'REL24_NEG':lambda x:isinstance(x.get('rel24'),(int,float)) and x['rel24']<=0,
 'BREAK24':lambda x:isinstance(x.get('break24_atr'),(int,float)) and x['break24_atr']>=0,
 'NO_BREAK24':lambda x:isinstance(x.get('break24_atr'),(int,float)) and x['break24_atr']<0,
 'VOL_GE1':lambda x:isinstance(x.get('vol_ratio'),(int,float)) and x['vol_ratio']>=1,
 'VOL_LT1':lambda x:isinstance(x.get('vol_ratio'),(int,float)) and x['vol_ratio']<1,
 'ER24_GE30':lambda x:isinstance(x.get('er24'),(int,float)) and x['er24']>=.3,
 'ER24_LT30':lambda x:isinstance(x.get('er24'),(int,float)) and x['er24']<.3,
 'RANGE_TOP25':lambda x:isinstance(x.get('range_loc24'),(int,float)) and x['range_loc24']>=.75,
 'RANGE_MID':lambda x:isinstance(x.get('range_loc24'),(int,float)) and .25<=x['range_loc24']<.75,
 'RANGE_BOTTOM25':lambda x:isinstance(x.get('range_loc24'),(int,float)) and x['range_loc24']<.25,
 'RANGE_NOT_TOP25':lambda x:isinstance(x.get('range_loc24'),(int,float)) and x['range_loc24']<.75,
 'PULLBACK_LT025':lambda x:isinstance(x.get('pullback12_atr'),(int,float)) and x['pullback12_atr']<.25,
 'PULLBACK_025_15':lambda x:isinstance(x.get('pullback12_atr'),(int,float)) and .25<=x['pullback12_atr']<=1.5,
 'PULLBACK_GT15':lambda x:isinstance(x.get('pullback12_atr'),(int,float)) and x['pullback12_atr']>1.5,
 'COMPRESS':lambda x:isinstance(x.get('compression'),(int,float)) and x['compression']<=.8,
 'EXPAND':lambda x:isinstance(x.get('compression'),(int,float)) and x['compression']>=1.1,
 'BODY_FAVOR':lambda x:isinstance(x.get('body_atr'),(int,float)) and x['body_atr']>0,
 'BODY_OPPOSE':lambda x:isinstance(x.get('body_atr'),(int,float)) and x['body_atr']<=0,
 'CLV_FAVOR':lambda x:isinstance(x.get('clv'),(int,float)) and x['clv']>=.6,
 'CLV_OPPOSE':lambda x:isinstance(x.get('clv'),(int,float)) and x['clv']<=.4,
}
GOOD=[
 ['SIDE_SHORT','RET6_05_15','REL12_POS','VOL_LT1'],
 ['SIDE_SHORT','AGE_0_12','BTC6_OPPOSE','VOL_GE1'], # subset-compatible with old 0-24; coverage rebuilt below with old exact predicate separately
]
# exact old GOOD5 reconstruction
OLD_GOOD=[
 ('G1',lambda x:P['SIDE_SHORT'](x) and P['RET6_05_15'](x) and P['REL12_POS'](x) and P['VOL_LT1'](x)),
 ('G2',lambda x:P['SIDE_SHORT'](x) and isinstance(x.get('age'),(int,float)) and 0<=x['age']<24 and P['BTC6_OPPOSE'](x) and P['VOL_GE1'](x)),
 ('G3',lambda x:P['SIDE_SHORT'](x) and isinstance(x.get('age'),(int,float)) and 72<=x['age']<97 and P['BTC6_ALIGNED'](x) and P['REL12_POS'](x)),
 ('G4',lambda x:P['SIDE_SHORT'](x) and isinstance(x.get('age'),(int,float)) and 48<=x['age']<72 and P['REL24_POS'](x) and P['RANGE_NOT_TOP25'](x)),
 ('G5',lambda x:P['SIDE_SHORT'](x) and P['RET6_0_05'](x) and P['BTC6_ALIGNED'](x) and P['ER24_LT30'](x)),
]
goodK=set()
for _,fn in OLD_GOOD:
 for x in A:
  k=K(x)
  if k not in goodK and fn(x):goodK.add(k)
stage2=json.load(open(STAGE2,encoding='utf-8'))[:14]
stage2K={tuple(k) for r in stage2 for k in r['inc_keys']}
covered={K(x) for x in CORE_ROWS}|goodK|stage2K
REM=[i for i,x in enumerate(A) if K(x) not in covered]
print('COVERED',len(covered),'REMAIN_FEATURE_ROWS',len(REM),flush=True)

symbols=sorted({A[i]['symbol'] for i in REM})
bars={}
for sym in symbols:
 p=MARKET/f'{sym}.jsonl'
 if p.exists():bars[sym]={int(x['event_time_ms']):x for x in rows(p)}

def atr(sym,t,n=14):
 seq=[];prev=None
 for i in range(n+1,0,-1):
  x=bars.get(sym,{}).get(t-i*H)
  if not x:return None
  if prev is not None:
   hi=float(x['high']);lo=float(x['low']);pc=float(prev['close'])
   seq.append(max(hi-lo,abs(hi-pc),abs(lo-pc)))
  prev=x
 return sum(seq[-n:])/n if len(seq)>=n else None

def entry_px(x,delay):
 t=B[K(x)]; bar=bars.get(x['symbol'],{}).get(x['entry_ts_ms']+delay*H)
 return (float(t['entry_price']) if delay==0 else (float(bar['open']) if bar else None))

def time_ret(x,side_mult,delay,h):
 e=entry_px(x,delay)
 if e is None:return None
 t=x['entry_ts_ms']+(delay+h)*H
 bar=bars.get(x['symbol'],{}).get(t)
 if not bar:return None
 orig=1 if x['side']=='LONG' else -1
 sg=orig*side_mult
 return sg*(float(bar['open'])/e-1)

def tpsl_ret(x,side_mult,delay,tp,sl,hold):
 e=entry_px(x,delay)
 if e is None:return None
 aa=atr(x['symbol'],x['entry_ts_ms']+delay*H,14)
 if not aa:return None
 orig=1 if x['side']=='LONG' else -1;sg=orig*side_mult
 tp_px=e+sg*tp*aa;sl_px=e-sg*sl*aa
 for h in range(hold):
  t=x['entry_ts_ms']+(delay+h)*H
  bar=bars.get(x['symbol'],{}).get(t)
  if not bar:return None
  hi=float(bar['high']);lo=float(bar['low']);op=float(bar['open'])
  hit_sl=(lo<=sl_px if sg==1 else hi>=sl_px)
  hit_tp=(hi>=tp_px if sg==1 else lo<=tp_px)
  if hit_sl:
   px=min(sl_px,op) if sg==1 else max(sl_px,op)
   return sg*(px/e-1)
  if hit_tp:return sg*(tp_px/e-1)
 return time_ret(x,side_mult,delay,hold)

# Templates: original/reverse, immediate and small causal delays.
TEMPLATES={}
for mult,label in [(1,'ORIG'),(-1,'REV')]:
 for delay in [0,1,2]:
  for h in [3,6,9,12,18,24,36,48,72]:
   if delay+h<=72:TEMPLATES[f'{label}_D{delay}_T{h}']=('time',mult,delay,h)
  for tp,sl,hold in [(.5,.5,6),(.75,.5,12),(1,.75,12),(1,1,24),(1.5,1,24),(2,1,36),(2,1.25,48)]:
   TEMPLATES[f'{label}_D{delay}_TP{tp}_SL{sl}_H{hold}']=('tpsl',mult,delay,tp,sl,hold)

for i in REM:
 x=A[i]
 for name,spec in TEMPLATES.items():
  x[name]=time_ret(x,*spec[1:]) if spec[0]=='time' else tpsl_ret(x,*spec[1:])

# predicate families
families={}
for k in P:
 if k.startswith('SIDE'):families[k]='SIDE'
 elif k.startswith('AGE'):families[k]='AGE'
 elif k.startswith('RET6'):families[k]='RET6'
 elif k.startswith('EMA'):families[k]='EMA'
 elif k.startswith('BTC6'):families[k]='BTC6'
 elif k.startswith('BTC24'):families[k]='BTC24'
 elif k.startswith('REL12'):families[k]='REL12'
 elif k.startswith('REL24'):families[k]='REL24'
 elif k.startswith('BREAK') or k.startswith('NO_BREAK'):families[k]='BREAK'
 elif k.startswith('VOL'):families[k]='VOL'
 elif k.startswith('ER24'):families[k]='ER24'
 elif k.startswith('RANGE'):families[k]='RANGE'
 elif k.startswith('PULLBACK'):families[k]='PULLBACK'
 elif k in ('COMPRESS','EXPAND'):families[k]='VOLSTATE'
 elif k.startswith('BODY'):families[k]='BODY'
 elif k.startswith('CLV'):families[k]='CLV'
 else:families[k]=k

def st(ids,field,cost):
 vals=[A[i].get(field) for i in ids if A[i].get(field) is not None]
 vals=[v-cost/10000 for v in vals];n=len(vals);pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals)
 return (n,pos/neg if neg else 999,sum(vals)/n if n else 0,sum(vals))

keys=[k for k in P if not k.startswith('SIDE')]
cand=[];seen=set()
for side in ['SIDE_SHORT','SIDE_LONG']:
 for m in [1,2,3]:
  for combo in itertools.combinations(keys,m):
   names=(side,)+combo
   if len({families[k] for k in names})<len(names):continue
   ids=frozenset(i for i in REM if all(P[k](A[i]) for k in names))
   if len(ids)<15:continue
   f={i for i in ids if A[i]['entry_ts_ms']<MID};ss=set(ids)-f
   if len(f)<8 or len(ss)<4:continue
   for field in TEMPLATES:
    signature=(ids,field)
    if signature in seen:continue
    seen.add(signature)
    a20=st(ids,field,20);F=st(f,field,10);S=st(ss,field,10)
    if a20[0]>=15 and a20[1]>1.03 and F[1]>1.03 and S[1]>1.03:
     cand.append({'rule':names,'exit':field,'ids':ids,'n':a20[0],'pf20':a20[1],'mean20':a20[2],'f_pf10':F[1],'s_pf10':S[1]})
print('CANDIDATES',len(cand),flush=True)

# Greedy incremental. Target enough raw opportunities so integrated acceptance can approach 1,000.
extra=set();selected=[]
for step in range(50):
 best=None
 for j,r in enumerate(cand):
  if j in [q['idx'] for q in selected]:continue
  inc=set(r['ids'])-extra
  if len(inc)<10:continue
  f={i for i in inc if A[i]['entry_ts_ms']<MID};ss=inc-f
  a10=st(inc,r['exit'],10);a20=st(inc,r['exit'],20);F=st(f,r['exit'],10);S=st(ss,r['exit'],10)
  if a10[1]<=1.04 or a20[1]<=1.02:continue
  if len(f)>=6 and F[1]<=1.02:continue
  if len(ss)>=4 and S[1]<=1.02:continue
  # prefer incremental coverage but reward real edge.
  score=len(inc)*(0.2+max(0,a20[1]-1))+250*max(0,a20[2])
  if best is None or score>best[0]:best=(score,j,r,inc,a10,a20,F,S)
 if best is None:break
 _,j,r,inc,a10,a20,F,S=best
 selected.append({'idx':j,'rule':r['rule'],'exit':r['exit'],'inc_n':len(inc),'inc_pf10':a10[1],'inc_pf20':a20[1],'inc_mean20':a20[2],'f_n':F[0],'f_pf10':F[1],'s_n':S[0],'s_pf10':S[1],'inc_keys':[K(A[i]) for i in sorted(inc)]})
 extra|=inc
 print('ADD',step+1,r['rule'],r['exit'],'inc',len(inc),'PF10',round(a10[1],3),'PF20',round(a20[1],3),'F',round(F[1],3),'S',round(S[1],3),'EXTRA',len(extra),'TOTAL_RAW',707+len(extra),flush=True)

OUT.mkdir(parents=True,exist_ok=True)
(OUT/'selected-stage3-extended-routes.json').write_text(json.dumps(selected,indent=2),encoding='utf-8')
print('FINAL_EXTRA',len(extra),'TOTAL_RAW',707+len(extra),'ROUTES',len(selected),flush=True)
