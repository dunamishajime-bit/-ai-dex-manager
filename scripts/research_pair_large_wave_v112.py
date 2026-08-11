from __future__ import annotations
import argparse,json,os,statistics,math
from pathlib import Path
import research_pair_large_wave_v111 as p
import research_lab_pair_specific_v109 as v109

CANDIDATES={
 'btc_trend_pullback':{'s':'BTC','risk':.78,'fast':6,'mid':36,'slow':240,'hold':288,'trail':7.0,'cool':8,'mode':'trend_pullback'},
 'btc_failed_break_reversal':{'s':'BTC','risk':.70,'fast':4,'mid':24,'slow':144,'hold':120,'trail':4.5,'cool':6,'mode':'failed_break'},
 'eth_beta_acceleration':{'s':'ETH','risk':.74,'fast':6,'mid':36,'slow':192,'hold':240,'trail':6.5,'cool':6,'mode':'beta_accel'},
 'bnb_squeeze_expansion':{'s':'BNB','risk':.70,'fast':6,'mid':30,'slow':192,'hold':192,'trail':6.0,'cool':10,'mode':'squeeze'},
 'avax_impulse_decay':{'s':'AVAX','risk':.60,'fast':3,'mid':24,'slow':120,'hold':168,'trail':9.0,'cool':5,'mode':'impulse_decay'},
}

def feat(cfg,candles,idx,ts):
    f=p.features(cfg,candles,idx,ts)
    if f is None:return None
    s=cfg['s'];i=f['i'];c=candles[s]
    f['r12']=p.ret(c,i,12) or 0;f['r48']=p.ret(c,i,48) or 0;f['r96']=p.ret(c,i,96) or 0
    f['v12']=p.vol(c,i,12);f['v48']=p.vol(c,i,48);f['v192']=p.vol(c,i,192)
    f['pos168']=p.rp(c,i,168)
    bi=idx['BTC'].get(ts)
    if bi is not None and s=='ETH':
        er12=f['r12'];er48=f['r48'];br12=p.ret(candles['BTC'],bi,12) or 0;br48=p.ret(candles['BTC'],bi,48) or 0
        f['beta_accel']=(er12-br12)-(er48-br48)/4
    else:f['beta_accel']=0
    return f

def classify(cfg,f):
    m=cfg['mode'];rf=f['rf'];rm=f['rm'];rl=f['rl'];e=f['e'];pos=f['pos'];vr=f['vr']
    if m=='trend_pullback':
        bias=1 if rl>1.4 and f['r96']>0 and e>.20 else -1 if rl<-1.4 and f['r96']<0 and e>.20 else 0
        initiation=1 if bias>0 and f['r12']>0 and rf>0 and f['r48']<2.2 else -1 if bias<0 and f['r12']<0 and rf<0 and f['r48']>-2.2 else 0
        continuation=1 if bias>0 and rm>.7 and pos>.55 else -1 if bias<0 and rm<-.7 and pos<.45 else 0
    elif m=='failed_break':
        bias=0
        initiation=-1 if f['pos168']>.94 and rf<-.25 and f['r12']<0 and e<.25 else 1 if f['pos168']<.06 and rf>.25 and f['r12']>0 and e<.25 else 0
        continuation=initiation
    elif m=='beta_accel':
        ba=f['beta_accel'];bias=1 if f['ethbtc']>.10 and rl>.3 else -1 if f['ethbtc']<-.10 and rl<-.3 else 0
        initiation=1 if ba>.45 and rf>.25 and vr>.75 else -1 if ba<-.45 and rf<-.25 and vr>.75 else 0
        continuation=1 if bias>0 and rm>.6 and f['ethbtc']>.08 else -1 if bias<0 and rm<-.6 and f['ethbtc']<-.08 else 0
    elif m=='squeeze':
        compression=f['v48']/max(f['v192'],1e-9)
        bias=1 if rl>.5 else -1 if rl<-.5 else 0
        initiation=1 if compression<.82 and f['v12']>f['v48'] and pos>.78 and rf>.3 else -1 if compression<.82 and f['v12']>f['v48'] and pos<.22 and rf<-.3 else 0
        continuation=1 if rm>.8 and e>.22 else -1 if rm<-.8 and e>.22 else 0
    else:
        bias=1 if rl>.4 else -1 if rl<-.4 else 0
        acceleration=abs(f['r12'])>abs(f['r48'])/2 and f['v12']>1.1*max(f['v48'],1e-9)
        initiation=1 if acceleration and f['r12']>.8 and rf>.25 else -1 if acceleration and f['r12']<-.8 and rf<-.25 else 0
        continuation=1 if bias>0 and rm>.7 and e>.17 else -1 if bias<0 and rm<-.7 and e>.17 else 0
    return bias,initiation,continuation

def run_trades(cfg,candles,idx,start,end,cost_bps,delay):
    s=cfg['s'];c=candles[s];state=0;entry=peak=trough=None;ets=None;last_exit=-10**30;vals=[];recs=[]
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end):continue
        f=feat(cfg,candles,idx,ts)
        if f is None:continue
        i=f['i'];px=f['px'];bias,ini,cont=classify(cfg,f)
        if state:
            peak=max(peak,px);trough=min(trough,px);held=(ts-ets)//p.HOUR
            trail=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            opposite=(state>0 and ini<0) or (state<0 and ini>0)
            decay=(state>0 and f['r12']<0 and f['v12']<f['v48']) or (state<0 and f['r12']>0 and f['v12']<f['v48'])
            lost=(state>0 and bias<0) or (state<0 and bias>0)
            if trail<=-cfg['trail'] or held>=cfg['hold'] or opposite or (decay and lost):
                xi=min(i+1+delay,len(c)-1);xp=float(c[xi]['open']);pnl=(state*(xp/entry-1)*100-cost_bps/100)*cfg['risk'];vals.append(pnl);recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':pnl,'holdHours':held});state=0;last_exit=ts
        if state==0 and ts-last_exit>=cfg['cool']*p.HOUR:
            d=ini if ini and (bias==0 or ini==bias) else cont if cont and (bias==0 or cont==bias) else 0
            if d:
                ei=i+1+delay
                if ei<len(c):state=d;entry=float(c[ei]['open']);peak=entry;trough=entry;ets=ts
    if state and ets is not None:
        rr=[r for r in c if start<=int(r['ts'])<end]
        if rr:
            r=rr[-1];i=idx[s][int(r['ts'])];xp=float(c[i]['close']);pnl=(state*(xp/entry-1)*100-cost_bps/100)*cfg['risk'];vals.append(pnl);recs.append({'entryTs':ets,'exitTs':int(r['ts']),'side':state,'pnl':pnl,'holdHours':(int(r['ts'])-ets)//p.HOUR})
    return vals,recs

def section(cfg,candles,idx,period):
    vals,recs=run_trades(cfg,candles,idx,*period,p.NORMAL_BPS,0);sv,_=run_trades(cfg,candles,idx,*period,p.STRESS_BPS,1)
    return {'normal':p.metric(vals),'stress':p.metric(sv),'wave':p.wave_diag(cfg,candles,idx,*period,recs)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=CANDIDATES,required=True);a=ap.parse_args();cfg=CANDIDATES[a.candidate]
    candles,idx,_=v109.b.base.load();ps=v109.b.base.periods(candles);d=section(cfg,candles,idx,ps['development']);v=section(cfg,candles,idx,ps['validation'])
    res={'strategyId':'PAIR_LARGE_WAVE_V112_'+a.candidate.upper(),'pair':cfg['s'],'candidate':a.candidate,'periods':ps,'development':d,'validation':v,'productionChanged':False,'realTradingEnabled':False}
    dm=d['normal'];vm=v['normal'];vs=v['stress'];promote=(dm.get('pf') or 0)>=1.20 and dm.get('returnPct',0)>0 and (vm.get('pf') or 0)>=1.20 and vm.get('returnPct',0)>0 and (vs.get('pf') or 0)>1 and v['wave']['captureRatePct']>=20
    if promote:
        c=section(cfg,candles,idx,ps['confirmation']);res['confirmation']=c;cm=c['normal'];cs=c['stress']
        if (cm.get('pf') or 0)>=1.20 and cm.get('returnPct',0)>0 and (cs.get('pf') or 0)>1:
            h=section(cfg,candles,idx,ps['holdout']);res['holdout']=h;hm=h['normal'];hs=h['stress'];ok=(hm.get('pf') or 0)>1 and hm.get('returnPct',0)>0 and (hs.get('pf') or 0)>1;res.update(status='PASS' if ok else 'FAIL',reason='PASS' if ok else 'HOLDOUT')
        else:res.update(status='FAIL',reason='CONFIRMATION')
    else:res.update(status='FAIL',reason='DEVELOPMENT_VALIDATION')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True);txt=json.dumps(res,indent=2);stem='pair-large-wave-v112-'+a.candidate;(out/f'{stem}.json').write_text(txt);(out/f'{stem}.md').write_text('# '+res['strategyId']+'\n\n```json\n'+txt+'\n```\n');print(txt)
if __name__=='__main__':main()
