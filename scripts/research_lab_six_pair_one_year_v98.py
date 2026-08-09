from __future__ import annotations

import argparse, json, math, os, statistics
from pathlib import Path

import research_lab_parallel_event_regime_v53 as base

HOUR = base.HOUR
DAY = 24 * HOUR
YEAR = 365 * DAY
SYMS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
NORMAL_BPS = 10.0
STRESS_BPS = 30.0

ret = base.ret
metric = base.metric
future_trade = base.future_trade


def corr(a, b):
    if len(a) < 12 or len(a) != len(b): return 0.0
    ma, mb = statistics.fmean(a), statistics.fmean(b)
    va = sum((x-ma)**2 for x in a); vb = sum((x-mb)**2 for x in b)
    if va <= 1e-12 or vb <= 1e-12: return 0.0
    return sum((x-ma)*(y-mb) for x,y in zip(a,b)) / math.sqrt(va*vb)


def load():
    candles, idx, fby = base.load()
    for s in SYMS:
        if s not in candles: raise RuntimeError(f"MISSING_SYMBOL:{s}")
    return candles, idx, fby


def periods(candles):
    common_first = max(int(candles[s][0]["ts"]) for s in SYMS)
    common_last = min(int(candles[s][-2]["ts"]) for s in SYMS)
    start = max(common_first, common_last - YEAR)
    span = common_last - start
    if span < 330 * DAY:
        raise RuntimeError(f"INSUFFICIENT_COMMON_HISTORY:{span/DAY:.1f}d")
    a = start + int(span * .50)
    b = start + int(span * .70)
    c = start + int(span * .85)
    return {"development":(start,a),"validation":(a,b),"confirmation":(b,c),"holdout":(c,common_last)}


def rseries(c, i, n):
    return [ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]


def entropy_positive(vals):
    xs=[max(0.0,x) for x in vals]; total=sum(xs)
    if total<=1e-12:return 1.0
    ps=[x/total for x in xs if x>0]
    if len(ps)<=1:return 0.0
    return -sum(p*math.log(p) for p in ps)/math.log(len(ps))


def efficiency(c,i,n):
    if i-n<0:return None
    closes=[float(c[j]["close"]) for j in range(i-n,i+1)]
    net=abs(closes[-1]-closes[0]); path=sum(abs(closes[j]-closes[j-1]) for j in range(1,len(closes)))
    return net/path if path>1e-12 else 0.0


def semivol(c,i,n):
    if i-n<0:return None
    rs=[ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]
    up=[x*x for x in rs if x>0]; dn=[x*x for x in rs if x<0]
    return math.sqrt(sum(dn)/max(1,len(dn))), math.sqrt(sum(up)/max(1,len(up)))


def families():
    return [
      "leadership_entropy_transition",
      "serial_dependence_switch",
      "residual_variance_release",
      "semivol_skew_transition",
      "path_efficiency_state_change",
      "cross_asset_shock_absorption",
    ]


def generate(fam,candles,idx,start,end,costbps,delay):
    out=[]; pair={s:[] for s in SYMS}; last_exit=-1
    times=[int(r["ts"]) for r in candles["BTC"] if start<=int(r["ts"])<end]
    for ts in times:
        bi=idx["BTC"].get(ts)
        if bi is None or bi<800 or ts<=last_exit:continue
        picks=[]

        if fam=="leadership_entropy_transition":
            now=[]; prev=[]
            for s in SYMS:
                i=idx[s].get(ts)
                if i is None:continue
                a=ret(candles[s],i,24); b=ret(candles[s],i-24,24)
                if a is not None and b is not None: now.append((a,s)); prev.append((b,s))
            if len(now)==6:
                en=entropy_positive([x for x,_ in now]); ep=entropy_positive([x for x,_ in prev])
                breadth=sum(x>0 for x,_ in now)
                if ep-en>.22 and breadth>=4:
                    x,s=max(now)
                    if x>1.0:picks=[(s,1,24)]
                elif ep-en>.22 and breadth<=2:
                    x,s=min(now)
                    if x<-1.0:picks=[(s,-1,24)]

        elif fam=="serial_dependence_switch":
            # Trade only when lag-1 serial dependence changes sign; direction comes from current impulse.
            for s in SYMS:
                i=idx[s].get(ts)
                if i is None or i<360:continue
                rs=rseries(candles[s],i,336)
                old=corr(rs[:167],rs[1:168]); new=corr(rs[-168:-1],rs[-167:])
                imp=ret(candles[s],i,6)
                if imp is None or abs(imp)<1.0:continue
                if old<=-.05 and new>=.08:picks.append((s,1 if imp>0 else -1,12))
                elif old>=.08 and new<=-.05:picks.append((s,-1 if imp>0 else 1,12))

        elif fam=="residual_variance_release":
            # BTC/ETH two-factor residual variance compression -> release; direction from residual sign only after release.
            br=rseries(candles['BTC'],bi,168)
            ei=idx['ETH'].get(ts)
            if ei is None or ei<168:continue
            er=rseries(candles['ETH'],ei,168)
            for s in ["BNB","SOL","LINK","AVAX"]:
                i=idx[s].get(ts)
                if i is None or i<336:continue
                sr=rseries(candles[s],i,168)
                # fixed equal factor mix avoids fitting betas
                resid=[z-(x+y)/2 for x,y,z in zip(br,er,sr)]
                old=statistics.pstdev(resid[:96]); recent=statistics.pstdev(resid[-24:])
                cur=sum(resid[-6:])
                if old>1e-9 and recent>old*1.6 and abs(cur)>1.0:
                    picks.append((s,1 if cur>0 else -1,12))

        elif fam=="semivol_skew_transition":
            # Directional risk asymmetry transition, not price trend: downside/upside semivol ratio flips regime.
            for s in SYMS:
                i=idx[s].get(ts)
                if i is None or i<240:continue
                old=semivol(candles[s],i-72,168); new=semivol(candles[s],i,72)
                if not old or not new:continue
                ro=old[0]/max(old[1],1e-9); rn=new[0]/max(new[1],1e-9)
                one=ret(candles[s],i,3)
                if one is None:continue
                if ro>1.25 and rn<.85 and one>0:picks.append((s,1,18))
                elif ro<.80 and rn>1.30 and one<0:picks.append((s,-1,18))

        elif fam=="path_efficiency_state_change":
            # Uses path efficiency (net displacement / traveled path), a different state variable from trend magnitude.
            for s in SYMS:
                i=idx[s].get(ts)
                if i is None or i<240:continue
                eold=efficiency(candles[s],i-48,168); enew=efficiency(candles[s],i,48); imp=ret(candles[s],i,12)
                if eold is None or enew is None or imp is None:continue
                if eold<.18 and enew>.42 and abs(imp)>1.5:picks.append((s,1 if imp>0 else -1,18))
                elif eold>.48 and enew<.18 and abs(imp)>2.0:picks.append((s,-1 if imp>0 else 1,12))

        elif fam=="cross_asset_shock_absorption":
            # Relative shock absorption: after a market-wide impulse, trade assets that resisted the impulse,
            # expecting defensive leadership persistence; not BTC lead-lag catch-up.
            moves=[]
            for s in SYMS:
                i=idx[s].get(ts); r=ret(candles[s],i,6) if i is not None else None
                if r is not None:moves.append((r,s))
            if len(moves)==6:
                med=statistics.median(x for x,_ in moves)
                if abs(med)>=2.0:
                    if med<0:
                        # strongest absorber during sell shock
                        r,s=max(moves)
                        if r-med>=2.0:picks=[(s,1,18)]
                    else:
                        # weakest participation during euphoric shock -> defensive short
                        r,s=min(moves)
                        if med-r>=2.0:picks=[(s,-1,18)]

        if picks:
            vals=[]; used=[]; holdmax=0
            for s,side,hold in picks:
                v=future_trade(candles[s],idx[s],ts,side,hold,delay,costbps)
                if v is not None:
                    vals.append(v); used.append((s,v)); holdmax=max(holdmax,hold)
            if vals:
                p=sum(vals)/len(vals); out.append(p)
                for s,v in used:pair[s].append(v/len(vals))
                last_exit=ts+holdmax*HOUR
    return out,pair


def stage_ok(m,stage):
    mins={"development":12,"validation":8,"confirmation":6,"holdout":6}
    pfmin={"development":1.05,"validation":1.05,"confirmation":1.20,"holdout":1.00}
    return m['trades']>=mins[stage] and (m['pf'] or 0)>=pfmin[stage] and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<50


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--family',required=True,choices=families()); a=ap.parse_args()
    candles,idx,_=load(); ps=periods(candles); fam=a.family
    result={"strategyId":"SIX_PAIR_ONE_YEAR_V98","family":fam,"universe":[s+"/USDT" for s in SYMS],"periods":ps,"normalBps":NORMAL_BPS,"stressBps":STRESS_BPS,"productionChanged":False,"realTradingEnabled":False}
    dev,_=generate(fam,candles,idx,*ps['development'],NORMAL_BPS,0); dm=metric(dev); result['development']=dm
    if not stage_ok(dm,'development'):
        result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='DEVELOPMENT_FAIL')
    else:
        val,_=generate(fam,candles,idx,*ps['validation'],NORMAL_BPS,0); vm=metric(val); result['validation']=vm
        if not stage_ok(vm,'validation'):
            result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='VALIDATION_FAIL')
        else:
            conf,_=generate(fam,candles,idx,*ps['confirmation'],NORMAL_BPS,0); cm=metric(conf)
            cs,_=generate(fam,candles,idx,*ps['confirmation'],STRESS_BPS,1); csm=metric(cs)
            result['confirmation']=cm;result['stressConfirmation']=csm
            confok=stage_ok(cm,'confirmation') and (cm['pfWithoutBest'] or 0)>1 and (csm['pf'] or 0)>1 and csm['returnPct']>0
            if not confok:
                result.update(status='NO_ROBUST_IMPROVEMENT',robust=False,reason='CONFIRMATION_FAIL')
            else:
                hold,pair=generate(fam,candles,idx,*ps['holdout'],NORMAL_BPS,0); hm=metric(hold)
                hs,_=generate(fam,candles,idx,*ps['holdout'],STRESS_BPS,1); hsm=metric(hs)
                result['holdout']=hm;result['stressHoldout']=hsm;result['holdoutPairContribution']={s:sum(pair[s]) for s in SYMS}
                robust=stage_ok(hm,'holdout') and (hm['pfWithoutBest'] or 0)>1 and (hsm['pf'] or 0)>1 and hsm['returnPct']>0
                result.update(status='ROBUST_PASS' if robust else 'NO_ROBUST_IMPROVEMENT',robust=robust,reason='PASS' if robust else 'HOLDOUT_FAIL')
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
    stem=f"six-pair-one-year-v98-{fam}"
    (out/f"{stem}.json").write_text(json.dumps(result,indent=2),encoding='utf-8')
    (out/f"{stem}.md").write_text(f"# Six Pair One Year V98 — {fam}\n\n```json\n{json.dumps(result,indent=2)}\n```\n",encoding='utf-8')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
