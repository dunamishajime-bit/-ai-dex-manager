from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_lab_pair_specific_v109 as v109
HOUR=v109.HOUR; NORMAL_BPS=v109.NORMAL_BPS; STRESS_BPS=v109.STRESS_BPS; ret=v109.ret; metric=v109.metric
CANDS={'btc_macro_pullback':('BTC',.74,6.0,192),'btc_compression_expansion':('BTC',.70,5.5,168),'eth_residual_trend_state':('ETH',.72,6.0,168),'bnb_breakout_reentry':('BNB',.68,5.5,144),'avax_breadth_leadership':('AVAX',.60,7.5,120)}
def vol(c,i,n):return v109.b.vol(c,i,n)
def eff(c,i,n):return v109.b.efficiency(c,i,n)
def rp(c,i,n):return v109.b.range_position(c,i,n)
def br(candles,idx,ts,n=24):return v109.b.breadth(candles,idx,ts,n)
def z(c,i,n):
 v=vol(c,i,168);r=ret(c,i,n);return 0 if r is None or v<=1e-9 else r/(v*math.sqrt(n)+1e-9)
def sig(cid,candles,idx,ts):
 s=CANDS[cid][0];c=candles[s];i=idx[s].get(ts)
 if i is None or i<900:return 0
 r3=ret(c,i,3) or 0;r6=ret(c,i,6) or 0;r24=ret(c,i,24) or 0;r72=ret(c,i,72) or 0;v24=vol(c,i,24);v96=vol(c,i,96);v336=vol(c,i,336);e=eff(c,i,72);p=rp(c,i,120);bread=br(candles,idx,ts)
 if v336<=1e-9 or v24>3*v336:return 0
 if cid=='btc_macro_pullback':
  trend=z(c,i,120);pull=z(c,i,12)
  if trend>1.0 and pull<-.20 and r3>0 and p>.55 and e>.24:return 1
  if trend<-1.0 and pull>.20 and r3<0 and p<.45 and e>.24:return -1
 if cid=='btc_compression_expansion':
  comp=v24/max(v96,1e-9);prev=vol(c,i-24,24)/max(vol(c,i-24,96),1e-9) if i>=120 else 1
  if prev<.70 and comp>.90 and z(c,i,6)>.75 and e>.22 and bread>=.50:return 1
  if prev<.70 and comp>.90 and z(c,i,6)<-.75 and e>.22 and bread<=.50:return -1
 if cid=='eth_residual_trend_state':
  bi=idx['BTC'].get(ts)
  if bi is None:return 0
  btc=candles['BTC'];rel24=r24-(ret(btc,bi,24) or 0);rel72=r72-(ret(btc,bi,72) or 0)
  if rel72>.8 and rel24>.25 and r6>0 and e>.25 and p>.5:return 1
  if rel72<-.8 and rel24<-.25 and r6<0 and e>.25 and p<.5:return -1
 if cid=='bnb_breakout_reentry':
  prev=rp(c,i-24,120)
  if prev<.75 and p>.88 and z(c,i,12)>.65 and e>.25 and bread>=.45:return 1
  if prev>.25 and p<.12 and z(c,i,12)<-.65 and e>.25 and bread<=.55:return -1
  if p>.65 and r24>0 and r6<0 and r3>0 and e>.22:return 1
  if p<.35 and r24<0 and r6>0 and r3<0 and e>.22:return -1
 if cid=='avax_breadth_leadership':
  med=v109.b.median_move(candles,idx,ts,24);rel=r24-med
  if rel>.9 and z(c,i,6)>.45 and bread>=.50 and e>.24 and p>.55:return 1
  if rel<-.9 and z(c,i,6)<-.45 and bread<=.50 and e>.24 and p<.45:return -1
 return 0
def trades(cid,candles,idx,start,end,cost,delay):
 s,risk,trail,maxhold=CANDS[cid];c=candles[s];state=0;entry=peak=trough=None;ets=None;vals=[];cool=-1
 for row in c:
  ts=int(row['ts'])
  if not(start<=ts<end):continue
  i=idx[s].get(ts)
  if i is None or i<900:continue
  px=float(c[i]['close']);q=sig(cid,candles,idx,ts)
  if state:
   peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//HOUR;adv=(px/peak-1)*100 if state>0 else (trough/px-1)*100
   if q==-state or adv<=-trail or held>=maxhold:
    xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);vals.append((state*(xp/entry-1)*100-cost/100)*risk);state=0;cool=ts+8*HOUR
  if state==0 and ts>=cool and q:
   ei=i+1+delay
   if ei<len(c):state=q;entry=float(c[ei]['open']);peak=entry;trough=entry;ets=ts
 return vals
def ev(cid,candles,idx,p,cost,delay):return metric(trades(cid,candles,idx,*p,cost,delay))
def stability(cid,candles,idx,p):
 a,b=p;step=(b-a)//3;fs=[ev(cid,candles,idx,(a+k*step,b if k==2 else a+(k+1)*step),NORMAL_BPS,0) for k in range(3)];return {'folds':fs,'positivePfFolds':sum((x.get('returnPct') or 0)>0 and (x.get('pf') or 0)>1 for x in fs)}
def run(cid):
 s=CANDS[cid][0];candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);dm=ev(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=ev(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=ev(cid,candles,idx,ps['validation'],STRESS_BPS,1);st=stability(cid,candles,idx,ps['development']);res={'strategyId':'V111_'+cid.upper(),'pair':s,'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'developmentStability':st,'productionChanged':False,'realTradingEnabled':False}
 if not((dm.get('pf') or 0)>=1.05 and (dm.get('returnPct') or 0)>0 and st['positivePfFolds']>=2 and (vm.get('pf') or 0)>=1.05 and (vm.get('returnPct') or 0)>0 and (vs.get('pf') or 0)>1):res.update(status='FAIL',reason='DEV_VALIDATION')
 else:
  cm=ev(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=ev(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);res.update(confirmation=cm,confirmationStress=cs)
  if not((cm.get('pf') or 0)>=1.2 and (cm.get('returnPct') or 0)>0 and (cm.get('maxDDPct') or -999)>-20 and (cs.get('pf') or 0)>1):res.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=ev(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=ev(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ym=ev(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0);ys=ev(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1);ok=(hm.get('pf') or 0)>1 and (hm.get('returnPct') or 0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and (ym.get('maxDDPct') or -999)>-20 and (ys.get('pf') or 0)>1;res.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);txt=json.dumps(res,indent=2);stem='active4-v111-'+cid;(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
