from __future__ import annotations
import pathlib, gzip, json, math, hashlib, datetime, collections, time, sys
import numpy as np

ROOT=pathlib.Path(r'C:\tmp\disdex-bt-20251001-20261001')
WORK=pathlib.Path(r'C:\tmp\disdex-d126-crossrunner-research-20261126')
PR=WORK/'Y06_R2_FROZEN_RESEARCH_PROTOCOL_20261126.json'
assert hashlib.sha256(PR.read_bytes()).hexdigest()=='e10cc8b66b2b934c0d20fc4572e0362f7f56ed9b02b78bef87f5c27f2f547309'
SPEC=json.loads(PR.read_text(encoding='utf8'))
T=lambda s:int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
HS=T('2025-03-01T00:00:00Z')
MS=T('2025-03-22T00:00:00Z')
ME=T('2026-11-26T12:00:00Z')
H=3600000;M=300000
N_H=(ME-HS)//H
N_M=(ME-MS)//M
VOLUME=.75
SYMS=['BTC','ETH','BNB','SOL','LINK','AVAX','DOGE','INJ','XRP','ADA','LTC','ATOM','AAVE','NEAR']
PRE=(T('2025-03-24T00:00:00Z'),T('2025-10-01T00:00:00Z'))
TARGET=(T('2025-10-01T00:00:00Z'),T('2026-10-01T00:00:00Z'))
FORWARD=(T('2026-10-01T00:00:00Z'),T('2026-11-23T00:00:00Z'))
PERIODS={'PRE':PRE,'TARGET':TARGET,'FORWARD_INSPECTED':FORWARD}
FEED=WORK/'Y06_FRESH_ASTERV3_OOS_MARKET_DATA_20261126'
mf=json.loads((FEED/'SOURCE_MANIFEST.json').read_text(encoding='utf8'))
assert mf['start']==T('2026-11-08T20:00:00Z') and mf['end_exclusive']==ME
HFiles=[
 ('aster-public-v3-h1-early','1h-20250301-20250924'),
 ('aster-public-v3-h1','1h-20250924-20261001'),
 ('FORWARD_HOLDOUT_20261001_20261108/aster-h1','1h-20261001-20261108T20')]
MFiles=[
 ('PREPERIOD_TRAIN_20250322_20251001/aster-m5','5m-20250322-20251001'),
 ('aster-public-v3-5m-prefix','5m-20250924-20260803'),
 ('aster-public-v3-5m-suffix','5m-20260803-20261001'),
 ('FORWARD_HOLDOUT_20261001_20261108/aster-m5','5m-20261001-20261108T20')]
def data(sym,interval):
 if interval=='1h':files=HFiles;count=N_H;start=HS;step=H
 else:files=MFiles;count=N_M;start=MS;step=M
 out=np.full((count,5),np.nan,dtype=np.float64)
 src=np.full(count,-1,dtype=np.int8)
 duplicates=0;contradictions=0;invalid=0;invalid_examples=[];reads=[]
 for no,(folder,part) in enumerate(files+[(None,'fresh')]):
  p=(ROOT/folder/(sym+'USDT-'+part+'.jsonl.gz')) if folder else FEED/mf['candle_counts'][sym+'USDT_'+interval]['filename']
  if not p.exists():raise RuntimeError('MISSING_ASSET_SOURCE:'+str(p))
  n=0
  with gzip.open(p,'rt',encoding='utf8') as f:
   for line in f:
    if not line.strip():continue
    row=json.loads(line);t=int(row[0])
    if t<start or t>=ME or (t-start)%step:continue
    i=(t-start)//step
    if i<0 or i>=count:continue
    nums=np.array([float(row[k]) for k in (1,2,3,4,5)])
    if not np.isfinite(nums).all() or min(nums[:4])<=0 or nums[1]<max(nums[0],nums[3]) or nums[2]>min(nums[0],nums[3]) or nums[4]<0:
     invalid+=1
     if len(invalid_examples)<10:invalid_examples.append({'timestamp':t,'interval':interval,'source':str(p),'bar':nums.tolist()})
     out[i]=np.nan
     src[i]=no
     continue
    if src[i]!=-1:
     duplicates+=1
     if abs(nums[3]/out[i,3]-1)>1e-4:contradictions+=1
    out[i]=nums;src[i]=no;n+=1
  reads.append((p.name,n))
 # Only finite bars are usable, so missing data cannot silently forward-fill.
 return out,{'files':reads,'coverage':int(np.isfinite(out[:,3]).sum()),'expected':count,
  'duplicate':duplicates,'contradictions_over_one_bp':contradictions,'quarantined_invalid_bars':invalid,'invalid_examples':invalid_examples,
  'active_volume_count':int(np.sum(out[:,4]>0))}

def calc_regime(h,btc):
 n=len(h);rA=np.zeros(n,dtype=np.int8);rB=np.zeros(n,dtype=np.int8)
 def ret(a,i,period):
  t=HS+i*H
  boundary=t//(period*H)*(period*H)
  k=(boundary-HS)//H
  if k-period-1<0:return None
  v=a[k-1,3];b=a[k-period-1,3]
  if not math.isfinite(v*b) or b<=0:return None
  return v/b-1
 for i in range(220,n):
  r=[ret(h,i,x) for x in (24,12,6,4)]
  br=ret(btc,i,12)
  if br is None or any(x is None for x in r):continue
  for side in (1,-1):
   if side*br<=0:continue
   if all(side*x>0 for x in r[:3]):rA[i]=side
   if side*r[0]>0 and side*r[1]>0 and (side*r[2]>0 or side*r[3]>0):rB[i]=side
 return rA,rB

def ema12_at(h):
 n=len(h);ema=np.full(n,np.nan);atr=np.full(n,np.nan)
 val=None
 for i in range(n):
  price=h[i,3]
  if not np.isfinite(price):val=None;continue
  val=price if val is None else val+(2/13)*(price-val)
  ema[i]=val
  if i>=15:
   candles=h[i-13:i+1,:4]
   prior=h[i-14:i,3]
   if np.isfinite(candles).all() and np.isfinite(prior).all():
    v=np.maximum(candles[:,1]-candles[:,2],np.maximum(np.abs(candles[:,1]-prior),np.abs(candles[:,2]-prior)))
    atr[i]=float(np.mean(v))
 return ema,atr

def generate(h,m,btc,mode,sym,qa):
 regA,regB=calc_regime(h,btc);reg=regA if mode=='A' else regB
 ema,atr=ema12_at(h)
 signals=[]
 counters=collections.Counter()
 arm=None
 # Use M15 boundary k=M5 index divisible 3: latest completed three M5 at [k-3,k),
 # 2 prior completed M15 from [k-9,k-3). Entry is M5[k] open.
 mfinite=np.isfinite(m[:,3]) & np.isfinite(m[:,4])
 active=np.r_[0,np.cumsum((m[:,4]>0)&mfinite)]
 for k in range(9,N_M,3):
  t=MS+k*M
  period=next((name for name,(beg,end) in PERIODS.items() if beg<=t<end),None)
  if period is None:arm=None;continue
  # Keep signal generation independent of exit. Cross-period return not included.
  if k<576 or k+48*12>=N_M:continue
  ih=(t-HS)//H
  if ih>=len(h):break
  side=int(reg[ih])
  if side==0:
   arm=None
   counters[period+'/NO_TRADE_REGIME']+=1
   continue
  if arm is not None and (arm['direction']!=side or t-arm['t']>8*H):arm=None
  if k%12==0:
   last=h[ih-1];previous=h[ih-2]
   a=atr[ih-1];e=ema[ih-1]
   if np.isfinite(last).all() and np.isfinite(previous).all() and np.isfinite([a,e]).all() and a>0:
    if side==1:
     pull=last[3]<previous[3] and last[2]<=e*1.004 and last[3]>=e*.988
    else:
     pull=last[3]>previous[3] and last[1]>=e*.996 and last[3]<=e*1.012
    if pull:
     swinglo=float(np.min(h[ih-6:ih,2]))
     swinghi=float(np.max(h[ih-6:ih,1]))
     if np.isfinite([swinglo,swinghi]).all():
      arm={'t':t,'direction':side,'atr':a,'swinglo':swinglo,'swinghi':swinghi}
      counters[period+'/ARMED']+=1
  if arm is None or t<=arm['t']:continue
  if not np.isfinite(m[k-9:k,:4]).all():counters[period+'/M5_MISSING']+=1;continue
  if not np.isfinite(h[ih-48:ih,:4]).all():counters[period+'/H1_MISSING']+=1;continue
  vol=(active[k]-active[k-576])/576
  if vol<VOLUME:counters[period+'/ILLIQUID']+=1;continue
  # H1 and M5 price crosscheck for six fully closed H1 hours.
  mismatch=False
  for hi in range(ih-6,ih):
   mi=(HS+hi*H-MS)//M
   if mi<0 or mi+12>N_M or not np.isfinite(m[mi:mi+12,:4]).all():
    mismatch=True;break
   bar=h[hi];block=m[mi:mi+12]
   q=[block[0,0],np.max(block[:,1]),np.min(block[:,2]),block[-1,3]]
   if any(abs(float(bar[j])/v-1)>0.001 for j,v in enumerate(q)):
    mismatch=True;break
  if mismatch:
   counters[period+'/H1_M5_MISMATCH']+=1
   continue
  last=m[k-3:k]
  o=float(last[0,0]);c=float(last[-1,3])
  prev=m[k-9:k-3]
  if side==1:hit=c>o and c>np.max(prev[:,1])
  else:hit=c<o and c<np.min(prev[:,2])
  if not hit:continue
  price=m[k,0]
  if not np.isfinite(price) or price<=0:continue
  distance=(price-arm['swinglo'] if side==1 else arm['swinghi']-price)+.25*arm['atr']
  frac=float(np.clip(max(1.2*arm['atr'],distance)/price,.015,.08))
  risk=.08 if frac>=.08 else frac
  signals.append({'symbol':sym,'strategy':'Y06_R2_'+mode,'direction':'LONG' if side==1 else 'SHORT',
    'period':period,'entryTs':t,'entry':float(price),'riskFraction':risk,
    'atr14h':float(arm['atr']),'swinglo':arm['swinglo'],'swinghi':arm['swinghi'],
    'setupTs':arm['t'],'m5_nonzero_prev48h_ratio':float(vol)})
  counters[period+'/TRIGGERED']+=1
  arm=None
 return signals,counters

def exit_trade(sig,m,hours=24,extra_stop_slip=0.):
 t=sig['entryTs'];entry=sig['entry'];side=1 if sig['direction']=='LONG' else -1
 i=(t-MS)//M;end=i+hours*12
 if end>=len(m) or not np.isfinite(m[i:end+1,:4]).all():return None
 risk=sig['riskFraction']
 # A structural stop at no more than 8%; resident hard STOP8 is always active.
 stop=entry*(1-side*risk)
 hard=entry*(1-side*.08)
 target=entry*(1+side*1.8*risk)
 reason='TIME';px=m[end,0];exitt=MS+end*M
 for j in range(i,end):
  o,hi,lo,c=m[j,:4]
  hitstop=(lo<=stop or lo<=hard) if side==1 else (hi>=stop or hi>=hard)
  hittarget=(hi>=target) if side==1 else (lo<=target)
  if hitstop:
   floor=(max(stop,hard) if side==1 else min(stop,hard))
   px=min(o,floor) if side==1 else max(o,floor)
   px=px-side*extra_stop_slip*entry
   reason='HARD_STOP8' if abs(floor-hard)<=1e-6*entry else 'STRUCTURAL_STOP'
   exitt=MS+(j+1)*M;break
  if hittarget:
   px=target;reason='TARGET_1P8R';exitt=MS+(j+1)*M;break
 raw=side*(float(px)/entry-1)
 return {**sig,'exitTs':exitt,'exitPrice':float(px),'rawReturn':raw,'exitReason':reason,
   'holdLimitH':hours,'stress_extra_stop_entry_fraction':extra_stop_slip}

def metrics(cands,fee):
 v=np.array([x['rawReturn']-fee/10000 for x in cands])
 p=v[v>0].sum();loss=-v[v<0].sum()
 return {'n':len(v),'wins':int((v>0).sum()),'win_pct':float((v>0).mean()*100) if len(v) else None,
   'mean_net_pct':float(v.mean()*100) if len(v) else None,
   'profit_factor':float(p/loss) if loss>0 else None,
   'stop_count':sum('STOP' in x['exitReason'] for x in cands),
   'target_count':sum(x['exitReason']=='TARGET_1P8R' for x in cands)}

def wallet(cands,period,fee,mfiles,stress=False):
 begin,stop=PERIODS[period];end=stop if period!='FORWARD_INSPECTED' else T('2026-11-26T00:00:00Z')
 sz=(end-begin)//M+1
 eq=np.full(sz,10000.,dtype=np.float64)
 active=[];cooldown={};accepted=[];blocked=collections.Counter()
 for x in sorted(cands,key=lambda y:(y['entryTs'],y['symbol'],y['direction'])):
  t=x['entryTs'];e=x['exitTs'];side=1 if x['direction']=='LONG' else -1
  if not(begin<=t<stop) or e>=end:continue
  active=[a for a in active if a['exitTs']>t]
  if len(active)>=2:
   blocked['SLOTS_TWO']+=1;continue
  if any(a['symbol']==x['symbol'] for a in active):
   blocked['SAME_SYMBOL']+=1;continue
  if t<cooldown.get(x['symbol'],0):
   blocked['COOLDOWN']+=1;continue
  i=(t-begin)//M;j=(e-begin)//M
  prior=eq[i]
  if not np.isfinite(prior) or prior<=0:
   blocked['NO_CAPITAL']+=1;continue
  notional=.30*prior
  mm=mfiles[x['symbol']]
  s=(t-MS)//M
  prices=mm[s:s+(j-i),0]
  if len(prices)!=j-i or not np.isfinite(prices).all():
   blocked['MARK_MISSING']+=1;continue
  eq[i:j]+=notional*(side*(prices/x['entry']-1)-fee/20000)
  net=notional*(x['rawReturn']-fee/10000)
  eq[j:]+=net
  active.append(x);cooldown[x['symbol']]=e+12*H
  accepted.append({**x,'netPnlJpy':float(net),'notionalJpy':float(notional)})
 peak=np.maximum.accumulate(np.r_[10000,eq])[1:]
 drawdown=1-eq/np.maximum(peak,1e-9)
 profit=sum(x['netPnlJpy'] for x in accepted if x['netPnlJpy']>0)
 loss=-sum(x['netPnlJpy'] for x in accepted if x['netPnlJpy']<0)
 result={'n':len(accepted),'wins':sum(x['netPnlJpy']>0 for x in accepted),
  'win_pct':100*sum(x['netPnlJpy']>0 for x in accepted)/len(accepted) if accepted else None,
  'terminal_jpy':float(eq[-1]),'max_dd_pct':float(100*np.max(drawdown)),
  'profit_factor':float(profit/loss) if loss>0 else None,
  'stop_count':sum('STOP' in x['exitReason'] for x in accepted),
  'target_count':sum(x['exitReason']=='TARGET_1P8R' for x in accepted),
  'blocked':dict(blocked),'by_direction':dict(collections.Counter(x['direction'] for x in accepted)),
  'accepted':accepted}
 return result

def run_all(hfiles,mfiles,label,output):
 dataaudit={};sigs=[];counters=collections.Counter()
 btc=hfiles['BTC']
 for sym in SYMS[1:]:
  for mode in ('A','B'):
   rows,count=generate(hfiles[sym],mfiles[sym],btc,mode,sym,dataaudit)
   sigs+=rows;counters.update(count)
  print('CANDIDATE',label,sym,len([x for x in sigs if x['symbol']==sym]),flush=True)
 result={'meta':{'status':'RESEARCH_ONLY_NOT_PRODUCTION_AUTHORITY','label':label,
   'protocol_sha256':hashlib.sha256(PR.read_bytes()).hexdigest(),
   'data':'ASTER archived public H1/M5 source; completed bars; quality75%, H1-M5 six-hour OHLC check <0.1%',
   'risk':'STANDALONE R2 only; two-slot, no peer-runner gross or funding or ASTER orders; 10/30bps roundtrip',
   'caveats':['All prior PRE/TARGET/FORWARD were inspected for earlier Y06 experiments; not untouched OOS',
    'For stops, adverse gap at M5 open, conservative stop priority; target exact price, no spread/slippage beyond fee, no funding',
    'Portfolio assigns simultaneous signals alphabetically; no 7-runner opportunity scorer or global Daily Loss/DD matching',
    'Synthetic artificial market outcomes if label says synthetic are not empirical evidence.']},
   'candidate_counts':dict(counters),'signals':sigs,'strategies':{}}
 for mode in ('A','B'):
  for hours in (24,48):
   key='Y06_R2_'+mode+'_E'+str(hours)
   src=[x for x in sigs if x['strategy']=='Y06_R2_'+mode]
   trades=[]
   stressed=[]
   for x in src:
    e=exit_trade(x,mfiles[x['symbol']],hours)
    if e is not None:
     trades.append(e)
     # Stress is run with same entry, 0.5% adverse stop-fill slippage on every stop.
     if e['exitReason'] in ('HARD_STOP8','STRUCTURAL_STOP'):
      z=dict(e);s=1 if e['direction']=='LONG' else -1
      z['exitPrice']=e['exitPrice']-s*.005*e['entry']
      z['rawReturn']=s*(z['exitPrice']/e['entry']-1)
      z['stress_extra_stop_entry_fraction']=.005
     else:z=dict(e)
     stressed.append(z)
   s={'candidate_count':len(src),'valid_exits':len(trades),'by_period':{}}
   for name in PERIODS:
    a=[x for x in trades if x['period']==name]
    b=[x for x in stressed if x['period']==name]
    s['by_period'][name]={
     'candidate_trades':len(a),
     'all_fills':{str(fee):metrics(a,fee) for fee in (10,30)},
     'account':{str(fee):wallet(a,name,fee,mfiles) for fee in (10,30)},
     'account_stress30_extra_stop_0P5pct':wallet(b,name,30,mfiles,True)}
    q=s['by_period'][name]['account']['30']
    print('RESULT',label,key,name,'N',q['n'],'WIN',q['win_pct'],
      'EQUITY',round(q['terminal_jpy'],2),'DD',round(q['max_dd_pct'],3),
      'PF',q['profit_factor'],'BLOCKED',q['blocked'],flush=True)
   result['strategies'][key]=s
 if output.exists():raise RuntimeError('OUTPUT_EXISTS_REFUSE_REWRITE')
 output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8')
 print('FINAL',label,'OUTPUT',output,'SHA256',hashlib.sha256(output.read_bytes()).hexdigest(),flush=True)
 return result

if __name__=='__main__':
 t=time.monotonic()
 hfiles={};mfiles={};manifest={}
 for s in SYMS:
  h,hi=data(s,'1h');m,mi=data(s,'5m')
  hfiles[s]=h;mfiles[s]=m;manifest[s]={'H1':hi,'M5':mi}
  print('ASSET',s,'H1',hi['coverage'],'M5',mi['coverage'],
     'POSVOL_M5',mi['active_volume_count'],'CONFLICT',mi['contradictions_over_one_bp'],flush=True)
 output=WORK/'Y06_R2_NEW_LOGIC_ARCHIVED_M5_BACKTEST_20261126.json'
 run_all(hfiles,mfiles,'REAL_ARCHIVED_ASTER',output)
 manifestpath=WORK/'Y06_R2_SOURCE_DATA_AND_QUALITY_MANIFEST_20261126.json'
 assert not manifestpath.exists()
 manifestpath.write_text(json.dumps({'protocol_sha256':hashlib.sha256(PR.read_bytes()).hexdigest(),
 'symbol_quality':manifest,'output_bt_sha256':hashlib.sha256(output.read_bytes()).hexdigest()},
 ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('DATA_MANIFEST',manifestpath,'SHA256',hashlib.sha256(manifestpath.read_bytes()).hexdigest(),
 'TOTAL_SECONDS',round(time.monotonic()-t,2),flush=True)
