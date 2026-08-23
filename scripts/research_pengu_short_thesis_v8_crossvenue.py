#!/usr/bin/env python3
import json,os,subprocess
from pathlib import Path
ROOT=Path('.research-state/pengu-short-thesis-v8-crossvenue');ROOT.mkdir(parents=True,exist_ok=True)
DATA=Path('.research-state/pengu-short-progression-v7-crossvenue/data')

def run(name,warm,start,end,local):
    out=ROOT/f'{name}.json'; env=dict(os.environ)
    env.update({'PENGU_V8_WARM_START':warm,'PENGU_V8_EVAL_START':start,'PENGU_V8_EVAL_END':end,'PENGU_V8_OUT':str(out)})
    if local: env['PENGU_V8_LOCAL_DATA_DIR']=str(DATA)
    cp=subprocess.run(['npx','tsx','scripts/research_pengu_short_thesis_v8.ts'],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (ROOT/f'{name}.log').write_text(cp.stdout);print(cp.stdout)
    if cp.returncode: raise RuntimeError(f'{name} failed {cp.returncode}')
    return json.loads(out.read_text())

def check(r):
    n,s=r['results']['NORMAL'],r['results']['STRESS'];b,c=n['BASELINE'],n['COMBINED'];bs,cs=s['BASELINE'],s['COMBINED']
    fw=[];fr=[]
    for k,v in n['SHORT_FOLDS'].items():
        if v['candidate']['trades']<=0:continue
        if (v['candidate']['winRatePct'] or 0)>=(v['baseline']['winRatePct'] or 0):fw.append(k)
        if v['candidate']['returnPct']>=v['baseline']['returnPct']:fr.append(k)
    ok=(b['trades']>=10 and c['trades']==b['trades'] and n['changedExits']>=2 and (c['winRatePct'] or 0)>=(b['winRatePct'] or 0)+5 and c['returnPct']>=b['returnPct'] and (c['profitFactor'] or 0)>=(b['profitFactor'] or 0) and c['maxDrawdownPct']>=b['maxDrawdownPct'] and cs['returnPct']>=bs['returnPct'] and (cs['profitFactor'] or 0)>=(bs['profitFactor'] or 0) and cs['maxDrawdownPct']>=bs['maxDrawdownPct'] and n['withoutBestImprovement']['returnDeltaPct']>=0 and s['withoutBestImprovement']['returnDeltaPct']>=0 and len(fw)>=3 and len(fr)>=3)
    return {'pass':ok,'baseline':b,'candidate':c,'stressBaseline':bs,'stressCandidate':cs,'changedExits':n['changedExits'],'withoutBestNormalDeltaPct':n['withoutBestImprovement']['returnDeltaPct'],'withoutBestStressDeltaPct':s['withoutBestImprovement']['returnDeltaPct'],'foldsNonWorseWinRate':fw,'foldsNonWorseReturn':fr}

def main():
    if not (DATA/'PENGUUSDT.json').exists(): raise RuntimeError('V7 Binance data cache missing; run V7 robustness job in same workflow first')
    prior=run('binance_prior','2024-12-17T00:00:00Z','2024-12-24T00:00:00Z','2025-08-01T00:00:00Z',True)
    overlap=run('binance_overlap','2025-08-01T00:00:00Z','2025-08-23T15:00:00Z','2026-08-01T00:00:00Z',True)
    aster=run('aster_current','2025-08-01T00:00:00Z','2025-08-23T15:00:00Z','2026-08-23T15:00:00Z',False)
    checks={'binancePrior':check(prior),'binanceOverlap':check(overlap),'asterCurrent':check(aster)}
    x={'status':'PASS_RESEARCH_ONLY','schema':'pengu-short-thesis-v8-crossvenue/v1','candidate':'ATR_ARM_EMA72_RECLAIM; single candidate; no threshold sweep','checks':checks,'promotion':{'pass':all(v['pass'] for v in checks.values())},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
    (ROOT/'result.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x,indent=2))
if __name__=='__main__':main()
