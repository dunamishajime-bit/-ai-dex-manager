#!/usr/bin/env python3
"""Causal exit ablation of frozen multi-regime RENDER entry confidence.
Trade admissions are re-run with the new exit timestamp and 12h cooldown.
Train+calibrate using older data only; newer retrospective year is not pristine OOS.
Research only. Stops on same M5 as targets execute first.
"""
from pathlib import Path
import json,importlib.util,numpy as np
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1]
D=REPO/'docs/research/results/render-multiregime-20261024'
D.mkdir(parents=True,exist_ok=True)
def load(n,p):
 sp=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
m=load('render_frozen_multiregime',HERE/'render-multiregime-ensemble-screen-20261024.py')
CASES={
 'original_dynamic_policy':None,
 'tight_equal_1p5_1p5_6h':(1.5,1.5,6,False,False),
 'tight_1p2_1p6_6h':(1.2,1.6,6,False,False),
 'tight_1p5_2p0_8h':(1.5,2.0,8,False,False),
 'tight_1p75_1p75_8h':(1.75,1.75,8,False,False),
 'tactical_1p5_2p5_8h':(1.5,2.5,8,True,False),
 'staged_profit_1p75_2p5_12h':(1.75,2.5,12,True,False),
 'timefail_profit_1p75_2p5_12h':(1.75,2.5,12,True,True),
 'timefail_profit_1p5_2p0_8h':(1.5,2.0,8,True,True),
}
def replay(bars,i,case,entryt):
 if case is None:raise ValueError('requires original')
 tp,sl,h,profit,early=case
 j=i+1
 entry=float(bars[j][1]);stop=entry*(1+sl/100);take=entry*(1-tp/100)
 mfe=0;early_signal=False;reason='TIME'
 exit_i=min(j+h*12,len(bars)-1)
 px=float(bars[exit_i][1]);ext=int(bars[exit_i][0])
 for k in range(j,exit_i):
  op=float(bars[k][1]);hi=float(bars[k][2]);lo=float(bars[k][3]);close=float(bars[k][4])
  if early_signal:
   px=op;ext=int(bars[k][0]);reason='EARLY_EXIT_NEXT_OPEN';break
  if hi>=stop:
   px=max(op,stop);ext=int(bars[k][0]);reason='STOP';break
  if lo<=take:
   px=take;ext=int(bars[k][0]);reason='TARGET';break
  # Decision for NEXT bar only, based on completed current M5.
  mfe=max(mfe,100*(entry-lo)/entry)
  if profit and mfe>=1.5:stop=min(stop,entry*(1-.75/100))
  elif profit and mfe>=1.0:stop=min(stop,entry*(1-.4/100))
  if early and k>=j+24 and mfe<.5 and 100*(close/entry-1)>=.75:
   early_signal=True
 return {'exitTs':ext,'netPct':100*(entry-px)/entry-.30,'reason':reason}
def run(rows,scores,threshold,bars,policy):
 result=[];next_allowed=-1
 for row,z in zip(rows,scores):
  if row['t']<next_allowed or max(z)<threshold:continue
  r=dict(row)
  if policy is None:
   r['policy']=list(m.POLICIES)[int(np.argmax(z))]
   x=r['exits'][r['policy']]
  else:
   r['policy']='experimental'
   x=replay(bars,row['index'],policy,row['t'])
   r['exits']['experimental']=x
  r['exit30']=x
  result.append(r)
  next_allowed=x['exitTs']+12*m.screen.HOUR
 return result
def summary(rows,cost):
 pnls=[r['exit30']['netPct']+(30-cost)/100 for r in rows]
 gains=sum(x for x in pnls if x>0)
 losses=-sum(x for x in pnls if x<=0)
 return {'n':len(rows),'wins':sum(x>0 for x in pnls),
 'WR':round(100*sum(x>0 for x in pnls)/len(pnls),2) if pnls else None,
 'PF':round(gains/losses,4) if losses else None,
 'netSumPct':round(sum(pnls),3),
 'worstLoss':round(min(pnls),3) if pnls else None,
 'exits':{k:sum(r['exit30'].get('reason','ORIGINAL')==k for r in rows) for k in ('STOP','TARGET','EARLY_EXIT_NEXT_OPEN','TIME','ORIGINAL')}}
def main():
 manifest=json.loads((m.BASE/'IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf-8'))
 ob,ot=m.old_mod.parse_months(manifest,'RENDERUSDT');btc,bt=m.old_mod.parse_months(manifest,'BTCUSDT')
 older=m.prepare(ob,btc,m.OLD_BEGIN,m.CAL_END,'older')
 native=m.imp('risk_replay_native',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 source,_=native.native.m.m.core.task8.legacy.bootstrap()
 nb,nt=source.getdata('RENDERUSDT');bb,btct=source.getdata('BTCUSDT')
 newer=m.prepare(nb,bb,m.NEW_BEGIN,m.NEW_END,'newer')
 X,Y,n=m.make_X(older,newer)
 coef=m.fit(X,older,n)
 threshold=float(np.quantile((X[:n]@coef).max(axis=1),.75))
 report={'status':'RESEARCH_ONLY_NONNATIVE_STANDALONE_EXITS','cutoffFrozenOnOldTrain':threshold,'cases':{}}
 for key,pol in CASES.items():
  a=run(older[n:],X[n:]@coef,threshold,ob,pol)
  b=run(newer,Y@coef,threshold,nb,pol)
  early=[r for r in b if r['t']<m.NEW_SPLIT];late=[r for r in b if r['t']>=m.NEW_SPLIT]
  values={'oldCal10':summary(a,10),'oldCal30':summary(a,30),
   'new10':summary(b,10),'new30':summary(b,30),
   'newEarly30':summary(early,30),'newLate30':summary(late,30)}
  report['cases'][key]=values
  print('EXITCASE',key,'olderCal30',values['oldCal30']['n'],values['oldCal30']['PF'],
   'NEW30',values['new30']['n'],values['new30']['WR'],values['new30']['PF'],
   'NEW30HALVES',values['newEarly30']['PF'],values['newLate30']['PF'],flush=True)
 (D/'RENDER_MULTIREGIME_CAUSAL_EXIT_ABLATION_20261024.json').write_text(
  json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print('SAVED EXIT ABLATION')
if __name__=='__main__':main()
