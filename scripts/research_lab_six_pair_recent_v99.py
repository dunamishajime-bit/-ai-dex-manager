from __future__ import annotations

import argparse, json, math, os, statistics
from pathlib import Path

import research_lab_six_pair_one_year_v98 as v98

HOUR=v98.HOUR
SYMS=v98.SYMS
NORMAL_BPS=v98.NORMAL_BPS
STRESS_BPS=v98.STRESS_BPS
ret=v98.ret
metric=v98.metric
future_trade=v98.future_trade

FAMILIES=[
    "vol_rank_leadership",
    "beta_dispersion_release",
    "downside_breadth_recovery",
    "idiosyncratic_gap_persistence",
    "correlation_synchronization_break",
    "drawdown_velocity_reversal",
]


def corr(a,b):
    if len(a)<12 or len(a)!=len(b): return 0.0
    ma,mb=statistics.fmean(a),statistics.fmean(b)
    va=sum((x-ma)**2 for x in a); vb=sum((x-mb)**2 for x in b)
    if va<=1e-12 or vb<=1e-12:return 0.0
    return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(va*vb)


def rs(c,i,n):
    if i is None or i<n:return []
    return [ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]


def beta(xs,ys):
    if len(xs)!=len(ys) or len(xs)<24:return 1.0
    mx,my=statistics.fmean(xs),statistics.fmean(ys)
    vy=sum((y-my)**2 for y in ys)
    if vy<=1e-12:return 1.0
    return sum((x-mx)*(y-my) for x,y in zip(xs,ys))/vy


def generate(fam,candles,idx,start,end,costbps,delay):
    out=[]; pair={s:[] for s in SYMS}; last_exit=-1
    times=[int(r["ts"]) for r in candles["BTC"] if start<=int(r["ts"])<end]
    for ts in times:
        bi=idx["BTC"].get(ts)
        if bi is None or bi<800 or ts<=last_exit:continue
        picks=[]

        if fam=="vol_rank_leadership":
            rows=[]
            for s in SYMS:
                i=idx[s].get(ts)
                x=rs(candles[s],i,168)
                if len(x)<168:continue
                v7=statistics.pstdev(x[-168:]); v2=statistics.pstdev(x[-48:]); m=ret(candles[s],i,12)
                if v7>1e-9 and m is not None: rows.append((v2/v7,m,s))
            if len(rows)==6:
                rows.sort()
                lo=rows[:2]; hi=rows[-2:]
                # leadership only when vol rank reorganizes: low-vol leaders with positive impulse or high-vol laggards with negative impulse
                cand=[(m,s) for ratio,m,s in lo if m>1.0]
                if cand:
                    m,s=max(cand); picks=[(s,1,18)]
                else:
                    cand=[(m,s) for ratio,m,s in hi if m<-1.0]
                    if cand:
                        m,s=min(cand); picks=[(s,-1,18)]

        elif fam=="beta_dispersion_release":
            br=rs(candles['BTC'],bi,240)
            if len(br)<240:continue
            betas=[]; impulses=[]
            for s in SYMS[1:]:
                i=idx[s].get(ts); sr=rs(candles[s],i,240)
                if len(sr)<240:continue
                b_old=beta(sr[:168],br[:168]); b_new=beta(sr[-72:],br[-72:]); imp=ret(candles[s],i,8)
                betas.append((abs(b_new-b_old),b_new-b_old,s)); impulses.append((imp or 0,s))
            if len(betas)==5:
                shift,s=max(betas)
                i=idx[s].get(ts); imp=ret(candles[s],i,8)
                if shift>.35 and imp is not None and abs(imp)>1.2:
                    picks=[(s,1 if imp>0 else -1,16)]

        elif fam=="downside_breadth_recovery":
            d24=[]; d6=[]
            for s in SYMS:
                i=idx[s].get(ts)
                a=ret(candles[s],i,24) if i is not None else None
                b=ret(candles[s],i,6) if i is not None else None
                if a is not None and b is not None:d24.append((a,s));d6.append((b,s))
            if len(d24)==6:
                weak=sum(a<-2.0 for a,_ in d24); recover=sum(b>0.8 for b,_ in d6)
                if weak>=4 and recover>=4:
                    b,s=max(d6)
                    if b>1.2:picks=[(s,1,24)]
                elif sum(a>2.0 for a,_ in d24)>=4 and sum(b<-.8 for b,_ in d6)>=4:
                    b,s=min(d6)
                    if b<-1.2:picks=[(s,-1,24)]

        elif fam=="idiosyncratic_gap_persistence":
            moves=[]
            for s in SYMS:
                i=idx[s].get(ts); x=ret(candles[s],i,3) if i is not None else None
                if x is not None:moves.append((x,s))
            if len(moves)==6:
                med=statistics.median(x for x,_ in moves)
                dev=[(x-med,s,x) for x,s in moves]
                z,s,x=max(dev,key=lambda t:abs(t[0]))
                if abs(z)>=2.2 and abs(med)<1.5:
                    picks=[(s,1 if z>0 else -1,9)]

        elif fam=="correlation_synchronization_break":
            br=rs(candles['BTC'],bi,192)
            if len(br)<192:continue
            rows=[]
            for s in SYMS[1:]:
                i=idx[s].get(ts); sr=rs(candles[s],i,192)
                if len(sr)<192:continue
                old=corr(sr[:144],br[:144]); new=corr(sr[-48:],br[-48:]); imp=ret(candles[s],i,6)
                if imp is not None: rows.append((old-new,imp,s,new))
            if len(rows)==5:
                drop,imp,s,new=max(rows)
                if drop>.35 and new<.35 and abs(imp)>1.3:
                    picks=[(s,1 if imp>0 else -1,12)]

        elif fam=="drawdown_velocity_reversal":
            rows=[]
            for s in SYMS:
                i=idx[s].get(ts)
                if i is None or i<96:continue
                c=candles[s]
                p0=float(c[i-24]['close']); p1=float(c[i-6]['close']); p2=float(c[i]['close'])
                r1=(p1/p0-1)*100; r2=(p2/p1-1)*100
                rows.append((r1,r2,s))
            if len(rows)==6:
                neg=[x for x in rows if x[0]<-3.0 and x[1]>1.0]
                pos=[x for x in rows if x[0]>3.0 and x[1]<-1.0]
                if len(neg)>=2:
                    r1,r2,s=max(neg,key=lambda x:x[1]);picks=[(s,1,18)]
                elif len(pos)>=2:
                    r1,r2,s=min(pos,key=lambda x:x[1]);picks=[(s,-1,18)]

        if picks:
            vals=[]; used=[]; holdmax=0
            for s,side,hold in picks:
                v=future_trade(candles[s],idx[s],ts,side,hold,delay,costbps)
                if v is not None:
                    vals.append(v);used.append((s,v));holdmax=max(holdmax,hold)
            if vals:
                p=sum(vals)/len(vals);out.append(p)
                for s,v in used:pair[s].append(v/len(vals))
                last_exit=ts+holdmax*HOUR
    return out,pair


def stage_ok(m,stage):
    mins={"development":12,"validation":8,"confirmation":6,"holdout":6}
    pfmin={"development":1.05,"validation":1.05,"confirmation":1.20,"holdout":1.00}
    return m['trades']>=mins[stage] and (m['pf'] or 0)>=pfmin[stage] and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<50


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--family',required=True,choices=FAMILIES);a=ap.parse_args()
    candles,idx,_=v98.load(); ps=v98.periods(candles); fam=a.family
    result={"strategyId":"SIX_PAIR_RECENT_V99","family":fam,"universe":[s+"/USDT" for s in SYMS],"periods":ps,"normalBps":NORMAL_BPS,"stressBps":STRESS_BPS,"productionChanged":False,"realTradingEnabled":False}
    dev,_=generate(fam,candles,idx,*ps['development'],NORMAL_BPS,0);dm=metric(dev);result['development']=dm
    if not stage_ok(dm,'development'):
        result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='DEVELOPMENT_FAIL')
    else:
        val,_=generate(fam,candles,idx,*ps['validation'],NORMAL_BPS,0);vm=metric(val);result['validation']=vm
        if not stage_ok(vm,'validation'):
            result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='VALIDATION_FAIL')
        else:
            conf,_=generate(fam,candles,idx,*ps['confirmation'],NORMAL_BPS,0);cm=metric(conf)
            cs,_=generate(fam,candles,idx,*ps['confirmation'],STRESS_BPS,1);csm=metric(cs)
            result['confirmation']=cm;result['stressConfirmation']=csm
            confok=stage_ok(cm,'confirmation') and (cm['pfWithoutBest'] or 0)>1 and (csm['pf'] or 0)>1 and csm['returnPct']>0
            if not confok:
                result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='CONFIRMATION_FAIL')
            else:
                hold,pair=generate(fam,candles,idx,*ps['holdout'],NORMAL_BPS,0);hm=metric(hold)
                hs,_=generate(fam,candles,idx,*ps['holdout'],STRESS_BPS,1);hsm=metric(hs)
                result['holdout']=hm;result['stressHoldout']=hsm;result['holdoutPairContribution']={s:sum(pair[s]) for s in SYMS}
                robust=stage_ok(hm,'holdout') and (hm['pfWithoutBest'] or 0)>1 and (hsm['pf'] or 0)>1 and hsm['returnPct']>0
                result.update(status='ROBUST_PASS' if robust else 'NO_ROBUST_IMPROVEMENT',robust=robust,reason='PASS' if robust else 'HOLDOUT_FAIL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
    stem=f"six-pair-recent-v99-{fam}"
    (out/f"{stem}.json").write_text(json.dumps(result,indent=2),encoding='utf-8')
    (out/f"{stem}.md").write_text(f"# Six Pair Recent V99 — {fam}\n\n```json\n{json.dumps(result,indent=2)}\n```\n",encoding='utf-8')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
