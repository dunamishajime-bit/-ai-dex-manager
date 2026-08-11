from __future__ import annotations
import argparse,json,os
from pathlib import Path
import research_lab_pair_specific_v109 as v109
import research_link_v109_external_validation as ext

K='regime_wave'; LINK='LINK'; YEAR=365*24*v109.HOUR

def sm(model,candles,idx,p,cost,delay):
    vals,_=v109.pair_trades(K,LINK,candles,idx,*p,cost,delay,model)
    return v109.metric(vals)

def current_model():
    c,i,_=v109.b.base.load();ps=v109.b.base.periods(c);m=v109.train(K,LINK,c,i,*ps['development']);return c,i,ps,m

def run_stress():
    c,i,ps,m=current_model();out={'strategyId':'LINK_V109_FROZEN_STRESS_AUDIT','threshold':m['threshold'],'periods':ps,'blocks':{}}
    for name in ('validation','confirmation','holdout'):
        out['blocks'][name]={
          'normal':sm(m,c,i,ps[name],v109.NORMAL_BPS,0),
          'stress30_delay1':sm(m,c,i,ps[name],v109.STRESS_BPS,1),
          'stress50_delay1':sm(m,c,i,ps[name],50.0,1),
          'stress70_delay2':sm(m,c,i,ps[name],70.0,2)}
    out['status']='PASS' if all((x['stress50_delay1'].get('pf') or 0)>1 for x in out['blocks'].values()) else 'FAIL'
    return out

def run_prior():
    c,i,ps,_=current_model();prior={k:(v[0]-YEAR,v[1]-YEAR) if isinstance(v,(list,tuple)) and len(v)==2 else v for k,v in ps.items()}
    # Use the exact same architecture/training procedure, trained only on prior Development.
    m=v109.train(K,LINK,c,i,*prior['development']);out={'strategyId':'LINK_V109_PRIOR_PERIOD_CAUSAL_REPLICATION','threshold':m['threshold'],'periods':prior,'blocks':{}}
    for name in ('development','validation','confirmation','holdout'):
        out['blocks'][name]={'normal':sm(m,c,i,prior[name],v109.NORMAL_BPS,0),'stress':sm(m,c,i,prior[name],v109.STRESS_BPS,1)}
    out['status']='PASS' if all((out['blocks'][x]['normal'].get('returnPct') or 0)>0 and (out['blocks'][x]['normal'].get('pf') or 0)>1 for x in ('validation','confirmation','holdout')) else 'FAIL'
    return out

def run_okx():
    c,i,ps,m=current_model();start=ps['development'][0];end=ps['holdout'][1]
    vc,vi,cov,warm=ext.load_venue('OKX',start,end);out={'strategyId':'LINK_V109_OKX_FROZEN_EXTERNAL','coverage':cov,'warmupHours':warm,'threshold':m['threshold'],'blocks':{}}
    if min(cov.values())<.97 or min(warm.values())<900:
        out['status']='DATA_INSUFFICIENT';return out
    for name in ('development','validation','confirmation','holdout'):
        out['blocks'][name]={'normal':sm(m,vc,vi,ps[name],v109.NORMAL_BPS,0),'stress':sm(m,vc,vi,ps[name],v109.STRESS_BPS,1)}
    out['status']='PASS' if all((out['blocks'][x]['normal'].get('returnPct') or 0)>0 and (out['blocks'][x]['normal'].get('pf') or 0)>1 for x in ('validation','confirmation','holdout')) else 'FAIL'
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--mode',choices=['stress','prior','okx'],required=True);a=ap.parse_args()
    r=run_stress() if a.mode=='stress' else run_prior() if a.mode=='prior' else run_okx()
    r.update(productionChanged=False,realTradingEnabled=False)
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);txt=json.dumps(r,indent=2)
    (out/f'link-v109-frozen-{a.mode}.json').write_text(txt);(out/f'link-v109-frozen-{a.mode}.md').write_text(f'# {r["strategyId"]}\n\n```json\n{txt}\n```\n');print(txt)
if __name__=='__main__':main()
