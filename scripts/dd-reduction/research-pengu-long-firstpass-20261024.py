#!/usr/bin/env python3
"""First-pass selected PENGU LONG/Recovery adverse & profit-giveback study.
Research-only; 8-strategy economic native BT REQUIRED before adoption.
Baseline includes already user-adopted PENGU SHORT 3h -2.5%/8h -4%, with AVAX6.
"""
from __future__ import annotations
import bisect,hashlib,importlib.util,json,collections,math
from pathlib import Path
BASE=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
REPO=Path(__file__).resolve().parents[2]
M5=300000
H=3600000
HERE=REPO/"scripts/dd-reduction"
CASES={
"PEAK2_FLOOR_MINUS5":dict(mode="MFE_FLOOR",mfe=2.,floor=-5.),
"PEAK2_FLOOR_MINUS4":dict(mode="MFE_FLOOR",mfe=2.,floor=-4.),
"PEAK3_FLOOR_MINUS3":dict(mode="MFE_FLOOR",mfe=3.,floor=-3.),
"PEAK3_FLOOR_MINUS3P5":dict(mode="MFE_FLOOR",mfe=3.,floor=-3.5),
"PEAK2_FLOOR_MINUS3":dict(mode="MFE_FLOOR",mfe=2.,floor=-3.),
"PEAK3_FLOOR_MINUS1":dict(mode="MFE_FLOOR",mfe=3.,floor=-1.),
"PEAK3_FLOOR0":dict(mode="MFE_FLOOR",mfe=3.,floor=0.),
"PEAK3_FLOOR1":dict(mode="MFE_FLOOR",mfe=3.,floor=1.),
"PEAK4_FLOOR_MINUS2":dict(mode="MFE_FLOOR",mfe=4.,floor=-2.),
"PEAK4_FLOOR0":dict(mode="MFE_FLOOR",mfe=4.,floor=0.),
"PEAK4_FLOOR1":dict(mode="MFE_FLOOR",mfe=4.,floor=1.),
"PEAK2_TRAIL2":dict(mode="MFE_GIVEBACK",mfe=2.,giveback=2.),
"PEAK3_TRAIL3":dict(mode="MFE_GIVEBACK",mfe=3.,giveback=3.),
"PEAK4_TRAIL4":dict(mode="MFE_GIVEBACK",mfe=4.,giveback=4.),
"FIRST2_NEG3_MFE05":dict(mode="EARLY_LOSS",hours=2,loss=3.,mfeMax=.5),
"FIRST3_NEG3_MFE05":dict(mode="EARLY_LOSS",hours=3,loss=3.,mfeMax=.5),
"FIRST4_NEG3_MFE05":dict(mode="EARLY_LOSS",hours=4,loss=3.,mfeMax=.5),
"FIRST6_NEG4_MFE1":dict(mode="EARLY_LOSS",hours=6,loss=4.,mfeMax=1.),
"FIRST8_NEG4_MFE1":dict(mode="EARLY_LOSS",hours=8,loss=4.,mfeMax=1.),
"H1X2_NEG3_MFE05":dict(mode="H1X2_LOSS",loss=3.,mfeMax=.5),
}
def load(name,p):
 sp=importlib.util.spec_from_file_location(name,p)
 module=importlib.util.module_from_spec(sp);sp.loader.exec_module(module);return module
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for a in iter(lambda:f.read(1024*1024),b''):h.update(a)
 return h.hexdigest()
def find_ledger(expected):
 for sub in ("rv23penguTimeNativeCombo","rv23penguTimeNativeScope","rv23penguTimeNativeFull"):
  for f in (BASE/sub/"engine").rglob("portfolio-trades.jsonl"):
   if digest(f)==expected:return f
 raise RuntimeError(("NO_MATCH_LEDGER",expected))
def make_path(row,bars,times):
 t0=int(row['entry_ts_ms']);end=int(row['exit_ts_ms'])
 st=bisect.bisect_left(times,t0)
 assert times[st]==t0,("PENGU_M5_ENTRY_MISSING",t0)
 entry=float(row['entry_price']);scale=entry/float(bars[st][1])
 gap=abs((scale-1)*100)
 if gap>5:raise RuntimeError(("ENTRY_PRICE_M5_TOO_DIFFERENT",t0,gap))
 out=[];peak=0.
 for i in range(st,len(times)-1):
  ts=int(times[i]);complete=ts+M5
  if complete>=end:break
  if int(times[i+1])!=complete:raise RuntimeError(("M5_TIME_GAP",ts))
  c=bars[i];h=float(c[2])*scale;l=float(c[3])*scale;close=float(c[4])*scale
  if not all(math.isfinite(q) and q>0 for q in (h,l,close)):raise RuntimeError(("INVALID_M5",ts))
  ret=100*(close/entry-1)
  high_ret=100*(h/entry-1)
  old_peak=peak;peak=max(peak,high_ret)
  nxt=float(bars[i+1][1])*scale
  out.append(dict(ts=complete,price=nxt,closeRet=ret,highRet=high_ret,mfeBefore=old_peak,mfeAfter=peak,fillRet=100*(nxt/entry-1)))
 return out,gap
def early_exit(path,settings,t0):
 mode=settings['mode']
 for k,p in enumerate(path):
  if mode=="MFE_FLOOR":
   if p['mfeBefore']>=settings['mfe'] and p['closeRet']<=settings['floor']:
    return p
  elif mode=="MFE_GIVEBACK":
   if p['mfeBefore']>=settings['mfe'] and p['closeRet']<=p['mfeBefore']-settings['giveback']:
    return p
  elif mode=="EARLY_LOSS":
   if p['ts']==t0+settings['hours']*H:
    if p['closeRet']<=-settings['loss'] and p['mfeAfter']<settings['mfeMax']:return p
    break
  elif mode=="H1X2_LOSS":
   if p['ts']>=t0+2*H and (p['ts']-t0)%H==0 and p['mfeAfter']<settings['mfeMax']:
    if k>=12 and path[k-12]['closeRet']<=-settings['loss'] and p['closeRet']<=-settings['loss']:
     return p
  else:raise ValueError(mode)
 return None
def main():
 combined=json.loads((REPO/"docs/research/results/pengu-timed-negative-20261023/PENGU_TIMED_NEGATIVE_NATIVE_FULL8_COMBINED_20261023.json").read_text('utf8'))
 source=load("pengu_long_reference",HERE/"research-residual-avax-composite-entry-veto-full8-20261023.py")
 source.native.m.acquire_verified_h1()
 feed,_=source.native.m.m.core.task8.legacy.bootstrap()
 bars,times=feed.getdata("PENGUUSDT")
 out=dict(status="RESEARCH_ONLY_SELECTED_TRADE_FIRSTPASS_NOT_FULL8_NO_LIVE",period="2025-08-10_to_2026-08-10",base="PENGU SHORT 3h -2.5 +8h -4 adopted; AVAX6 adopted",cases=CASES,costs={})
 for cost in ('10','30'):
  prior=combined['cases']['SHORT_AT3_MINUS2P5_OR_AT8_MINUS4']['costs'][cost]
  ledger=find_ledger(prior['ledgerSha256'])
  trades=[json.loads(z) for z in ledger.read_text('utf8').splitlines()]
  pengu=[x for x in trades if x['strategy_id']=='PENGU' and x['side']=='LONG']
  groups=dict(NORMAL=[x for x in pengu if x['entry_version']=='LONG_V2_FINAL'],RECOVERY=[x for x in pengu if x['entry_version']=='RECOVERY_V8'])
  assert len(groups['NORMAL'])==10 and len(groups['RECOVERY'])==37,(len(groups['NORMAL']),len(groups['RECOVERY']))
  data={}
  for grp,rs in groups.items():
   paths={}
   for r in rs: paths[r['entry_ts_ms']]=make_path(r,bars,times)
   cases={}
   for name,policy in CASES.items():
    changed=[]
    for r in rs:
     path,gap=paths[r['entry_ts_ms']]
     v=early_exit(path,policy,r['entry_ts_ms'])
     if v is None:continue
     old_return=(float(r['exit_price'])/float(r['entry_price'])-1)*100
     delta_jpy=float(r['notional_entry_jpy'])*(v['fillRet']-old_return)/100
     changed.append(dict(entryTs=r['entry_ts_ms'],oldExit=r['exit_reason_actual'],oldPnL=round(float(r['modeled_realized_pnl_jpy_at_exit_fx']),2),originalWon=float(r['total_pnl_jpy'])>0,oldReturnPct=old_return,newExitTs=v['ts'],newFillPct=v['fillRet'],closeRetPct=v['closeRet'],peakBeforePct=v['mfeBefore'],modelDeltaJpy=delta_jpy,anchorGapPct=gap))
    cases[name]=dict(stopN=len(changed),oldWinnersCut=sum(x['originalWon'] for x in changed),oldLosersIntercepted=sum(not x['originalWon'] for x in changed),oldHardStopsIntercepted=sum('HARD_STOP' in x['oldExit'] for x in changed),modelDirectDiffJpy=sum(x['modelDeltaJpy'] for x in changed),modelWorsenedCount=sum(x['modelDeltaJpy']<0 for x in changed),hits=changed)
   loss_focus=[]
   for r in rs:
    if float(r['total_pnl_jpy'])<=0:
     path,gap=paths[r['entry_ts_ms']]
     best=max([z['mfeAfter'] for z in path],default=0)
     worst=min([z['closeRet'] for z in path],default=0)
     loss_focus.append(dict(entryTs=r['entry_ts_ms'],reason=r['exit_reason_actual'],modelPnL=round(float(r['modeled_realized_pnl_jpy_at_exit_fx']),2),mfeBeforeExitPct=round(best,4),worstM5CloseBeforeExitPct=round(worst,4),entryGapPct=round(gap,3)))
   data[grp]=dict(n=len(rs),wins=sum(float(x['total_pnl_jpy'])>0 for x in rs),cases=cases,losingTrades=sorted(loss_focus,key=lambda x:x['modelPnL']))
  out['costs'][cost]=data
  print('COST',cost,'PENGU LONG',len(pengu),'NORMAL',data['NORMAL']['n'],'RECOVERY',data['RECOVERY']['n'],flush=True)
  for g in ('NORMAL','RECOVERY'):
   print('GROUP',g,'LOSING_TRADES',data[g]['losingTrades'][:12],flush=True)
   for n,met in sorted(data[g]['cases'].items(),key=lambda z:-z[1]['modelDirectDiffJpy']):
    print('RESULT',g,n,'hits',met['stopN'],'oldWinsCut',met['oldWinnersCut'],'hardSaved',met['oldHardStopsIntercepted'],'deltaJPY',round(met['modelDirectDiffJpy']),'worsened',met['modelWorsenedCount'],flush=True)
 d=REPO/'docs/research/results/pengu-long-20261024'
 d.mkdir(parents=True,exist_ok=True)
 fn=d/'PENGU_LONG_FIRSTPASS_AFTER_SHORT_DUAL_20261024.json'
 fn.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('SAVED',fn,fn.stat().st_size,flush=True)
if __name__=="__main__":main()
