#!/usr/bin/env python3
"""Evaluate ALREADY FIXED RENDER short-entry patterns from the later year on
the disjoint older 2024-08 to 2025-07 Binance Futures public M5 archives.
Never optimize thresholds using older performance. Separate from full8 wallet.
"""
from __future__ import annotations
import bisect,datetime,hashlib,importlib.util,io,json,math,zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
D=REPO/'docs/research/results/idle-entry-three-20261024'
CACHE=Path('C:/tmp/idle-render-independent-older-m5-20261024')
SRC=D/'IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json'
RECENT=D/'IDLE_RENDER_NEW_RETRACEMENT_SHORT_INDEPENDENT_5M_20261024.json'
BASE=datetime.datetime(2024,8,1,tzinfo=datetime.timezone.utc)
END=datetime.datetime(2025,8,1,tzinfo=datetime.timezone.utc)
SPLIT=datetime.datetime(2025,2,1,tzinfo=datetime.timezone.utc)
def load(n,p):
 spec=importlib.util.spec_from_file_location(n,p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('render_fixed_future_selected_signal_rules',HERE/'screen-render-fresh-rally-fade-m5-20261024.py')
def parse_months(manifest,sym):
 assets=[x for x in manifest['files'] if x['symbol']==sym]
 assert len(assets)==12 and all(x['available'] for x in assets),('INCOMPLETE_YEAR',sym,len(assets))
 data=[]
 for ent in assets:
  path=Path(ent['file'])
  assert path.resolve().is_relative_to(CACHE.resolve()),('ARCHIVE_NOT_ISOLATED',path)
  assert path.exists()
  h=hashlib.sha256(path.read_bytes()).hexdigest()
  assert h==ent['sha256'],('SOURCE_SHA_MISMATCH',sym,ent['month'])
  with zipfile.ZipFile(path) as z:
   assert z.testzip() is None
   names=[x for x in z.namelist() if x.endswith('.csv')]
   assert len(names)==1
   with z.open(names[0]) as f:
    for line in f:
     if not line[:1].isdigit():continue
     parts=line.split(b',')
     try:
      t=int(parts[0])
      bar=(t,*[float(x) for x in parts[1:6]])
     except (ValueError,IndexError):continue
     if min(bar[1:5])<=0:continue
     data.append(bar)
 data.sort(key=lambda x:x[0])
 assert data and data[0][0]>=int(BASE.timestamp()*1000)
 assert data[-1][0]<int(END.timestamp()*1000)
 for i in range(1,len(data)):
  assert data[i][0]-data[i-1][0]==m.M5,('PUBLIC_DATA_GAP_OR_DUPLICATE',sym,i,data[i][:1])
 assert len(data)>=104000,('SHORT_DATA_YEAR',sym,len(data))
 return data,[x[0] for x in data]
def calc(rows):
 return m.result(rows)
def main():
 manifest=json.loads(SRC.read_text('utf8'))
 btc,btct=parse_months(manifest,'BTCUSDT')
 bars,times=parse_months(manifest,'RENDERUSDT')
 assert times==btct,('M5_TIME_AXIS_PARITY',times[:3],btct[:3])
 available=[]
 for i in range(289,len(bars)-145):
  ts=int(times[i])+m.M5
  if ts% m.HOUR:continue
  signal=m.proc(bars,btc,i,i)
  available.append((i,signal))
 assert len(available)>=8500
 print('OLDER_PUBLIC_M5_CLOSED_FEATURES',len(available),'RENDER_BARS',len(bars),'BTC_BARS',len(btc),flush=True)
 old=json.loads(RECENT.read_text('utf8'))['results']
 # Predeclared later-year leads. Evaluate all 33 configurations without any changes.
 report={
  'status':'OLDER_DISJOINT_BTC_RENDER_PRICE_WINDOW_ONLY_NOT_WALLET_AND_NOT_PROSPECTIVE_UNSEEN',
  'olderWindow':'2024-08-01_to_2025-07-31',
  'sourceManifest':str(SRC.relative_to(REPO)),
  'sourceSha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),
  'signalFeaturesArePriorClosedM5':True,'noEntryRetuningBasedOnOlderOutcomes':True,
  'conditionsFromNewResearchFile':str(RECENT.relative_to(REPO)),
  'hazards':['No 8-logic shared wallet, gross budget, pending, priority, route cooldown parity, venue fills or funding.',
             'Backwards chronological older test prevents same-period optimization but is not truly prospective forward OOS.',
             'No rule/exit cost parameter fitted on older year.'],
  'costs':{},'comparison':{}}
 for cost in (10,30):
  byCase={}
  for name,trigger in m.PATTERNS.items():
   indices=[i for i,feat in available if trigger(feat)]
   for exitName,(tp,sl,h) in m.EXIT_POLICIES.items():
    fills=[];allowed=-1
    for i in indices:
     start=int(times[i])+m.M5
     if start<allowed:continue
     fill=m.settle(bars,i,tp,sl,h,cost)
     fills.append(fill)
     allowed=fill['exitTs']+12*m.HOUR
    early=[x for x in fills if x['ts']<int(SPLIT.timestamp()*1000)]
    late=[x for x in fills if x['ts']>=int(SPLIT.timestamp()*1000)]
    key=name+'__'+exitName
    byCase[key]={'hourlySignals':len(indices),'older':calc(fills),'olderEarly':calc(early),'olderLate':calc(late),
      'newer':old[str(cost)][key]['overall'],'newerEarly':old[str(cost)][key]['early'],
      'newerLate':old[str(cost)][key]['late']}
  report['costs'][str(cost)]=byCase
  for name in ['BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD12',
               'BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD6',
               'BROAD_RETRACE_RESISTANCE__TP1P75_SL2P5_HOLD12']:
   z=byCase[name]
   print('PREDECLARED',cost,name,'OLD',z['older'],'OLD_FIRST',z['olderEarly'],'OLD_SECOND',z['olderLate'],
         'RECENT',z['newer'],flush=True)
  qualifying=[]
  for key,v in byCase.items():
   a=v['older'];b=v['newer']
   if a['n']>=20 and a['pf'] and a['pf']>1 and b['n']>=20 and b['pf'] and b['pf']>1:
    qualifying.append((key,a,b))
  report['comparison'][str(cost)]={'bothYearsPFOver1AndAtLeast20Cases':len(qualifying),
     'qualifiedModels':[{'name':name,'older':a,'newer':b} for name,a,b in qualifying]}
  print('CROSS_YEAR_PF_POSITIVE',cost,len(qualifying),[(x[0],x[1]['n'],x[1]['wrPct'],x[1]['pf'],x[2]['pf']) for x in qualifying][:25],flush=True)
 path=D/'IDLE_RENDER_NEW_SHORT_OLDER_OUT_OF_YEAR_M5_VALIDATION_20261024.json'
 path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 print('OLD_PERIOD_RESULTS_SAVED',path,path.stat().st_size)
if __name__=='__main__':main()
