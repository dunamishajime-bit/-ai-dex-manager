"""Research-only feature decomposition for missed V12 opportunities.
Builds causal H1 entry-state features from completed bars only and evaluates a small
set of economically motivated route families. No LIVE/Production changes.
"""
from pathlib import Path
import json,math,statistics,collections
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/research/results/v12-multiroute-rescue-20261008/cases/BASELINE_Q_RET14/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl'
CUR=ROOT/'docs/research/results/v12-robust-complement-20261008/cases/AGE24_48_CAP025/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl'
DIAG=ROOT/'docs/research/results/v12-entry-phase-20261008/entry-phase-diagnostic.jsonl'
OUT=ROOT/'docs/research/results/v12-missed-route-decomposition-20261008'
MARKET=Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines')
H=3600000
MID=1778457600000

def rows(p):
 return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]

base=[x for x in rows(BASE) if x['strategy_id']=='V12']
cur=[x for x in rows(CUR) if x['strategy_id']=='V12']
diag=rows(DIAG)
D={(x['symbol'],x['side'],int(x['entry_ts_ms'])):x for x in diag}
C={(x['symbol'],x['side'],int(x['entry_ts_ms'])) for x in cur}
miss=[x for x in base if (x['symbol'],x['side'],int(x['entry_ts_ms'])) not in C]
symbols=sorted({x['symbol'] for x in miss}|{'BTCUSDT'})

bars={}
for sym in symbols:
 p=MARKET/f'{sym}.jsonl'
 if not p.exists():continue
 a=rows(p)
 bars[sym]={int(b['event_time_ms']):b for b in a}

def b(sym,t):return bars.get(sym,{}).get(t)
def closes(sym,t,n):
 out=[]
 for i in range(n,0,-1):
  x=b(sym,t-i*H)
  if not x:return None
  out.append(float(x['close']))
 return out
def ret(sym,t,n):
 c1=b(sym,t-H);c0=b(sym,t-H-n*H)
 return None if not c1 or not c0 else float(c1['close'])/float(c0['close'])-1
def median(a):
 return statistics.median(a) if a else None
def ema(vals,n):
 if not vals:return None
 alpha=2/(n+1);e=vals[0]
 for v in vals[1:]:e=alpha*v+(1-alpha)*e
 return e
def atr(sym,t,n=14):
 seq=[]
 prev=None
 for i in range(n+1,0,-1):
  x=b(sym,t-i*H)
  if not x:return None
  if prev is not None:
   h=float(x['high']);l=float(x['low']);pc=float(prev['close'])
   seq.append(max(h-l,abs(h-pc),abs(l-pc)))
  prev=x
 return sum(seq[-n:])/n if len(seq)>=n else None
def efficiency(sym,t,n):
 cs=closes(sym,t,n+1)
 if not cs:return None
 den=sum(abs(cs[i]-cs[i-1]) for i in range(1,len(cs)))
 return abs(cs[-1]-cs[0])/den if den>0 else 0
def feat(t):
 sym=t['symbol'];ts=int(t['entry_ts_ms']);sg=1 if t['side']=='LONG' else -1
 prev=b(sym,ts-H)
 if not prev:return None
 px=float(prev['close']);A=atr(sym,ts,14)
 if not A or A<=0:return None
 out={'symbol':sym,'side':t['side'],'entry_ts_ms':ts,'rank':t.get('rank'),'pnl_jpy':t['total_pnl_jpy'],
      'net10':t['total_pnl_jpy']/t['notional_entry_jpy'] if t.get('notional_entry_jpy') else 0}
 d=D.get((sym,t['side'],ts),{})
 out['age']=d.get('momentum_condition_age_h');out['diag_ret6']=d.get('signed_ret6');out['diag_ema']=d.get('distance_ema12_atr')
 for n in [3,6,12,24,48]:
  sr=ret(sym,ts,n);br=ret('BTCUSDT',ts,n)
  out[f'sret{n}']=None if sr is None else sg*sr
  out[f'btc{n}']=None if br is None else sg*br
  out[f'rel{n}']=None if sr is None or br is None else sg*(sr-br)
 out['atr14_pct']=A/px
 out['er12']=efficiency(sym,ts,12);out['er24']=efficiency(sym,ts,24)
 cs=closes(sym,ts,48)
 out['ema12_dist']=None if not cs else sg*(px-ema(cs[-24:],12))/A
 out['ema24_dist']=None if not cs else sg*(px-ema(cs,24))/A
 vols=[]
 for i in range(25,1,-1):
  x=b(sym,ts-i*H)
  if x:vols.append(float(x['quote_volume']))
 out['vol_ratio']=float(prev['quote_volume'])/median(vols) if vols and median(vols)>0 else None
 prior=[b(sym,ts-i*H) for i in range(25,1,-1)]
 if all(prior):
  hi=max(float(x['high']) for x in prior);lo=min(float(x['low']) for x in prior)
  out['break24_atr']=(px-hi)/A if sg==1 else (lo-px)/A
  out['range_loc24']=(px-lo)/(hi-lo) if hi>lo else .5
  if sg==-1:out['range_loc24']=1-out['range_loc24']
 else:
  out['break24_atr']=None;out['range_loc24']=None
 recent=[b(sym,ts-i*H) for i in range(13,0,-1)]
 if all(recent):
  fav=max(float(x['high']) for x in recent) if sg==1 else min(float(x['low']) for x in recent)
  out['pullback12_atr']=(fav-px)/A if sg==1 else (px-fav)/A
 else:out['pullback12_atr']=None
 # short-vs-long volatility compression using true ranges
 a6=atr(sym,ts,6);a24=atr(sym,ts,24)
 out['compression']=a6/a24 if a6 and a24 else None
 o=float(prev['open']);h=float(prev['high']);l=float(prev['low']);c=float(prev['close'])
 out['body_atr']=sg*(c-o)/A
 out['clv']=((c-l)/(h-l) if h>l else .5)
 if sg==-1:out['clv']=1-out['clv']
 return out

F=[x for t in miss if (x:=feat(t)) is not None]

def ok(x,*ks):return all(x.get(k) is not None for k in ks)
# Predefined route families, intentionally broad and economic rather than symbol-specific.
ROUTES={
 'R1_BTC_ALIGNED_CONT':lambda x:ok(x,'sret12','sret24','btc12','btc24','ema12_dist','er24') and x['sret12']>.005 and x['sret24']>.01 and x['btc12']>-.0025 and x['btc24']>-.005 and .2<x['ema12_dist']<2.0 and x['er24']>=.25,
 'R2_RELATIVE_STRENGTH':lambda x:ok(x,'rel12','rel24','sret6','ema12_dist') and x['rel12']>.005 and x['rel24']>.01 and x['sret6']>0 and .2<x['ema12_dist']<2.0,
 'R3_MATURE_MOMENTUM':lambda x:ok(x,'age','sret6','ema12_dist','er24') and 48<=x['age']<72 and .005<=x['sret6']<.015 and .5<=x['ema12_dist']<1.75 and x['er24']>=.2,
 'R4_PULLBACK_REACCEL':lambda x:ok(x,'sret24','sret3','sret6','pullback12_atr','ema12_dist') and x['sret24']>.015 and x['sret3']>0 and 0<=x['sret6']<.015 and .25<=x['pullback12_atr']<=1.5 and -.25<=x['ema12_dist']<=1.5,
 'R5_BREAKOUT_CONT':lambda x:ok(x,'break24_atr','vol_ratio','sret6','btc12') and x['break24_atr']>=0 and x['vol_ratio']>=1.0 and x['sret6']>.005 and x['btc12']>-.005,
 'R6_COMPRESSION_EXPAND':lambda x:ok(x,'compression','vol_ratio','sret3','range_loc24') and x['compression']<=.8 and x['vol_ratio']>=1.1 and x['sret3']>.003 and x['range_loc24']>=.75,
 'R7_MODERATE_ACCEL':lambda x:ok(x,'sret6','ema12_dist','er12') and .005<=x['sret6']<.015 and .5<=x['ema12_dist']<1.5 and x['er12']>=.25,
 'R8_LATE_TREND':lambda x:ok(x,'age','sret12','sret24','ema12_dist') and 72<=x['age']<97 and x['sret12']>.005 and x['sret24']>.01 and .25<=x['ema12_dist']<1.75,
}
def st(z,cost=10):
 vals=[x['net10']-(cost-10)/10000 for x in z];n=len(vals);pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals)
 return {'n':n,'wr':sum(v>0 for v in vals)/n if n else None,'pf':pos/neg if neg else None,'mean':sum(vals)/n if n else None,'net_sum':sum(vals)}
report={}
for name,fn in ROUTES.items():
 z=[x for x in F if fn(x)];f=[x for x in z if x['entry_ts_ms']<MID];s=[x for x in z if x['entry_ts_ms']>=MID]
 report[name]={'all10':st(z,10),'all20':st(z,20),'all30':st(z,30),'first10':st(f,10),'second10':st(s,10),'first30':st(f,30),'second30':st(s,30),'LONG10':st([x for x in z if x['side']=='LONG'],10),'SHORT10':st([x for x in z if x['side']=='SHORT'],10)}
# overlap and union
sets={n:{(x['symbol'],x['side'],x['entry_ts_ms']) for x in F if fn(x)} for n,fn in ROUTES.items()}
union=set().union(*sets.values());uz=[x for x in F if (x['symbol'],x['side'],x['entry_ts_ms']) in union]
report['UNION']={'all10':st(uz,10),'all20':st(uz,20),'all30':st(uz,30),'first10':st([x for x in uz if x['entry_ts_ms']<MID],10),'second10':st([x for x in uz if x['entry_ts_ms']>=MID],10),'unique_n':len(union),'route_raw_counts':{n:len(v) for n,v in sets.items()}}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'feature-table.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in F),encoding='utf-8')
(OUT/'initial-route-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
