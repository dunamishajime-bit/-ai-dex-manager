"""Second-pass repaired priority/gross sweep.

Uses second-pass repaired route logic + re-scored V2 quality ranking.
Tests D=0.05 vs D=off and Core native vs Core tier sizing.
Research only.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_v4_route_repair_secondpass as r2
 import run_v12_multilogic_v4_final1000 as final
 import run_v12_multilogic_v4_flip as flip
 import run_v12_multilogic_v4_minlift as mlift
 import run_v12_multilogic_v4_stacking as v4
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml
s=v4.s;ROOT=s.ROOT;OUT=ROOT/'docs/research/results/v12-v4-priority-gross-v2-sweep-20261009';H=3600000
SCORES=json.load(open(ROOT/'docs/research/results/v12-v4-priority-gross-v2-20261009/route-priority-score.json',encoding='utf-8'));SCORE={x['route']:x for x in SCORES};CORE='FAILED_BREAK_REV_SHORT_6H'
CAP={'family':2.5,'v12':3.0,'crypto':3.5,'total':4.75}
CASES={
 'V2_M150_D05_CORE_NATIVE':{'mult':1.5,'d':.05,'core':'native'},
 'V2_M150_D0_CORE_NATIVE':{'mult':1.5,'d':0,'core':'native'},
 'V2_M200_D05_CORE_NATIVE':{'mult':2.0,'d':.05,'core':'native'},
 'V2_M200_D0_CORE_NATIVE':{'mult':2.0,'d':0,'core':'native'},
 'V2_M150_D05_CORE_TIER':{'mult':1.5,'d':.05,'core':'tier'},
}
def patch(source,strict):
 q=flip.flip_patch(source,strict);old='if len(active_same_route) >= 8:';assert q.count(old)==1;q=q.replace(old,'if len(active_same_route) >= 16:',1)
 for oldc,newc in [('V12_CAP = 2.0',f"V12_CAP = {CAP['v12']}"),('CRYPTO_CAP = 3.0',f"CRYPTO_CAP = {CAP['crypto']}"),('TOTAL_CAP = 4.25',f"TOTAL_CAP = {CAP['total']}")]:
  assert oldc in q;q=q.replace(oldc,newc,1)
 return q
def make_filter(name,cfg):
 base=r2.make_filter(True);ordered=list(SCORES);rank={x['route']:i+4 for i,x in enumerate(ordered)}
 def filt(candidates,case):
  out=base(candidates,case);z=[]
  for c in out:
   d=dict(c)
   if d.get('strategy_id')=='V12':
    sc=SCORE.get(d.get('route'))
    if sc:
     d['rank']=rank[d['route']]
     if d['route']==CORE and cfg['core']=='native':
      d['rank']=1
     else:
      if sc['tier']=='D':
       g=cfg['d']
       if g<=0:continue
      else:g=min(1.0,float(sc['gross'])*cfg['mult'])
      d['requested_gross']=g
   z.append(d)
  return z
 return filt
def detail(rows):return s.w.stats(rows)
def util(rows):
 if not rows:return{}
 start=min(x['entry_ts_ms'] for x in rows)//H*H;end=max(x['exit_ts_ms'] for x in rows)//H*H;vals=[]
 for t in range(start,end+1,H):vals.append(sum(float(x.get('accepted_gross',0)) for x in rows if x['entry_ts_ms']<=t<x['exit_ts_ms']))
 return {'avg_gross':sum(vals)/len(vals),'median_gross':sorted(vals)[len(vals)//2],'p90_gross':sorted(vals)[int(.9*(len(vals)-1))],'max_gross':max(vals),'pct_zero':sum(v==0 for v in vals)/len(vals),'pct_lt_0_5':sum(v<.5 for v in vals)/len(vals),'pct_lt_1':sum(v<1 for v in vals)/len(vals)}
def main():
 OUT.mkdir(parents=True,exist_ok=True);s.w.OUT=OUT;s.w.setup();v4.install_virtual_leg_study_adapter();final.install_final_routes();v3.stage3_transform=final.stage3_candidate_all
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED;s.w.base.source_batch=ind.custom_source_batch;s.w.base.read_table=v3.v2.read_table;basepatch=s.w.base.patch_admission;results=[]
 for name,cfg in CASES.items():
  v3.CASE[name]={'family_cap':CAP['family'],'gross':.10,'slots':16};ind.ACTIVE_RECOVERY_CAP=CAP['family'];mlift.MAX_LIFT_GROSS=.30;ind.ORIG_PATCH=basepatch;s.w.base.patch_admission=patch;s.w.base._study_filter=make_filter(name,cfg)
  print('START',name,flush=True);r=s.w.base.run_study(name,'10');r['cfg']={**CAP,**cfg};sc=r['scenarios'][0];ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');vv=[x for x in ts if x['strategy_id']=='V12'];sc['v12_details']={'all':detail(vv),'utilization':util(vv),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
  results.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8');print('DONE',name,flush=True)
if __name__=='__main__':main()
