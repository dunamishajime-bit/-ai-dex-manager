#!/usr/bin/env python3
"""New native H1 signal families from price + Binance CVD/OI + funding,
with independent conservative M5 stop-first fills. Does not touch LIVE.
All rules fixed BEFORE reading outcomes; evaluate both historical years.
"""
from __future__ import annotations
import bisect,collections,datetime as dt,hashlib,json,math
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
R=HERE.parents[1]
OUT=R/'docs/research/results/render-orderflow-20261024'
BASE=R/'docs/research/results/idle-entry-three-20261024'
def setup():
 from importlib import util
 q=util.spec_from_file_location('render_rich_flow',HERE/'render-orderflow-composite-20261024.py')
 m=util.module_from_spec(q);q.loader.exec_module(m);return m
m=setup()
EXIT_CONTRACT={
 '6H_TP1P5_SL2':(0.015,0.02,6),
 '12H_TP1P75_SL2P5':(.0175,.025,12),
 '18H_TP2P5_SL3':(.025,.03,18),
}
def rules(f,prev,flow):
 p=flow
 a=f['ret3']>=1 and f['hourWick']>=.35 and p['seller1']>.05 and p['sellerAcceleration']<-.06 and p['oi3Pct']>=.15
 b=f['btc24']<=-1 and f['ret6']<=-1 and p['oi3Pct']>.25 and p['seller1']>.1 and p['seller3']>.04 and f['ret1']<=-.15
 c=f['ret6']>=2 and p['oi3Pct']>=.4 and p['longShortTopChange3h']<0 and p['seller1']>.05 and f['last30']<=-.15
 d=f['ret24']<=-3 and f['ret3']>=.6 and f['priorRebound']>=1 and p['oi1Pct']>.05 and p['seller1']>.06 and f['last15']<-.15
 e=f['ret3']>=.75 and p['fundingBps']>=.6 and p['seller1']>.075 and p['oi3Pct']>0
 g=f['rel6']<=-1.2 and f['btc24']<=-.5 and p['oi3Pct']>.15 and p['seller1']>.075 and f['ret1']<0
 h=f['ret1']>.7 and f['hourWick']>.8 and p['oi1Pct']>.1 and p['seller1']>0 and f['last15']<-.1
 i=f['ret24']<=-4 and p['oi3Pct']<-.3 and p['seller1']>.1 and f['last15']<-.2 and f['priorRebound']>.6
 # Complex two-stage entry confirmation: previous rising long OI -> next
 # hour falls below earlier close with increasing taker selling and OI.
 j=(prev['ret3']>=1.2 and prev['last15']>=.1 and f['ret1']<=-.25 and
    f['last15']<=-.15 and p['seller1']>.06 and p['sellerAcceleration']<-.04 and
    p['oi1Pct']>.05 and f['rangePos1']<.45)
 return {'OI_ABSORPTION_TOP':a,'OI_NEW_SHORTS_BEAR':b,'SQUEEZE_OVERHANG':c,
         'BEARISH_RETEST_FAIL':d,'POSITIVE_FUNDING_CROWDING':e,
         'RELATIVE_SHORT_PRESSURE':g,'OI_STOP_HUNT_FADE':h,
         'LONGS_EXIT_CONTINUATION':i,'TWO_HOUR_OI_SELL_SHIFT':j}
def feature_window(bars,btc,start,end,mtimes,metrics,ftimes,frates):
 cur_times=[int(b[0]) for b in bars]
 btc_times=[int(b[0]) for b in btc]
 assert cur_times==btc_times
 sums=m.history_features(bars)
 accepted=[]
 feats_count=collections.Counter();flowmissing=0
 for i in range(312,len(bars)-225):
  t=cur_times[i]+m.MIN5
  if t<start or t>=end or t%m.e.screen.HOUR:continue
  if cur_times[i+1]!=t or cur_times[i-300]!=cur_times[i]-300*m.MIN5:continue
  f=m.e.screen.proc(bars,btc,i,i)
  prev=m.e.screen.proc(bars,btc,i-12,i-12)
  event={'t':t,'index':i}
  flow=m.metrics_for_event(event,metrics,mtimes,ftimes,frates,bars,sums)
  if flow is None:flowmissing+=1;continue
  tags=rules(f,prev,flow)
  matches=[k for k,v in tags.items() if v]
  if not matches:continue
  z={'t':t,'index':i,'features':{'ret3':f['ret3'],'ret24':f['ret24'],
     'btc24':f['btc24'],'oi1Pct':flow['oi1Pct'],'oi3Pct':flow['oi3Pct'],
     'seller1':flow['seller1'],'seller3':flow['seller3'],
     'fundingBps':flow['fundingBps']},'tags':matches}
  accepted.append(z)
  feats_count.update(matches)
 print('FAMILY_EVAL',start,end,'signals',len(accepted),'missing',flowmissing,
  'tags',dict(feats_count),flush=True)
 return accepted,dict(feats_count),flowmissing
def pick(events,bars,rule,ex):
 out=[];allowed=0
 for z in events:
  if z['t']<allowed or rule not in z['tags']:continue
  trade=m.e.screen.settle(bars,z['index'],*ex,30)
  q={'ts':z['t'],'return30':trade['netPct'],'exitTs':trade['exitTs'],
     'reason':trade['exitReason'],'tags':z['tags']}
  out.append(q);allowed=trade['exitTs']+12*m.e.screen.HOUR
 return out
def result(v,cost):
 pnl=[z['return30']+(30-cost)/100 for z in v]
 pos=sum(x for x in pnl if x>0)
 neg=-sum(x for x in pnl if x<=0)
 return {'n':len(pnl),'wins':sum(x>0 for x in pnl),
 'WR':round(100*sum(x>0 for x in pnl)/len(pnl),2) if pnl else None,
 'PF':round(pos/neg,4) if neg else None,'sumPct':round(sum(pnl),3),
 'maxLossPct':round(min(pnl),3) if pnl else None,
 'reasons':dict(collections.Counter(x['reason'] for x in v))}
def main():
 man=json.loads((OUT/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 data=man['files']
 met,quality=m.read_metrics(data)
 mt=[x[0] for x in met]
 fr=m.read_funding(data);ft=[x[0] for x in fr];rates=[x[1] for x in fr]
 oldb=m.read_render_bars(data,True);newb=m.read_render_bars(data,False)
 oldm=json.loads((BASE/'IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
 oldbtc,_=m.e.old_mod.parse_months(oldm,'BTCUSDT')
 n=m.e.imp('newroute_source_readonly',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 source,_=n.native.m.m.core.task8.legacy.bootstrap()
 newbtc,_=source.getdata('BTCUSDT')
 old,oCounts,oMiss=feature_window(oldb,oldbtc,m.e.OLD_BEGIN,m.e.CAL_END,mt,met,ft,rates)
 new,nCounts,nMiss=feature_window(newb,newbtc,m.e.NEW_BEGIN,m.e.NEW_END,mt,met,ft,rates)
 evidence={'status':'INDEPENDENT_NEW_H1_FLOW_SOURCE_RESEARCH_ONLY_NOT_NATIVE_FULL8',
 'warnings':['Multiple preset structural hypotheses, not 8-strategy integrated executable economics',
  'Historical periods previously explored, not pristine forward holdout',
  '5m TP/STOP stop-first, no venue fill latency or funding PnL',
  'Causal metrics availability +10 minutes; missing snapshots rejected'],
 'input':{'sourceManifest':str((OUT/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').relative_to(R)),
    'olderSignalEvents':len(old),'newerSignalEvents':len(new),'metricBadSnapshots':quality['bad'],
    'oldMissingHourlyFeatures':oMiss,'newMissingHourlyFeatures':nMiss,
    'olderCountByTag':oCounts,'newerCountByTag':nCounts},
 'models':{}}
 for tag in sorted(set(oCounts)|set(nCounts)):
  for exitname,ex in EXIT_CONTRACT.items():
   older=pick(old,oldb,tag,ex)
   newer=pick(new,newb,tag,ex)
   cal=[x for x in older if x['ts']>=m.e.TRAIN_END]
   train=[x for x in older if x['ts']<m.e.TRAIN_END]
   first=[x for x in newer if x['ts']<m.e.NEW_SPLIT]
   second=[x for x in newer if x['ts']>=m.e.NEW_SPLIT]
   result_={'case':tag+'__'+exitname}
   for c in (10,30):
    result_[str(c)]={'train':result(train,c),'calibration':result(cal,c),
                    'newer':result(newer,c),'newerFirst':result(first,c),
                    'newerSecond':result(second,c)}
   evidence['models'][result_['case']]=result_
   v=result_['30']
   print('ROUTE',result_['case'],
         'OLD_CAL',v['calibration']['n'],v['calibration']['PF'],
         'NEW',v['newer']['n'],v['newer']['WR'],v['newer']['PF'],
         'LATE',v['newerSecond']['PF'],flush=True)
 qualified=[]
 for k,v in evidence['models'].items():
  a=v['30']['calibration'];b=v['30']['newer'];aa=v['10']['calibration']
  if a['n']>=8 and b['n']>=20 and (a['PF'] or 0)>1 and (aa['PF'] or 0)>1:
   qualified.append(k)
 evidence['calibrationQualifiedNames']=qualified
 output=OUT/'RENDER_FLOW_NEW_ENTRY_ROUTES_20261024.json'
 output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('FROZEN_QUALED_ON_OLD_CAL',qualified,'OUTPUT',output,flush=True)
if __name__=='__main__':main()
