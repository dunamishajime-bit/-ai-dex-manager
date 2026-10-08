"""Research-only second-stage recovery route search.
Keep only the five recovery routes that remained profitable after independent-sleeve replay.
Search remaining missed trades for additional ENTRY+EXIT route pairs whose INCREMENTAL
(uncovered) subset is itself profitable. No LIVE/Production changes.
"""
from pathlib import Path
import json,itertools,statistics
ROOT=Path(__file__).resolve().parents[2]
FP=ROOT/'docs/research/results/v12-missed-route-decomposition-20261008/feature-table.jsonl'
BASE=ROOT/'docs/research/results/v12-multiroute-rescue-20261008/cases/BASELINE_Q_RET14/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl'
OUT=ROOT/'docs/research/results/v12-recovery-stage2-search-20261008'
MARKET=Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines')
H=3600000;MID=1778457600000
def rows(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
A=rows(FP);base=[x for x in rows(BASE) if x['strategy_id']=='V12'];B={(x['symbol'],x['side'],int(x['entry_ts_ms'])):x for x in base}

P={
 'SIDE_SHORT':lambda x:x['side']=='SHORT','SIDE_LONG':lambda x:x['side']=='LONG',
 'AGE_0_24':lambda x:isinstance(x.get('age'),(int,float)) and 0<=x['age']<24,
 'AGE_24_48':lambda x:isinstance(x.get('age'),(int,float)) and 24<=x['age']<48,
 'AGE_48_72':lambda x:isinstance(x.get('age'),(int,float)) and 48<=x['age']<72,
 'AGE_72_97':lambda x:isinstance(x.get('age'),(int,float)) and 72<=x['age']<97,
 'RET6_NEG':lambda x:isinstance(x.get('sret6'),(int,float)) and x['sret6']<0,
 'RET6_0_05':lambda x:isinstance(x.get('sret6'),(int,float)) and 0<=x['sret6']<.005,
 'RET6_05_15':lambda x:isinstance(x.get('sret6'),(int,float)) and .005<=x['sret6']<.015,
 'RET6_15_30':lambda x:isinstance(x.get('sret6'),(int,float)) and .015<=x['sret6']<.03,
 'RET6_GE30':lambda x:isinstance(x.get('sret6'),(int,float)) and x['sret6']>=.03,
 'EMA_NEG_05':lambda x:isinstance(x.get('ema12_dist'),(int,float)) and -.5<=x['ema12_dist']<0,
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
 'RANGE_NOT_TOP25':lambda x:isinstance(x.get('range_loc24'),(int,float)) and x['range_loc24']<.75,
 'PULLBACK_025_15':lambda x:isinstance(x.get('pullback12_atr'),(int,float)) and .25<=x['pullback12_atr']<=1.5,
}
GOOD=[
 ('REC_S1_MID_REL_LOWVOL',['SIDE_SHORT','RET6_05_15','REL12_POS','VOL_LT1']),
 ('REC_S2_EARLY_BTC_OPPOSE_VOL',['SIDE_SHORT','AGE_0_24','BTC6_OPPOSE','VOL_GE1']),
 ('REC_S3_LATE_BTC_REL',['SIDE_SHORT','AGE_72_97','BTC6_ALIGNED','REL12_POS']),
 ('REC_S4_MATURE_REL_RANGE',['SIDE_SHORT','AGE_48_72','REL24_POS','RANGE_NOT_TOP25']),
 ('REC_S5_SLOW_TREND',['SIDE_SHORT','RET6_0_05','BTC6_ALIGNED','ER24_LT30']),
]
used=set()
for name,conds in GOOD:
 for i,x in enumerate(A):
  if i not in used and all(P[c](x) for c in conds):used.add(i)
REM=set(range(len(A)))-used
print('GOOD5_UNION',len(used),'REMAIN',len(REM),flush=True)

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
   hi=float(x['high']);lo=float(x['low']);pc=float(prev['close']);seq.append(max(hi-lo,abs(hi-pc),abs(lo-pc)))
  prev=x
 return sum(seq[-n:])/n if len(seq)>=n else None
def time_ret(x,h):
 t=B[(x['symbol'],x['side'],x['entry_ts_ms'])];bar=bars.get(x['symbol'],{}).get(x['entry_ts_ms']+h*H)
 if not bar:return None
 sg=1 if x['side']=='LONG' else -1
 return sg*(float(bar['open'])/float(t['entry_price'])-1)
def tpsl_ret(x,tp,sl,hold):
 t=B[(x['symbol'],x['side'],x['entry_ts_ms'])];e=float(t['entry_price']);sg=1 if x['side']=='LONG' else -1;aa=atr(x['symbol'],x['entry_ts_ms'],14)
 if not aa:return None
 tp_px=e+sg*tp*aa;sl_px=e-sg*sl*aa
 for h in range(hold):
  bar=bars.get(x['symbol'],{}).get(x['entry_ts_ms']+h*H)
  if not bar:return None
  hi=float(bar['high']);lo=float(bar['low']);op=float(bar['open'])
  hit_sl=(lo<=sl_px if sg==1 else hi>=sl_px);hit_tp=(hi>=tp_px if sg==1 else lo<=tp_px)
  if hit_sl:
   px=min(sl_px,op) if sg==1 else max(sl_px,op);return sg*(px/e-1)
  if hit_tp:return sg*(tp_px/e-1)
 return time_ret(x,hold)
TEMPLATES={f'TIME_{h}H':('time',h) for h in [6,12,24,36,48]}
for tp,sl,hold in [(.75,.75,12),(1,1,24),(1.5,1,24),(1.5,1,36),(2,1,36),(2,1.25,48),(3,1.5,48)]:
 TEMPLATES[f'TP{tp}_SL{sl}_H{hold}']=('tpsl',tp,sl,hold)
for i in REM:
 x=A[i]
 for name,spec in TEMPLATES.items():
  x[name]=time_ret(x,spec[1]) if spec[0]=='time' else tpsl_ret(x,*spec[1:])

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
 else:families[k]=k
def st(ids,field,cost):
 vals=[A[i].get(field) for i in ids if A[i].get(field) is not None]
 vals=[v-cost/10000 for v in vals];n=len(vals);pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals)
 return (n,pos/neg if neg else 999,sum(vals)/n if n else 0)
keys=[k for k in P if not k.startswith('SIDE')]
cand=[];seen=set()
for side in ['SIDE_SHORT','SIDE_LONG']:
 for m in [1,2,3]:
  for combo in itertools.combinations(keys,m):
   names=(side,)+combo
   if len({families[k] for k in names})<len(names):continue
   ids=frozenset(i for i in REM if all(P[k](A[i]) for k in names))
   if len(ids)<18:continue
   for field in TEMPLATES:
    key=(ids,field)
    if key in seen:continue
    seen.add(key)
    a20=st(ids,field,20);f={i for i in ids if A[i]['entry_ts_ms']<MID};ss=set(ids)-f;F=st(f,field,10);S=st(ss,field,10)
    if a20[0]>=18 and F[0]>=10 and S[0]>=5 and a20[1]>1.03 and F[1]>1.03 and S[1]>1.03:
     cand.append({'rule':names,'exit':field,'ids':ids,'n':a20[0],'pf20':a20[1],'mean20':a20[2],'f_pf10':F[1],'s_pf10':S[1]})
print('CAND',len(cand),flush=True)

# Greedy incremental selection: each newly added residual must itself be robust.
extra=set();selected=[]
for step in range(15):
 best=None
 for j,r in enumerate(cand):
  if j in [q['idx'] for q in selected]:continue
  inc=set(r['ids'])-extra
  if len(inc)<15:continue
  a10=st(inc,r['exit'],10);a20=st(inc,r['exit'],20)
  f={i for i in inc if A[i]['entry_ts_ms']<MID};ss=inc-f;F=st(f,r['exit'],10);S=st(ss,r['exit'],10)
  if a10[1]<=1.05 or a20[1]<=1.02:continue
  if len(f)>=8 and F[1]<=1.03:continue
  if len(ss)>=5 and S[1]<=1.03:continue
  # favor lots of positive incremental expected return, not raw count only
  score=len(inc)*(max(a20[1]-1,0)+.15)+150*max(a20[2],0)
  if best is None or score>best[0]:
   best=(score,j,r,inc,a10,a20,F,S)
 if best is None:break
 _,j,r,inc,a10,a20,F,S=best
 selected.append({'idx':j,'rule':r['rule'],'exit':r['exit'],'inc_ids':sorted(inc),'inc_n':len(inc),'inc_pf10':a10[1],'inc_pf20':a20[1],'inc_mean20':a20[2],'f_n':F[0],'f_pf10':F[1],'s_n':S[0],'s_pf10':S[1]})
 extra|=inc
 print('ADD',step+1,r['rule'],r['exit'],'inc',len(inc),'PF10',round(a10[1],3),'PF20',round(a20[1],3),'F',round(F[1],3),'S',round(S[1],3),'EXTRA_UNION',len(extra),flush=True)

# Store candidate keys and selected route definitions.
for q in selected:
 q['inc_keys']=[(A[i]['symbol'],A[i]['side'],A[i]['entry_ts_ms']) for i in q.pop('inc_ids')]
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'selected-stage2-routes.json').write_text(json.dumps(selected,indent=2),encoding='utf-8')
print('FINAL_EXTRA',len(extra),'TOTAL_WITH_GOOD5_AND_CORE77_CANDIDATE',77+len(used)+len(extra),flush=True)
