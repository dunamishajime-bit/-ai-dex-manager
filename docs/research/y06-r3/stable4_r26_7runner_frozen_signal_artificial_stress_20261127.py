"""Frozen 7-runner trade-intent stress overlay. NOT independent synthetic signal BT."""
from pathlib import Path
import json,csv,hashlib,datetime,math,numpy as np
R=Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
B=Path(r'C:\tmp\disdex-bt-20251001-20261001\STABLE4_R26_CAPITAL_ALLOCATION_V3_RESEARCH_20261127')
start=datetime.datetime(2025,10,1,tzinfo=datetime.timezone.utc)
def hours(stamp):
 return (datetime.datetime.fromisoformat(stamp.replace('Z','+00:00'))-start).total_seconds()/3600
def load(bps):
 with (B/f'R21_ONE_{bps}BPS_FILLS.csv').open(encoding='utf-8-sig') as f:raw=list(csv.DictReader(f))
 return [{'id':x['trade_id'],'sym':x['symbol'],'sleeve':x['strategy'],'side':1 if x['side']=='LONG' else -1,'entry':hours(x['entry_utc']),'exit':hours(x['exit_utc']),'gross':float(x['gross_x'])} for x in raw]
policies={'BULL':(.004,.025),'BULL_PULLBACK':(.003,.045),'BEAR':(-.004,.04),'RANGE':(0,.03),'SQUEEZE':(.001,.065),'REVERSAL':(.005,.045)}
N=365*24+72
def market(symbols,reg,seed):
 rng=np.random.default_rng(seed)
 d,vol=policies[reg]
 common=rng.standard_normal(N)
 paths={}
 for ix,sym in enumerate(symbols):
  stock=sym in {'AMZNUSDT','METAUSDT','MSFTUSDT','NVDAUSDT','TSLAUSDT'}
  v=vol*(.65 if stock else 1.05+0.035*ix)
  f=.5 if stock else .65
  z=f*common+math.sqrt(1-f*f)*rng.standard_normal(N)
  mu=np.full(N,d/24)
  if reg=='REVERSAL':mu[np.arange(N)>=N//2]=-0.007/24
  if reg in ('BULL_PULLBACK','RANGE','SQUEEZE'):mu+=(.004/24)*np.sin(2*np.pi*np.arange(N)/(24*10))
  ret=mu+v/math.sqrt(24)*z
  if reg=='SQUEEZE':
   n=rng.choice(np.arange(24,N),size=8,replace=False);ret[n]+=rng.choice([-.09,.11],size=8)
  paths[sym]=np.r_[0,np.cumsum(ret)]
 return paths
def simulate(fills,bps,paths):
 events=[]
 for trade in fills:events.extend([(trade['entry'],1,trade),(trade['exit'],0,trade)])
 events.sort(key=lambda x:(x[0],x[1],x[2]['id']))
 cache={}
 def lg(sym,t):
  z=paths[sym]
  i=int(t);f=t-i
  return float(z[min(i,len(z)-1)]*(1-f)+z[min(i+1,len(z)-1)]*f)
 def value(book,t):
  return sum((math.exp(max(-30,min(30,lg(q['sym'],t)-q['logEntry'])))-1)*q['notional']*q['side'] for q in book.values())
 cash=10000.0;book={};trades=0;wins=0;at=0.0;peak=10000.0;maxdd=0.;grossmax=0.;bankrupt=False
 marks=sorted(set([float(i) for i in range(8761)]+[x[0] for x in events]))
 ei=0
 for t in marks:
  while ei<len(events) and events[ei][0]<=t+1e-9:
   et,kind,tr=events[ei];ei+=1
   current=cash+value(book,et)
   if kind==0:
    q=book.pop(tr['id'],None)
    if q:
     pnl=(math.exp(max(-30,min(30,lg(q['sym'],et)-q['logEntry'])))-1)*q['notional']*q['side']
     exit_fee=q['notional']*(bps/2)/10000
     cash+=pnl-exit_fee
     trades+=1;wins+=int(pnl>q['notional']*bps/10000)
   elif current>0.1 and cash>0:
    notional=tr['gross']*current
    cash-=notional*(bps/2)/10000
    book[tr['id']]={**tr,'notional':notional,'logEntry':lg(tr['sym'],et)}
  eq=cash+value(book,t)
  if eq<=0:
   bankrupt=True;maxdd=100.;break
  peak=max(peak,eq);maxdd=max(maxdd,(1-eq/peak)*100)
  grossmax=max(grossmax,sum(q['notional'] for q in book.values())/eq)
 return {'final':max(0,cash+value(book,marks[-1])),'maxDdPct':maxdd,'wins':wins,'closed':trades,'winRatePct':100*wins/trades if trades else 0,'bankrupt':bankrupt,'maxGrossEquityRatio':grossmax}
out={'status':'FROZEN_HISTORICAL_SIGNAL_TIMES_ARTIFICIAL_PRICE_STRESS_ONLY','limitations':['Entry signals, priority, venue execution and exits are frozen from real-price R26; all 7 native trigger functions are NOT regenerated from artificial candles','Simulates hourly correlated synthetic price paths and mark-to-market; no market depth, funding, dynamic stops or order rejections','Not the requested independent full 7-runner artificial-market backtest; results cannot support deployment','No future data used for admissions; however entry schedule itself is from the 2025-2026 observed market'], 'cases':{}}
for bps in (10,30):
 fills=load(bps);symbols=sorted({x['sym'] for x in fills})
 print('FROZEN',bps,len(fills),len(symbols),flush=True)
 for reg in policies:
  for seed in (202611272401,202611272402):
   x=simulate(fills,bps,market(symbols,reg,seed))
   out['cases'][f'{reg}/{seed}/{bps}']=x
   print('CASE',reg,seed,bps,round(x['final'],2),round(x['maxDdPct'],2),round(x['winRatePct'],2),flush=True)
p=R/'STABLE4_R26_7RUNNER_FROZEN_SIGNAL_ARTIFICIAL_STRESS_20261127.json';assert not p.exists();p.write_text(json.dumps(out,indent=2),encoding='utf8')
print('SAVED',hashlib.sha256(p.read_bytes()).hexdigest(),flush=True)
