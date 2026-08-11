from __future__ import annotations
import argparse,json,math,os,statistics
from pathlib import Path
import research_active4_v115 as q
HOUR=q.HOUR; NORMAL_BPS=q.NORMAL_BPS; STRESS_BPS=q.STRESS_BPS; p=q.p; ret=q.ret; metric=q.metric
CANDS={'btc_wave_event48':('BTC',.60,6.2,600,48),'btc_wave_event72':('BTC',.58,6.0,600,72),'eth_wave_event48':('ETH',.56,6.5,504,48),'bnb_wave_event48':('BNB',.50,6.0,408,48),'avax_wave_event36':('AVAX',.44,7.8,360,36)}
q.CANDS.update(CANDS)
MODELS={}
def mean(x):return statistics.fmean(x) if x else 0.0
def sd(x):return statistics.pstdev(x) if len(x)>1 else 1.0
def feats(cid,candles,idx,ts):
 s=CANDS[cid][0];c=candles[s];i=idx[s].get(ts)
 if i is None or i<900:return None
 rs=[ret(c,i,n) or 0 for n in (3,6,12,24,48,72,168)];v=p.vol(c,i,168)
 if v<=1e-9:return None
 xs=[rs[k]/(v*math.sqrt(n)+1e-9) for k,n in enumerate((3,6,12,24,48,72,168))]
 xs += [p.eff(c,i,24),p.eff(c,i,72),p.rp(c,i,72)-.5,p.rp(c,i,168)-.5,p.vol(c,i,24)/v-1,p.vol(c,i,48)/v-1,p.slope(c,i,48)/(v+1e-9),p.slope(c,i,168)/(v+1e-9)]
 if s!='BTC':
  bi=idx['BTC'].get(ts)
  if bi is None:return None
  xs += [((ret(c,i,n) or 0)-(ret(candles['BTC'],bi,n) or 0))/(v*math.sqrt(n)+1e-9) for n in (6,24,72,168)]
 return xs
def label(cid,candles,idx,ts):
 s=CANDS[cid][0];h=CANDS[cid][4];c=candles[s];i=idx[s].get(ts)
 if i is None or i+h>=len(c):return None
 v=p.vol(c,i,168)
 if v<=1e-9:return None
 p0=float(c[i]['close']);fut=c[i+1:i+h+1];up=100*(max(float(r['high']) for r in fut)/p0-1);dn=100*(p0/min(float(r['low']) for r in fut)-1);th=max(2.5,1.65*v*math.sqrt(h))
 if max(up,dn)<th:return 0.0
 return 1.0 if up>=dn else -1.0
def solve(a,y,lam=4.0):
 n=len(a[0]);M=[[0.0]*(n+1) for _ in range(n)]
 for i in range(n):
  for j in range(n):M[i][j]=sum(r[i]*r[j] for r in a)+(lam if i==j else 0)
  M[i][n]=sum(r[i]*v for r,v in zip(a,y))
 for col in range(n):
  piv=max(range(col,n),key=lambda r:abs(M[r][col]));M[col],M[piv]=M[piv],M[col];d=M[col][col]
  if abs(d)<1e-10:continue
  M[col]=[x/d for x in M[col]]
  for r in range(n):
   if r==col:continue
   z=M[r][col]
   if abs(z)>1e-12:M[r]=[x-z*t for x,t in zip(M[r],M[col])]
 return [M[i][n] for i in range(n)]
def train(cid,candles,idx,per):
 a,b=per;X=[];Y=[]
 for row in candles[CANDS[cid][0]][::4]:
  ts=int(row['ts'])
  if not(a<=ts<b-CANDS[cid][4]*HOUR):continue
  f=feats(cid,candles,idx,ts);y=label(cid,candles,idx,ts)
  if f is not None and y is not None:X.append(f);Y.append(y)
 mu=[mean([r[j] for r in X]) for j in range(len(X[0]))];ss=[max(sd([r[j] for r in X]),1e-6) for j in range(len(mu))];Z=[[1]+[(r[j]-mu[j])/ss[j] for j in range(len(mu))] for r in X]
 return {'mu':mu,'sd':ss,'w':solve(Z,Y),'threshold':.28}
def pred(cid,candles,idx,ts):
 f=feats(cid,candles,idx,ts);m=MODELS[cid]
 if f is None:return 0.0
 return sum(a*b for a,b in zip(m['w'],[1]+[(f[j]-m['mu'][j])/m['sd'][j] for j in range(len(f))]))
def state(cid,candles,idx,ts):
 x=q.feat(cid,candles,idx,ts);z={'bias':0,'prewave':0,'onset':0,'continue':0,'reentry':0,'reverse':0,'exhaust':0,'strength':0.0}
 if not x:return z
 pr=pred(cid,candles,idx,ts);th=MODELS[cid]['threshold'];r=x['r'];d=1 if pr>=th else -1 if pr<=-th else 0
 slow=(1 if r[168]>0 else -1)+(1 if x['sl168']>0 else -1)+(1 if x['rp336']>.5 else -1);z['bias']=1 if slow>=1 else -1 if slow<=-1 else 0
 if x['v'][48]<.9*x['v'][168] and x['e72']<.28:z['prewave']=z['bias'] or 1
 if d and (z['bias'] in (0,d) or abs(pr)>=1.35*th) and x['e24']>.08:z['onset']=d
 weak=1 if pr>.10 else -1 if pr<-.10 else 0
 if weak==1 and r[48]>0 and x['sl48']>0:z['continue']=1
 elif weak==-1 and r[48]<0 and x['sl48']<0:z['continue']=-1
 if z['continue']==1 and r[12]<0 and r[3]>0 and pr>0:z['reentry']=1
 elif z['continue']==-1 and r[12]>0 and r[3]<0 and pr<0:z['reentry']=-1
 if pr<-.18 and r[48]<0 and x['sl48']<0:z['reverse']=-1
 elif pr>.18 and r[48]>0 and x['sl48']>0:z['reverse']=1
 z['strength']=abs(pr)/th+.3*x['e72']
 if x['shock']>2.0 and x['e24']<.08:z['exhaust']=1 if r[24]>0 else -1
 return z
q.state=state
def run(cid):
 candles,idx,_=q.b.p.v109.b.base.load();ps=q.b.p.v109.b.base.periods(candles);MODELS[cid]=train(cid,candles,idx,ps['development'])
 dm=q.evalm(cid,candles,idx,ps['development'],NORMAL_BPS,0);vm=q.evalm(cid,candles,idx,ps['validation'],NORMAL_BPS,0);vs=q.evalm(cid,candles,idx,ps['validation'],STRESS_BPS,1);dw=q.wave_diag(cid,candles,idx,ps['development']);vw=q.wave_diag(cid,candles,idx,ps['validation']);vf=q.folds(cid,candles,idx,ps['validation'])
 result={'strategyId':'V118_'+cid.upper(),'pair':CANDS[cid][0],'periods':ps,'development':dm,'validation':vm,'validationStress':vs,'waveDiagnostics':{'development':dw,'validation':vw},'validationFolds':vf,'productionChanged':False,'realTradingEnabled':False}
 promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and vm.get('maxDDPct',-999)>-20 and vw['captureRatePct']>=20 and vf['positivePfFolds']>=2
 if not promote:result.update(status='FAIL',reason='DEV_VALIDATION_WAVE')
 else:
  cm=q.evalm(cid,candles,idx,ps['confirmation'],NORMAL_BPS,0);cs=q.evalm(cid,candles,idx,ps['confirmation'],STRESS_BPS,1);result.update(confirmation=cm,confirmationStress=cs)
  if (cm.get('pf') or 0)<1.2 or cm.get('returnPct',0)<=0 or (cs.get('pf') or 0)<=1:result.update(status='FAIL',reason='CONFIRMATION')
  else:
   hm=q.evalm(cid,candles,idx,ps['holdout'],NORMAL_BPS,0);hs=q.evalm(cid,candles,idx,ps['holdout'],STRESS_BPS,1);ym=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),NORMAL_BPS,0);ys=q.evalm(cid,candles,idx,(ps['development'][0],ps['holdout'][1]),STRESS_BPS,1);ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1 and (ym.get('pf') or 0)>=1.2 and ym.get('returnPct',0)>0 and (ys.get('pf') or 0)>1;result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'FINAL')
 out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);stem='active4-v118-'+cid;txt=json.dumps(result,indent=2);(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+result['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True);run(ap.parse_args().candidate)
