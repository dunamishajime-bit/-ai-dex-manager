"""Research V12 positive expectancy. Frozen H1 proxy, chronological selection, no LIVE."""
from pathlib import Path
import json,sys,math,inspect,collections,gzip,hashlib
import run_wr60_new_model as w
ROOT=w.ROOT
OUT=ROOT/'docs/research/results/v12-positive-new-model-20261008'
H=w.H
MID=1754784000000+182*24*H
RAW={}
ACTIVE={}
GATES={'ALL':{},'REL6_0':{'rel':0},'REL6_05':{'rel':.005},'REL6_1':{'rel':.01},'ER6_04':{'er':.4},'REL_ER':{'rel':0,'er':.4},'BTC_ALIGN':{'btc':0},'REL_BTC':{'rel':0,'btc':0},'REL12_05':{'rel12':.005},'ATR1':{'atr':.01},'ATR15':{'atr':.015},'REL_ATR1':{'rel':0,'atr':.01},'SHORT_REL':{'short':1,'rel':0},'LONG_REL':{'long':1,'rel':0}}
EXITS={'BASE':{},'TP05_S075':{'tp':.5,'stop':.75,'arm':1,'trail':1},'TP1_S075':{'tp':1,'stop':.75,'arm':1,'trail':1},'TP15_S1':{'tp':1.5,'stop':1,'arm':1,'trail':1},'TP2_S1':{'tp':2,'stop':1,'arm':2,'trail':1},'ARM1_T05':{'stop':1,'arm':1,'trail':.5},'ARM2_T1':{'stop':1.5,'arm':2,'trail':1}}
def features(c):
 t=c['entry_ts_ms'];sg=1 if c['side']=='LONG' else -1
 def ret(sym,n):
  a=w.closed_price(sym,t);b=w.closed_price(sym,t-n*H)
  return None if a is None or b is None else a/b-1
 r6=ret(c['symbol'],6);b6=ret('BTCUSDT',6);r12=ret(c['symbol'],12);b12=ret('BTCUSDT',12)
 ps=[w.closed_price(c['symbol'],t-i*H) for i in range(7)]
 er=None if None in ps else abs(ps[0]-ps[-1])/max(sum(abs(a-b) for a,b in zip(ps,ps[1:])),1e-20)
 return {'atr':c['atr']/c['entry_price'],'short':1 if sg==-1 else 0,'long':1 if sg==1 else 0,'rel':None if r6 is None or b6 is None else sg*(r6-b6),'rel12':None if r12 is None or b12 is None else sg*(r12-b12),'er':er,'btc':None if b6 is None else sg*b6}
def transform(c,p):
 if any(features(c)[k] is None or features(c)[k]<v for k,v in p.get('gate',{}).items()):return None
 lag=p.get('lag',0);signal=c['entry_ts_ms'];sg=1 if c['side']=='LONG' else -1
 if lag in [4,6]:
  # Wait for an adverse close >=0.25 ATR, then a directional close-to-close recovery.
  touched=False;found=None;previous=c['entry_price']
  for j in range(lag):
   b=w.bars[c['symbol']].get(signal+j*H)
   if b is None:return None
   if sg*(b['close']-c['entry_price'])<=-.25*c['atr']:touched=True
   if touched and sg*(b['close']-previous)>=.1*c['atr']:found=j+1;break
   previous=b['close']
  if found is None:return None
  lag=found;n=w.bars[c['symbol']].get(signal+lag*H)
  if n is None:return None
  c=dict(c,entry_ts_ms=signal+lag*H,entry_price=n['open'],signal_ts_ms=signal)
 elif lag:
  b=w.bars[c['symbol']].get(signal+(lag-1)*H);n=w.bars[c['symbol']].get(signal+lag*H)
  if b is None or n is None or sg*(b['close']-c['entry_price'])<.1*c['atr']:return None
  c=dict(c,entry_ts_ms=signal+lag*H,entry_price=n['open'],signal_ts_ms=signal)
 return sim(c,w.bars[c['symbol']],p.get('exit',{}))
def metrics(a,cost):
 r=[c['unit_gross_return']-cost/10000 for c in a];pos=sum(max(x,0) for x in r);neg=-sum(min(x,0) for x in r)
 return {'n':len(r),'wr':sum(x>0 for x in r)/len(r) if r else None,'pf':pos/neg if neg else None,'mean':sum(r)/len(r) if r else None,'sum':sum(r),'sum_without_best':sum(r)-max(r,default=0)}
def initialize():
 global sim,RAW
 w.OUT=OUT;OUT.mkdir(parents=True,exist_ok=True);w.load_bars()
 src=inspect.getsource(w.simulate_v12).replace('def simulate_v12(','def sim(').replace("prev=series.get(t-H,b)","prev=series.get(t-H,b) if t-H>=c['entry_ts_ms'] else b")
 ns={'H':H};exec(src,ns);sim=ns['sim']
 a=w.frozen_read('V12');RAW={(c['symbol'],c['side'],c['entry_ts_ms']):c for c in a}
 for c in a:
  x=sim(c,w.bars[c['symbol']],{})
  assert (x['exit_ts_ms'],x['exit_price'],x['reason'])==(c['exit_ts_ms'],c['exit_price'],c['reason'])
 (OUT/'exit-adapter-parity.json').write_text(json.dumps({'count':len(a),'status':'PASS'}))
def screen():
 initialize();a=list(RAW.values());rows=[]
 # Selection sees only trades wholly within first 182 days. Funding evaluated in final ledger replay.
 for gn,g in GATES.items():
  for en,e in EXITS.items():
   for lag in [0,1,2,4,6]:
    p={'gate':g,'exit':e,'lag':lag};tr=[]
    for c in a:
     if c['entry_ts_ms']>=MID:continue
     x=transform(c,p)
     if x and x['exit_ts_ms']<MID:tr.append(x)
    m=metrics(tr,30);rows.append({'name':gn+'_'+en+'_L'+str(lag),'parameters':p,'train30':m})
 rows.sort(key=lambda x:(x['train30']['mean'] or -999),reverse=True)
 eligible=[x for x in rows if x['train30']['n']>=80 and (x['train30']['pf'] or 0)>=1.1 and x['train30']['sum_without_best']>0]
 selected=[];groups=set()
 for x in eligible:
  group=(json.dumps(x['parameters']['gate'],sort_keys=True),x['parameters']['lag'])
  if group in groups:continue
  selected.append(x);groups.add(group)
  if len(selected)==4:break
 protocol={'selection':'first 182 days only; n>=80, price-only PF30>=1.10, net positive after removing best trade; ranked mean return; distinct gate/lag','candidates_tested':len(rows),'selected':selected,'split_ms':MID,'limits':['Historical period already explored, not untouched holdout','Screen excludes funding and occupancy; full replay includes them','No historical tick/L2; H1 quote proxy','Selection does not guarantee profitability']}
 (OUT/'selection-lock.json').write_text(json.dumps(protocol,indent=2))
 (OUT/'training-screen.json').write_text(json.dumps(rows,indent=2))
 # Only now read second-half outcome for the locked selection.
 val=[]
 for x in selected:
  tr=[z for c in a if c['entry_ts_ms']>=MID if (z:=transform(c,x['parameters'])) is not None]
  val.append({'name':x['name'],'test':{str(k):metrics(tr,k) for k in [10,20,30]}})
 (OUT/'locked-validation.json').write_text(json.dumps(val,indent=2))
 print(json.dumps({'eligible':len(eligible),'selected':selected,'validation':val},indent=2),flush=True)
def filt(candidates,name):
 p=ACTIVE;keep=[];counts=collections.Counter()
 for c in candidates:
  if c['strategy_id']!='V12':keep.append(c);continue
  key=(c['symbol'],c['side'],c['entry_ts_ms']);x=transform(RAW[key],p)
  if x is None:counts['CAUSAL_GATE_OR_CONFIRMATION']+=1;continue
  d=dict(c)
  for k in ['entry_ts_ms','entry_price','exit_ts_ms','exit_price']:d[k]=x[k]
  d.update(exit_reason=x['reason'],unit_price_return=x['unit_gross_return'])
  if 'signal_ts_ms' in x:d['signal_ts_ms']=x['signal_ts_ms']
  keep.append(d)
 (OUT/'candidate-filter-counts').mkdir(exist_ok=True)
 (OUT/'candidate-filter-counts'/f'{name}.json').write_text(json.dumps(dict(counts)))
 return keep
def run():
 global ACTIVE
 initialize();lock=json.loads((OUT/'selection-lock.json').read_text())
 cases={'BASELINE_Q_RET14':{'gate':{},'exit':{},'lag':0},'PRIOR_WR60':{'gate':{'rel':0},'exit':EXITS['TP05_S075'],'lag':0,'gross':.5}}
 cases.update({x['name']:x['parameters'] for x in lock['selected']})
 if not lock['selected']:
  # Explicit diagnostic only: does NOT lower the predeclared pass threshold.
  train=json.loads((OUT/'training-screen.json').read_text());groups=set();diag=[]
  for x in train:
   if x['train30']['n']<80:continue
   group=(json.dumps(x['parameters']['gate'],sort_keys=True),x['parameters']['lag'])
   if group in groups:continue
   groups.add(group);diag.append(x);cases['DIAGNOSTIC_'+x['name']]=x['parameters']
   if len(diag)==2:break
  (OUT/'diagnostic-lock.json').write_text(json.dumps({'status':'FAILED_SELECTION_THRESHOLD; diagnostic only, not accepted','chosen_training_only':diag},indent=2))
 w.setup();w.base.read_table=w.frozen_read;w.base._study_filter=filt
 # Gross reduction is a prior control only, never counted as a positive edge.
 original=filt
 def filter_gross(cs,name):
  out=original(cs,name)
  if ACTIVE.get('gross'):out=[dict(c,requested_gross=c['requested_gross']*ACTIVE['gross']) if c['strategy_id']=='V12' else c for c in out]
  return out
 w.base._study_filter=filter_gross
 (OUT/'case-parameters.json').write_text(json.dumps(cases,indent=2))
 for name,p in cases.items():
  ACTIVE=p;print('V12_CASE_START',name,flush=True)
  result=w.base.run_study(name,'10,20,30');result['study_parameters']=p;result['research_only']=True
  for sc in result['scenarios']:
   ts=w.base.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
   v=[t for t in ts if t['strategy_id']=='V12']
   sc['strategy_stats_usd']={sid:w.stats([t for t in ts if t['strategy_id']==sid]) for sid in sorted({t['strategy_id'] for t in ts})}
   def full(a):
    m=w.stats(a);r=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a]
    m.update(unit_mean=sum(r)/len(r) if r else None,unit_pf=sum(max(x,0) for x in r)/-sum(min(x,0) for x in r) if any(x<0 for x in r) else None,net_without_best=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0));return m
   sc['v12_details']={'all':full(v),'first':full([t for t in v if t['exit_ts_ms']<MID]),'second':full([t for t in v if t['entry_ts_ms']>=MID])}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(result,indent=2))
  summaries=[json.loads(p.read_text()) for p in sorted((OUT/'cases').glob('*/result.json'))]
  (OUT/'comparison-summary.json').write_text(json.dumps(summaries,indent=2))
  print('V12_CASE_DONE',name,json.dumps([{k:sc[k] for k in ['scenario_id','final_equity_jpy','win_rate','maximum_mtm_drawdown','v12_details']} for sc in result['scenarios']]),flush=True)
if __name__=='__main__':
 {'screen':screen,'run':run}[sys.argv[1]]()
