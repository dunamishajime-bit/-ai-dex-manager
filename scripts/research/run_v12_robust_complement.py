"""Research-only V12 robust complement confirmation.
Core = FAILED_BREAK_REV_SHORT_6H.
Complement = SHORT_MID restricted to momentum condition age 24-48h.
Test uniform complement gross caps 0.25/0.50/0.75/1.00.
No LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as sens
import run_v12_logic_dissection as s
import v12_entry_state_logic as m
import run_v12_multiroute_rescue as mr
ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-robust-complement-20261008';MID=s.MID
DIAG=mr.DIAG;KEY=mr.key
ROBUST={KEY(x) for x in DIAG if x['side']=='SHORT' and 24<=x['momentum_condition_age_h']<48 and .005<=x['signed_ret6']<.015 and x['distance_ema12_atr']>=1}
CASES=[('CORE55',None)]+[(f'AGE24_48_CAP{int(c*100):03d}',c) for c in [.25,.50,.75,1.00]]
MAP=dict(CASES)
FAILED_SELECTED=sens.select(sens.events['WINDOW_6H']);FAILED=None
def read_table(strategy,variant='BASELINE'):return s.w.frozen_read(strategy,variant)
def failed_candidates():
 out=[]
 for c in FAILED_SELECTED:
  x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
  if not x:continue
  d=s.w.base.candidate(x,'V12');d.update(route='FAILED_BREAK_REV_SHORT_6H',entryQualityClass='ONSET_FAILED_BREAK_SHORT_6H',setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],state_age_h=c['state_age_h']);out.append(d)
 return out
def filt(candidates,name):
 cap=MAP[name];out=[];seen=set()
 for c in candidates:
  if c['strategy_id']!='V12':out.append(c);continue
  if cap is None:continue
  k=KEY(c)
  if k not in ROBUST:continue
  d=dict(c);d['route']='CONT_SHORT_MID_AGE24_48';d['entryQualityClass']='ROBUST_COMPLEMENT';d['requested_gross']=min(float(d.get('requested_gross',cap)),cap)
  tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
  if tok not in seen:seen.add(tok);out.append(d)
 for d0 in FAILED:
  d=dict(d0);tok=('V12',d['symbol'],d['side'],int(d['entry_ts_ms']))
  if tok not in seen:seen.add(tok);out.append(d)
 return out
def detail(a):
 d=s.w.stats(a);vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a if t.get('original_quantity') and t.get('entry_price')];d['unit_returns']=s.stat(vals);return d
def main():
 global FAILED
 OUT.mkdir(parents=True,exist_ok=True);(OUT/'protocol.json').write_text(json.dumps({'research_only':True,'live_changes':False,'production_changes':False,'core':'FAILED_BREAK_REV_SHORT_6H','complement':'SHORT_MID age 24-48h, signed6h 0.5-1.5%, EMA distance >=1 ATR','raw_complement_keys':len(ROBUST),'caps':[.25,.5,.75,1.0],'costs_bps':[10,20,30],'selection_reason':'Only SHORT_MID age bucket observed positive PF in both temporal halves at 30bps actual accepted-trade decomposition.','warning':'Studied period; not independent holdout.'},indent=2),encoding='utf-8')
 s.w.OUT=OUT;s.w.setup();FAILED=failed_candidates();s.w.base.read_table=read_table;s.w.base._study_filter=filt
 res=[]
 for name,cap in CASES:
  print('START',name,flush=True);r=s.w.base.run_study(name,'10,20,30');r['research_only']=True;r['cap']=cap
  for sc in r['scenarios']:
   ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[x for x in ts if x['strategy_id']=='V12'];sc['v12_details']={'all':detail(v),'first':detail([x for x in v if x['exit_ts_ms']<MID]),'second':detail([x for x in v if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in v if x.get('route')==rt]) for rt in sorted({x.get('route') for x in v if x.get('route')})}}
  (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');res.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(res,indent=2),encoding='utf-8');print('DONE',name,flush=True)
if __name__=='__main__':main()
