#!/usr/bin/env python3
import csv, io, json, os, subprocess, zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT=Path('.research-state/pengu-short-progression-v7-crossvenue'); ROOT.mkdir(parents=True,exist_ok=True)
ARCHIVE='https://data.binance.vision/data/futures/um/monthly'
DATA=ROOT/'data'; DATA.mkdir(parents=True,exist_ok=True)

def months(y0,m0,y1,m1):
    y,m=y0,m0
    while (y,m)<=(y1,m1):
        yield f'{y:04d}-{m:02d}'; m+=1
        if m==13:y,m=y+1,1

def getzip(url):
    try:
        with urlopen(Request(url,headers={'User-Agent':'DisDex-Research-V7/1.0'}),timeout=90) as r:return r.read()
    except HTTPError as e:
        if e.code==404:return None
        raise

def nts(v):
    x=int(float(v))
    while x>10_000_000_000_000:x//=1000
    return x

def klines(sym):
    out={}; found=[]
    for ym in months(2024,12,2026,7):
        z=getzip(f'{ARCHIVE}/klines/{sym}/1h/{sym}-1h-{ym}.zip')
        if z is None:continue
        found.append(ym)
        with zipfile.ZipFile(io.BytesIO(z)) as zz, zz.open(zz.namelist()[0]) as fh:
            for r in csv.reader(io.TextIOWrapper(fh,encoding='utf-8-sig')):
                if len(r)<7:continue
                try:
                    t=nts(r[0]); out[t]={'openTime':t,'open':float(r[1]),'high':float(r[2]),'low':float(r[3]),'close':float(r[4]),'volume':float(r[5]),'closeTime':nts(r[6])}
                except Exception:pass
    rows=[out[k] for k in sorted(out)]
    if len(rows)<(1000 if sym=='PENGUUSDT' else 5000):raise RuntimeError(f'insufficient {sym} {len(rows)} {found}')
    (DATA/f'{sym}.json').write_text(json.dumps(rows,separators=(',',':')))
    return {'rows':len(rows),'months':found,'first':rows[0]['openTime'],'last':rows[-1]['openTime']}

def funding(sym):
    out={}; found=[]
    for ym in months(2024,12,2026,7):
        z=getzip(f'{ARCHIVE}/fundingRate/{sym}/{sym}-fundingRate-{ym}.zip')
        if z is None:continue
        found.append(ym)
        with zipfile.ZipFile(io.BytesIO(z)) as zz, zz.open(zz.namelist()[0]) as fh: rows=list(csv.reader(io.TextIOWrapper(fh,encoding='utf-8-sig')))
        if not rows:continue
        h=[x.strip().lower() for x in rows[0]]; has=any(any(c.isalpha() for c in x) for x in h)
        if has:
            ti=next((i for i,x in enumerate(h) if 'time' in x),0); ri=next((i for i,x in enumerate(h) if 'funding' in x and 'rate' in x),len(h)-1); rr=rows[1:]
        else:ti,ri,rr=0,len(rows[0])-1,rows
        for r in rr:
            try:t=nts(r[ti]); out[t]={'fundingTime':t,'fundingRate':float(r[ri])}
            except Exception:pass
    vals=[out[k] for k in sorted(out)]
    if len(vals)<100:raise RuntimeError('insufficient funding')
    (DATA/'PENGUUSDT-funding.json').write_text(json.dumps(vals,separators=(',',':')))
    return {'rows':len(vals),'months':found,'first':vals[0]['fundingTime'],'last':vals[-1]['fundingTime']}

def run(name,warm,start,end,local=True):
    out=ROOT/f'{name}.json'; env=dict(os.environ)
    env.update({'PENGU_V7_WARM_START':warm,'PENGU_V7_EVAL_START':start,'PENGU_V7_EVAL_END':end,'PENGU_V7_OUT':str(out)})
    if local:env['PENGU_V7_LOCAL_DATA_DIR']=str(DATA)
    cp=subprocess.run(['npx','tsx','scripts/research_pengu_short_progression_v7_atr.ts'],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (ROOT/f'{name}.log').write_text(cp.stdout); print(cp.stdout)
    if cp.returncode:raise RuntimeError(f'{name} failed {cp.returncode}')
    return json.loads(out.read_text())

def generic_pass(r):
    n,s=r['results']['NORMAL'],r['results']['STRESS']; b,c=n['BASELINE'],n['COMBINED']; bs,cs=s['BASELINE'],s['COMBINED']
    fold_nonworse=[]; fold_return_nonworse=[]
    for k,v in n['SHORT_FOLDS'].items():
        if v['candidate']['trades']<=0:continue
        if (v['candidate']['winRatePct'] or 0)>=(v['baseline']['winRatePct'] or 0):fold_nonworse.append(k)
        if v['candidate']['returnPct']>=v['baseline']['returnPct']:fold_return_nonworse.append(k)
    ok=(b['trades']>=10 and c['trades']==b['trades'] and n['changedExits']>=2 and
        (c['winRatePct'] or 0)>=(b['winRatePct'] or 0)+5 and c['returnPct']>=b['returnPct'] and
        (c['profitFactor'] or 0)>=(b['profitFactor'] or 0) and c['maxDrawdownPct']>=b['maxDrawdownPct'] and
        cs['returnPct']>=bs['returnPct'] and (cs['profitFactor'] or 0)>=(bs['profitFactor'] or 0) and cs['maxDrawdownPct']>=bs['maxDrawdownPct'] and
        n['withoutBestImprovement']['returnDeltaPct']>=0 and s['withoutBestImprovement']['returnDeltaPct']>=0 and
        len(fold_nonworse)>=3 and len(fold_return_nonworse)>=3)
    return {'pass':ok,'baseline':b,'candidate':c,'stressBaseline':bs,'stressCandidate':cs,'changedExits':n['changedExits'],'withoutBestNormalDeltaPct':n['withoutBestImprovement']['returnDeltaPct'],'withoutBestStressDeltaPct':s['withoutBestImprovement']['returnDeltaPct'],'foldsNonWorseWinRate':fold_nonworse,'foldsNonWorseReturn':fold_return_nonworse}

def main():
    data={'pengu':klines('PENGUUSDT'),'btc':klines('BTCUSDT'),'funding':funding('PENGUUSDT')}
    prior=run('binance_prior','2024-12-17T00:00:00Z','2024-12-24T00:00:00Z','2025-08-01T00:00:00Z')
    overlap=run('binance_overlap','2025-08-01T00:00:00Z','2025-08-23T15:00:00Z','2026-08-01T00:00:00Z')
    aster=run('aster_current','2025-08-01T00:00:00Z','2025-08-23T15:00:00Z','2026-08-23T15:00:00Z',local=False)
    checks={'binancePrior':generic_pass(prior),'binanceOverlap':generic_pass(overlap),'asterCurrent':generic_pass(aster)}
    result={'status':'PASS_RESEARCH_ONLY','schema':'pengu-short-progression-v7-atr-crossvenue/v1','candidate':'ATR_PROGRESS_1_TO_2_EXIT_0P5; single candidate; no threshold sweep','data':data,'checks':checks,'promotion':{'pass':all(x['pass'] for x in checks.values())},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n'); print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
