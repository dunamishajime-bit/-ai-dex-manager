#!/usr/bin/env python3
import json,os,subprocess
from pathlib import Path
ROOT=Path('.research-state/pengu-short-partial-v9-crossvenue');ROOT.mkdir(parents=True,exist_ok=True);DATA=Path('.research-state/pengu-short-progression-v7-crossvenue/data')
def run(n,w,s,e,local):
 o=ROOT/f'{n}.json';env=dict(os.environ);env.update({'PENGU_V9_WARM_START':w,'PENGU_V9_EVAL_START':s,'PENGU_V9_EVAL_END':e,'PENGU_V9_OUT':str(o)});env.update({'PENGU_V9_LOCAL_DATA_DIR':str(DATA)} if local else {});p=subprocess.run(['npx','tsx','scripts/research_pengu_short_partial_v9.ts'],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);(ROOT/f'{n}.log').write_text(p.stdout);print(p.stdout);assert p.returncode==0;return json.loads(o.read_text())
def check(r):
 n,s=r['results']['NORMAL'],r['results']['STRESS'];b,c=n['BASELINE'],n['COMBINED'];bs,cs=s['BASELINE'],s['COMBINED'];fw=[];fr=[]
 for k,v in n['SHORT_FOLDS'].items():
  if v['candidate']['trades']<=0:continue
  if (v['candidate']['winRatePct'] or 0)>=(v['baseline']['winRatePct'] or 0):fw.append(k)
  if v['candidate']['returnPct']>=v['baseline']['returnPct']:fr.append(k)
 ok=b['trades']>=10 and c['trades']==b['trades'] and n['changedExits']>=2 and (c['winRatePct'] or 0)>=(b['winRatePct'] or 0)+5 and c['returnPct']>=b['returnPct'] and (c['profitFactor'] or 0)>=(b['profitFactor'] or 0) and c['maxDrawdownPct']>=b['maxDrawdownPct'] and cs['returnPct']>=bs['returnPct'] and (cs['profitFactor'] or 0)>=(bs['profitFactor'] or 0) and cs['maxDrawdownPct']>=bs['maxDrawdownPct'] and n['withoutBestImprovement']['returnDeltaPct']>=0 and s['withoutBestImprovement']['returnDeltaPct']>=0 and len(fw)>=3 and len(fr)>=3
 return {'pass':ok,'baseline':b,'candidate':c,'stressBaseline':bs,'stressCandidate':cs,'changedExits':n['changedExits'],'withoutBestNormalDeltaPct':n['withoutBestImprovement']['returnDeltaPct'],'withoutBestStressDeltaPct':s['withoutBestImprovement']['returnDeltaPct'],'foldsNonWorseWinRate':fw,'foldsNonWorseReturn':fr}
def main():
 assert (DATA/'PENGUUSDT.json').exists();a=run('binance_prior','2024-12-17T00:00:00Z','2024-12-24T00:00:00Z','2025-08-01T00:00:00Z',1);b=run('binance_overlap','2025-08-01T00:00:00Z','2025-08-23T15:00:00Z','2026-08-01T00:00:00Z',1);c=run('aster_current','2025-08-01T00:00:00Z','2025-08-23T15:00:00Z','2026-08-23T15:00:00Z',0);checks={'binancePrior':check(a),'binanceOverlap':check(b),'asterCurrent':check(c)};x={'status':'PASS_RESEARCH_ONLY','schema':'pengu-short-partial-v9-crossvenue/v1','candidate':'ATR_PROGRESS_HALF_DERISK; fixed 50/50; single candidate','checks':checks,'promotion':{'pass':all(v['pass'] for v in checks.values())},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}};(ROOT/'result.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x,indent=2))
if __name__=='__main__':main()
