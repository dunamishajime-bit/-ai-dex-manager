#!/usr/bin/env python3
"""PENGU ordinary LONG initial negative/never-positive exits. Selected-slate screen only.
Economic admission requires full8 dynamic wallet BT with SHORT 3h/8h and LONG +2% -> -5%.
"""
from __future__ import annotations
import bisect,collections,hashlib,importlib.util,itertools,json,math
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
HERE=REPO/'scripts/dd-reduction'
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
def load(name,path):
 sp=importlib.util.spec_from_file_location(name,path)
 x=importlib.util.module_from_spec(sp);sp.loader.exec_module(x);return x
first=load('pengu_initial_firstpass',HERE/'research-pengu-long-firstpass-20261024.py')
M5=first.M5;H=first.H
def policies():
 d={}
 for h in (2,3,4,6,8,12,24):
  for loss in (2.5,3.,3.5,4.,4.5,5.,5.5,6.):
   for mfe in (.25,.5,1.0):
    d[f'AT{h}_NEG{loss:g}_MFE{mfe:g}']={'mode':'AT_HOURS','hours':h,'loss':loss,'mfeMax':mfe}
 for loss in (3.,3.5,4.,4.5,5.):
  for delay in (1,2,3,4,6):
   for mfe in (.25,.5,1.):
    d[f'ARM{loss:g}_WATCH{delay}_MFE{mfe:g}']={'mode':'ARM_WATCH','arm':loss,'delay':delay,'mfeMax':mfe,'immediate':None,'maxAfterH':24}
    for immediate in (5.,6.):
     if immediate>loss:
      d[f'ARM{loss:g}_WATCH{delay}_HARD{immediate:g}_MFE{mfe:g}']={'mode':'ARM_WATCH','arm':loss,'delay':delay,'mfeMax':mfe,'immediate':immediate,'maxAfterH':24}
 for loss in (3.,4.,5.,6.):
  for after in (1,2,3,4,6,8,12):
   for mfe in (.25,.5,1.):
    d[f'TOUCH{loss:g}_AFTER{after}_MFE{mfe:g}']={'mode':'FIRST_TOUCH','loss':loss,'minHours':after,'mfeMax':mfe}
 for th in (2.,3.,4.):
  for sustain in (60,120,180,240):
   for mfe in (.25,.5,1.):
    d[f'NEG{th:g}_SUSTAIN{sustain}_MFE{mfe:g}']={'mode':'SUSTAIN','loss':th,'sustainMin':sustain,'mfeMax':mfe}
 for loss in (2.,3.,4.,5.):
  for hours in (2,3,4,6,8,12):
   for mfe in (.25,.5,1.):
    d[f'H1X2_NEG{loss:g}_MIN{hours}_MFE{mfe:g}']={'mode':'H1X2','loss':loss,'hours':hours,'mfeMax':mfe}
 return d
POLICIES=policies()
def find_stop(path,setting,t0):
 mode=setting['mode'];gate=setting['mfeMax']
 touch=None;underN=0
 for i,p in enumerate(path):
  if p['mfeAfter']>=gate:return None
  ts=p['ts'];ret=p['closeRet']
  if mode=='AT_HOURS':
   if ts==t0+setting['hours']*H:
    return p if ret<=-setting['loss'] else None
   if ts>t0+setting['hours']*H:return None
  elif mode=='FIRST_TOUCH':
   if ts>=t0+setting['minHours']*H and ret<=-setting['loss']:return p
  elif mode=='ARM_WATCH':
   if ts>t0+setting['maxAfterH']*H:return None
   if touch is None and ret<=-setting['arm']:touch=ts
   if touch is not None and setting['immediate'] is not None and ret<=-setting['immediate']:
    return p
   if touch is not None and ts>=touch+setting['delay']*H:
    # two-hour window means must remain at or below threshold at check, not uninterrupted.
    if ret<=-setting['arm']:return p
    touch=None
  elif mode=='SUSTAIN':
   if ret<=-setting['loss']:underN+=1
   else:underN=0
   if underN>=setting['sustainMin']//5:return p
  elif mode=='H1X2':
   if ts<t0+max(2,setting['hours'])*H:continue
   if (ts-t0)%H==0 and i>=12:
    if ret<=-setting['loss'] and path[i-12]['closeRet']<=-setting['loss']:return p
  else:raise ValueError(mode)
 return None
def disk_match(reference):
 for dd in ('rv24penguLongNativeV2',):
  for p in (ROOT/dd/'engine').rglob('portfolio-trades.jsonl'):
   h=hashlib.sha256(p.read_bytes()).hexdigest()
   if h==reference:return p
 raise RuntimeError(('MISSING_LEDGER',reference))
def evaluate(paths,rs):
 out={}
 for name,setting in POLICIES.items():
  changed=[]
  for r in rs:
   path,gap=paths[int(r['entry_ts_ms'])]
   z=find_stop(path,setting,int(r['entry_ts_ms']))
   if z is None:continue
   diff=(z['fillRet']-100*(r['exit_price']/r['entry_price']-1))*r['notional_entry_jpy']/100
   changed.append({'entryTs':r['entry_ts_ms'],'previousReason':r['exit_reason_actual'],
    'oldWon':float(r['total_pnl_jpy'])>0,'deltaPreSelectionJpy':diff,
    'm5FillReturnPct':z['fillRet'],'m5CloseRetPct':z['closeRet'],
    'mfeAtExitPct':z['mfeBefore'],'stopTs':z['ts'],'entryAnchoringGapPct':gap})
  out[name]={'stopN':len(changed),'previousWinnersCut':sum(x['oldWon'] for x in changed),
    'oldHardStopsSaved':sum('HARD_STOP' in x['previousReason'] for x in changed),
    'modeledDirectDiffJpy':sum(x['deltaPreSelectionJpy'] for x in changed),
    'lossesAvoided':sum(not x['oldWon'] for x in changed),'hits':changed}
 return out
def main():
 audit=json.loads((REPO/'docs/research/results/pengu-long-20261024/PENGU_LONG_CUMULATIVE_NATIVE_FULL8_AUDIT_20261024.json').read_text('utf8'))
 source=load('pengu_initial_reference',HERE/'research-residual-avax-composite-entry-veto-full8-20261023.py')
 source.native.m.acquire_verified_h1()
 feed,_=source.native.m.m.core.task8.legacy.bootstrap()
 bars,times=feed.getdata('PENGUUSDT')
 output={'status':'SELECTED_SLATE_SENSITIVITY_ONLY_NOT_FULL8','baseline':'SHORT dual adopted + LONG MFE2 floor -5','policies':POLICIES,'costs':{}}
 for cost in ('10','30'):
  sh=audit['cases']['LONG_PEAK2_FLOOR_MINUS5'][cost]['ledgerSha256']
  f=disk_match(sh)
  allr=[json.loads(z) for z in f.read_text('utf8').splitlines()]
  normal=[r for r in allr if r['strategy_id']=='PENGU' and r['entry_version']=='LONG_V2_FINAL']
  recovery=[r for r in allr if r['strategy_id']=='PENGU' and r['entry_version']=='RECOVERY_V8']
  assert len(normal)==10 and len(recovery)==37
  paths={int(r['entry_ts_ms']):first.make_path(r,bars,times) for r in normal}
  result=evaluate(paths,normal)
  srt=sorted(result.items(),key=lambda kv:(kv[1]['previousWinnersCut'],-kv[1]['oldHardStopsSaved'],-kv[1]['modeledDirectDiffJpy']))
  print('COST',cost,'NORMAL',len(normal),'WIN',sum(float(r['total_pnl_jpy'])>0 for r in normal),'POLICIES',len(result),flush=True)
  print('CUT_0_WINS_SAVE_LOSSES',sum(k['previousWinnersCut']==0 and k['oldHardStopsSaved']>0 for k in result.values()),flush=True)
  for name,met in srt:
   if met['previousWinnersCut']==0 and met['oldHardStopsSaved']>0 and met['stopN']<=3:
    print('CAND',name,'hits',met['stopN'],'oldLosers',met['lossesAvoided'],'direct',round(met['modeledDirectDiffJpy'],2),'ts',[x['stopTs'] for x in met['hits']],flush=True)
  output['costs'][cost]={'normalTrades':len(normal),'normalWins':sum(float(r['total_pnl_jpy'])>0 for r in normal),'results':result}
 out=REPO/'docs/research/results/pengu-initial-negative-20261024'
 out.mkdir(parents=True,exist_ok=True)
 file=out/'PENGU_INITIAL_NEGATIVE_SELECTED_TRADE_SCREEN_20261024.json'
 file.write_text(json.dumps(output,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('SAVED',file,file.stat().st_size,flush=True)
if __name__=='__main__':main()
