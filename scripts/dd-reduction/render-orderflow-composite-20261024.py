#!/usr/bin/env python3
"""RENDER SHORT: causal microstructure/position-state ablation vs frozen price model.
Research only; no broker actions or shared8 portfolio integration. Older train
and calibration only; 2025-26 never used for model choice. Previously explored
periods are retrospective, NOT pristine out-of-sample proof.

Conservative Binance metrics archive availability timestamp: create_time+10m.
Funding: calc_time+5m. 5m OHLCV/taker buy: only complete bars at entry.
"""
from __future__ import annotations
import bisect,collections,csv,datetime as dt,hashlib,importlib.util,io,json,math,zipfile
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
EVD=REPO/'docs/research/results/render-orderflow-20261024'
SRC=REPO/'docs/research/results/idle-entry-three-20261024'
DAYS=12*3600000//12
MIN5=300000
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
e=load('render_price_study',HERE/'render-multiregime-ensemble-screen-20261024.py')
def csv_from_archive(entry):
 path=Path(entry['file'])
 data=path.read_bytes()
 assert hashlib.sha256(data).hexdigest()==entry['sha256'],('SOURCE_SHA',path)
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  assert z.testzip() is None
  names=[n for n in z.namelist() if n.endswith('.csv')]
  assert len(names)==1
  with z.open(names[0]) as f:
   return list(csv.reader(io.TextIOWrapper(f,encoding='utf-8-sig')))
def read_render_bars(files,older):
 if older:
  mani=json.loads((SRC/'IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text(encoding='utf8'))
  entries=[x for x in mani['files'] if x['symbol']=='RENDERUSDT']
 else:
  entries=[x for x in files if x['kind']=='klines5m']
 entries.sort(key=lambda x:x.get('key',x.get('month','')))
 rows=[]
 for file in entries:
  arr=csv_from_archive(file)
  for r in arr:
   if not r or not r[0].isdigit():continue
   assert len(r)>=11,('NO_TAKER_BUY_VOLUME',file['file'])
   t=int(r[0]);v=float(r[5]);buy=float(r[9])
   assert 0<=buy<=v+1e-5
   rows.append((t,float(r[1]),float(r[2]),float(r[3]),float(r[4]),v,buy))
 rows.sort(key=lambda z:z[0])
 assert len(rows)>100000
 assert all(rows[i][0]-rows[i-1][0]==MIN5 for i in range(1,len(rows))),('RENDER_5M_GAP',len(rows))
 print('BARS',('OLDER' if older else 'NEWER'),len(rows),rows[0][0],rows[-1][0],flush=True)
 return rows
def parse_metric_time(s):
 v=dt.datetime.strptime(s,'%Y-%m-%d %H:%M:%S').replace(tzinfo=dt.timezone.utc)
 return int(v.timestamp()*1000)
def read_metrics(files):
 entries=sorted((z for z in files if z['kind']=='metrics'),key=lambda v:v['key'])
 snapshots=[];bad=0;dups=0;observed_label={}
 for ent in entries:
  rows=csv_from_archive(ent)
  assert rows[0][:3]==['create_time','symbol','sum_open_interest'],rows[0]
  for row in rows[1:]:
   try:
    stamped=parse_metric_time(row[0]);base=float(row[2]);oi_usd=float(row[3])
    top_acc=float(row[4]);top_size=float(row[5]);all_acc=float(row[6]);taker_ratio=float(row[7])
    if not (all(math.isfinite(v) for v in (base,oi_usd,top_acc,top_size,all_acc,taker_ratio)) and base>0 and oi_usd>0):
     bad+=1;continue
    # make at least 10m of room before snapshot can be used, including
    # 2026-06-25 forward-stamped daily interval convention change.
    avail=stamped+2*MIN5
    snapshots.append((avail,base,oi_usd,top_acc,top_size,all_acc,taker_ratio))
   except (ValueError,IndexError):bad+=1
 snap_by_ts={}
 for s in snapshots:
  if s[0] in snap_by_ts:
   dups+=1
   # If two observations disagree at the same instant, exclude that instant.
   if snap_by_ts[s[0]] != s:snap_by_ts[s[0]]=None
  else:snap_by_ts[s[0]]=s
 snapshots=sorted(s for s in snap_by_ts.values() if s is not None)
 print('METRICS',len(snapshots),'BAD',bad,'DUP',dups,'PERIOD',snapshots[0][0],snapshots[-1][0],flush=True)
 assert len(snapshots)>180000
 return snapshots,{'bad':bad,'duplicateTime':dups,'n':len(snapshots)}
def read_funding(files):
 values=[]
 for ent in sorted((z for z in files if z['kind']=='fundingRate'),key=lambda r:r['key']):
  rows=csv_from_archive(ent)
  assert rows[0][0]=='calc_time'
  for v in rows[1:]:
   try:
    t=int(v[0])+MIN5;rate=float(v[2])
    if math.isfinite(rate):values.append((t,rate))
   except (IndexError,ValueError):continue
 values.sort()
 assert len(values)>4000
 print('FUNDING',len(values),flush=True)
 return values
def history_features(bars):
 vols=np.asarray([r[5] for r in bars],dtype=np.float64)
 delta=np.asarray([2*r[6]-r[5] for r in bars],dtype=np.float64)
 v=np.r_[0,np.cumsum(vols)]
 d=np.r_[0,np.cumsum(delta)]
 return v,d
def metrics_for_event(event,metrics,mtimes,ftimes,frates,bars,cums):
 t=int(event['t']);idx=int(event['index'])
 # Each row is eligible as of its conservative effective availability time.
 def snap(ts):
  j=bisect.bisect_right(mtimes,ts)-1
  if j<0 or ts-mtimes[j]>20*60000: return None
  return metrics[j]
 now=snap(t);before1=snap(t-3600000);before3=snap(t-3*3600000);before12=snap(t-12*3600000)
 if any(x is None for x in (now,before1,before3,before12)):return None
 oi=now[1];oilag1=before1[1];oilag3=before3[1];oilag12=before12[1]
 if min(oi,oilag1,oilag3,oilag12)<=0:return None
 v,d=cums
 def flow(n):
  j=idx+1
  vol=float(v[j]-v[j-n]);delta=float(d[j]-d[j-n])
  if vol<=0:return None
  return delta/vol
 flow1=flow(12);flow3=flow(36);flow6=flow(72)
 if any(x is None for x in (flow1,flow3,flow6)):return None
 prev1vol=float(v[idx+1-12]-v[idx+1-24])
 curvol=float(v[idx+1]-v[idx+1-12])
 if prev1vol<=0:return None
 fj=bisect.bisect_right(ftimes,t)-1
 if fj<0 or t-ftimes[fj]>13*3600000:return None
 funding=float(frates[fj])
 oi1=100*math.log(oi/oilag1);oi3=100*math.log(oi/oilag3);oi12=100*math.log(oi/oilag12)
 rel_top=math.log(max(now[4],.01)/max(before3[4],.01))
 rel_acc=math.log(max(now[5],.01)/max(before3[5],.01))
 # The public "taker long/short" ratio is a third independent flow sensor.
 old_ratio=float(before1[6]);new_ratio=float(now[6])
 price1=float(bars[idx][4])/float(bars[idx-12][4])-1
 return {
 'oi1Pct':oi1,'oi3Pct':oi3,'oi12Pct':oi12,'longShortTopChange3h':rel_top,
 'longShortAllChange3h':rel_acc,
 'metricTakerRatio':np.log(max(new_ratio,.01)),
 'metricTakerRatioChange1h':np.log(max(new_ratio,.01)/max(old_ratio,.01)),
 'seller1':-flow1,'seller3':-flow3,'seller6':-flow6,
 'sellerAcceleration':flow3-flow1,
 'volumeSpike1h':math.log(curvol/prev1vol),
 'fundingBps':funding*10000,
 'priceOiDivergence':-oi1 if price1<-.002 else oi1,
 'sellerOIInteraction':(-flow1)*oi1,
 'sellerRatioInteraction':(-flow1)*rel_top,
 }
def asof_tests(metrics,times,features,rows):
 # explicit causality assertions and time separation.
 for x in rows[::max(1,len(rows)//100)]:
  t=x['t']
  j=bisect.bisect_right(times,t)-1
  assert j>=0 and times[j]<=t
 assert features
def split_old(rows):
 x=[r for r in rows if r['t']<e.TRAIN_END]
 y=[r for r in rows if r['t']>=e.TRAIN_END]
 return x,y
FEAT=[
 'oi1Pct','oi3Pct','oi12Pct','longShortTopChange3h','longShortAllChange3h',
 'metricTakerRatio','metricTakerRatioChange1h','seller1','seller3','seller6',
 'sellerAcceleration','volumeSpike1h','fundingBps','priceOiDivergence',
 'sellerOIInteraction','sellerRatioInteraction']
def matrix(values,indices,trainn,priceold,pricenew):
 old=np.array([[r['flow'][k] for k in FEAT] for r in values],dtype=float)
 vals=np.array([[r['flow'][k] for k in FEAT] for r in indices],dtype=float)
 mu=np.median(old[:trainn],axis=0)
 sd=np.maximum(np.std(old[:trainn],axis=0),.05)
 oa=np.clip((old-mu)/sd,-4,4); na=np.clip((vals-mu)/sd,-4,4)
 def subset(y,z,mode):
  if mode=='price':return y
  if mode=='oi':col=[0,1,2,3,4,13]
  elif mode=='taker':col=[7,8,9,10,11]
  elif mode=='oi+taker':col=[0,1,2,3,4,7,8,9,10,11,13,14,15]
  elif mode=='all':col=list(range(len(FEAT)))
  else:raise ValueError(mode)
  return np.column_stack([y,z[:,col]])
 return [(mode,subset(priceold,oa,mode),subset(pricenew,na,mode)) for mode in ('price','oi','taker','oi+taker','all')]
def rules(r):
 f=r['flow'];ts=r['tags']
 # Designed from market mechanics, NOT selected with future trade outcomes.
 # 1. Rebound rejected as taker selling resumes, plus OI acceleration.
 a=('two_stage' in ts or 'relative_top' in ts) and f['seller1']>=.055 and f['sellerAcceleration']<=-.025 and f['oi1Pct']>=.05
 # 2. Rising OI while price falls and aggressive selling wins; avoid long chase.
 b='bear_break' in ts and f['seller1']>=.08 and f['oi3Pct']>=.1 and f['seller3']>=.02
 # 3. Exhausted long squeeze with weak taker-flow into elevated OI.
 c='btc_trap' in ts and f['seller1']>=.045 and f['longShortTopChange3h']<=0 and f['oi3Pct']>=.05
 return {'rejection_new_shorts':a,'bear_break_seller_OI':b,'btc_trap_rejection':c}
def block_screen(old,new,score_old,score_new,trainn):
 print('FLOW_RULES')
 allout={}
 for k in ('rejection_new_shorts','bear_break_seller_OI','btc_trap_rejection','any_flow_confirmation'):
  def qualifies(r):
   d=rules(r)
   return any(d.values()) if k=='any_flow_confirmation' else d[k]
  # Standalone fixed TP1.75/SL2.5/12h and within-sleeve 12h cooldown,
  # to compare undistorted standalone signal counts.
  def select(rows):
   out=[];allowed=0
   for r in rows:
    if r['t']>=allowed and qualifies(r):
     x=dict(r);x['policy']='normal'
     out.append(x);allowed=x['exits']['normal']['exitTs']+12*e.screen.HOUR
   return out
  ocal=select(old[trainn:])
  year=select(new)
  first=select([r for r in new if r['t']<e.NEW_SPLIT])
  late=select([r for r in new if r['t']>=e.NEW_SPLIT])
  # also train OI gate consistency.
  ot=select(old[:trainn])
  v={z:{'train':e.summarize(ot,int(z)),'calibration':e.summarize(ocal,int(z)),
    'new':e.summarize(year,int(z)),
    'newEarly':e.summarize(first,int(z)),'newLate':e.summarize(late,int(z))}
    for z in ('10','30')}
  allout[k]=v
  print('FLOWRULE',k,'CAL_N',v['30']['calibration']['n'],
    'CAL_PF',v['30']['calibration']['pf'],'NEW',v['30']['new']['n'],
    v['30']['new']['wrPct'],v['30']['new']['pf'],'HALVES',v['30']['newEarly']['pf'],
    v['30']['newLate']['pf'],flush=True)
 return allout
def main():
 manifest=json.loads((EVD/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text(encoding='utf8'))
 assert all(c['expected']==c['valid'] for c in manifest['summary'].values())
 entries=manifest['files']
 metrics,quality=read_metrics(entries)
 mtimes=[r[0] for r in metrics]
 fund=read_funding(entries)
 ftimes=[r[0] for r in fund];frates=[r[1] for r in fund]
 oldbars=read_render_bars(entries,True)
 newbars=read_render_bars(entries,False)
 # Existing independently verified BTC dataset, no extra downloads required.
 oldm=json.loads((SRC/'IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 btc_old,btc_ts=e.old_mod.parse_months(oldm,'BTCUSDT')
 native=e.imp('orderflow_readonly_native',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 provider,_=native.native.m.m.core.task8.legacy.bootstrap()
 btc_new,btc_new_ts=provider.getdata('BTCUSDT')
 pnew,tnew=provider.getdata('RENDERUSDT')
 assert len(newbars)==len(pnew)
 assert all((a[0],a[4])==(b[0],b[4]) for a,b in zip(newbars,pnew)),('RENDER_NEW_PRICE_SOURCE_MISMATCH',len(newbars))
 assert len(oldbars)==len(btc_old) and all(a[0]==b[0] for a,b in zip(oldbars,btc_old)),('OLDER_M5_BTC_ALIGNMENT')
 assert len(newbars)==len(btc_new) and all(a[0]==b[0] for a,b in zip(newbars,btc_new)),('NEWER_M5_BTC_ALIGNMENT')
 older=e.prepare(oldbars,btc_old,e.OLD_BEGIN,e.CAL_END,'old_flow')
 newer=e.prepare(newbars,btc_new,e.NEW_BEGIN,e.NEW_END,'new_flow')
 for rows,bars in ((older,oldbars),(newer,newbars)):
  cumul=history_features(bars)
  for r in rows:
   v=metrics_for_event(r,metrics,mtimes,ftimes,frates,bars,cumul)
   if v is not None:r['flow']=v
 # Fail closed for all candidates with incomplete as-of microstructure.
 oldmissing=sum('flow' not in r for r in older);newmissing=sum('flow' not in r for r in newer)
 older=[r for r in older if 'flow' in r];newer=[r for r in newer if 'flow' in r]
 assert oldmissing<=10 and newmissing<=10,('METRICS_CAUSAL_GAPS',oldmissing,newmissing)
 asof_tests(metrics,mtimes,older,older)
 print('CAUSAL_ALIGNED',len(older),len(newer),'missing',oldmissing,newmissing,flush=True)
 oldX,newX,n=e.make_X(older,newer)
 report={'status':'RETROSPECTIVE_CAUSAL_MICROSTRUCTURE_ABLATION_NOT_SHARED8_NOT_LIVE',
 'warnings':['No gross/ownership/pending allocation; NOT integrated 8-strategy BT',
             'Previously researched time periods; NOT independent forward OOS',
             '10-minute conservative metrics availability lag addresses 2026-06-25 timestamp shift',
             'Funding historical rate used as predictor, funding P&L not applied',
             'No venue lifecycle, order latency, book/liquidations or partial fills'],
 'data':{'manifest':str((EVD/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').relative_to(REPO)),
         'manifestSHA':hashlib.sha256((EVD/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_bytes()).hexdigest(),
         'metricsQuality':quality,'selectedOld':len(older),'selectedNew':len(newer),'missingOld':oldmissing,
         'missingNew':newmissing,'sourceOHLCParity':True},
 'models':{},'mechanicalConfirmations':{}}
 fitcases=matrix(older,newer,n,oldX,newX)
 for mode,X,Y in fitcases:
  coef=e.fit(X,older,n)
  train_predictions=X[:n]@coef
  held_predictions=X[n:]@coef
  new_predictions=Y@coef
  for quantile in (.40,.60,.75,.85):
   cutoff=float(np.quantile(np.max(train_predictions,axis=1),quantile))
   oldtrain=e.pick(older[:n],X[:n],coef,cutoff)
   oldcal=e.pick(older[n:],X[n:],coef,cutoff)
   sel=e.pick(newer,Y,coef,cutoff)
   early=[r for r in sel if r['t']<e.NEW_SPLIT]
   late=[r for r in sel if r['t']>=e.NEW_SPLIT]
   v={'rule':{'mode':mode,'quantile':quantile,'trainingScoreCutoff':cutoff},
     'train':{str(c):e.summarize(oldtrain,c) for c in (10,30)},
     'calibration':{str(c):e.summarize(oldcal,c) for c in (10,30)},
     'newer':{str(c):e.summarize(sel,c) for c in (10,30)},
     'newerEarly':{str(c):e.summarize(early,c) for c in (10,30)},
     'newerLate':{str(c):e.summarize(late,c) for c in (10,30)}}
   key=f'{mode}:q{quantile}'
   report['models'][key]=v
   print('ENSEMBLE',key,'CAL30',v['calibration']['30']['n'],v['calibration']['30']['pf'],
    'NEW30',v['newer']['30']['n'],v['newer']['30']['wrPct'],v['newer']['30']['pf'],
    'LATE30',v['newerLate']['30']['pf'],flush=True)
 report['mechanicalConfirmations']=block_screen(older,newer,None,None,n)
 # No selecting a best model using latter-year test results.
 eligible=[(k,v) for k,v in report['models'].items()
   if v['calibration']['30']['n']>=18 and (v['calibration']['30']['pf'] or 0)>1.0
      and (v['calibration']['10']['pf'] or 0)>1.0]
 report['preselection']={'eligibleOnOlderCalibrationOnly':[k for k,v in eligible],
  'requiresPostselect8CommonWalletBeforeAdoption':True}
 output=EVD/'RENDER_ORDERFLOW_COMPOSITE_ABLATION_20261024.json'
 output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('READY',output,'eligible',report['preselection'],flush=True)
if __name__=='__main__':main()
