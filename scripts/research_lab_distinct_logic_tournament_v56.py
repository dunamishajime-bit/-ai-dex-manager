from __future__ import annotations

import argparse, datetime, json, math, os, statistics
from pathlib import Path
from typing import Dict, List, Tuple

import research_lab_parallel_event_regime_v53 as base

HOUR=base.HOUR
SYMS=base.SYMS
ALTS=["ETH","BNB","SOL","LINK","AVAX"]
PERIODS=base.PERIODS
NORMAL_BPS=10.0
STRESS_BPS=30.0


def metric(xs): return base.metric(xs)
def ret(c,i,n): return base.ret(c,i,n)
def vol(c,i,n): return base.vol(c,i,n)
def zscore(xs,x): return base.zscore(xs,x)

def future_trade(c,idx,ts,side,hold,delay,costbps):
    return base.future_trade(c,idx,ts,side,hold,delay,costbps)


def reps(f):
    # Deliberately tiny representative set. No broad parameter mining.
    return {
      'trend_breakout':[(72,24),(168,48)],
      'shock_mean_reversion':[(24,2.0,8),(48,2.5,12)],
      'rs_rotation':[(72,24),(168,48)],
      'residual_statarb':[(168,2.0,12),(336,2.5,24)],
      'carry_hedged':[(72,24),(168,48)],
      'crash_rebound':[(24,-7.0,12),(48,-10.0,24)],
      'session_opening_range':[(0,6,12),(8,6,12)],
      'compression_expansion':[(72,.45,12),(168,.40,24)],
      'lead_lag':[(1,2.0,6),(3,2.5,12)],
      'orderflow_depth':[(1,)],
      'pair_cointegration':[(336,2.0,24),(720,2.5,48)],
      'breadth_capitulation':[(4,-5.0,12),(5,-7.0,24)],
    }[f]


def aligned_times(candles,start,end):
    return [int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end]


def corr(a,b):
    if len(a)<5 or len(a)!=len(b): return 0.0
    ma=statistics.fmean(a); mb=statistics.fmean(b)
    va=sum((x-ma)**2 for x in a); vb=sum((x-mb)**2 for x in b)
    if va<=1e-12 or vb<=1e-12:return 0.0
    return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(va*vb)


def generate(fam,p,candles,idx,fby,start,end,costbps,delay):
    btc=candles['BTC']; out=[]; last_exit=-1
    for ts in aligned_times(candles,start,end):
        bi=idx['BTC'].get(ts)
        if bi is None or bi<800 or ts<=last_exit: continue
        picks=[]

        if fam=='trend_breakout':
            look,hold=p
            # Time-series breakout: price must clear prior channel and BTC trend cannot oppose it.
            btc_tr=ret(btc,bi,look)
            for s in ALTS:
                i=idx[s].get(ts); c=candles[s]
                if i is None or i<look+2:continue
                prev_hi=max(float(x['high']) for x in c[i-look:i]); prev_lo=min(float(x['low']) for x in c[i-look:i]); cl=float(c[i]['close'])
                if cl>prev_hi and (btc_tr or 0)>0:picks.append((s,1,hold))
                elif cl<prev_lo and (btc_tr or 0)<0:picks.append((s,-1,hold))

        elif fam=='shock_mean_reversion':
            look,zthr,hold=p
            # Single-asset return shock versus its own causal trailing distribution; fade only after opposite hourly bar.
            for s in ALTS:
                i=idx[s].get(ts); c=candles[s]
                if i is None or i<look+3:continue
                hist=[ret(c,j,1) or 0 for j in range(i-look,i)]
                cur=ret(c,i-1,1); confirm=ret(c,i,1)
                z=zscore(hist,cur) if cur is not None else None
                if z is not None and confirm is not None and abs(z)>=zthr and cur*confirm<0:picks.append((s,-1 if cur>0 else 1,hold))

        elif fam=='rs_rotation':
            look,hold=p
            # Long-only relative-strength rotation with explicit cash state when BTC is weak.
            br=ret(btc,bi,look)
            if br is not None and br>0:
                scores=[]
                for s in ALTS:
                    i=idx[s].get(ts); r=ret(candles[s],i,look) if i is not None else None
                    if r is not None:scores.append((r-br,s))
                if scores:
                    score,s=max(scores)
                    if score>0:picks=[(s,1,hold)]

        elif fam=='residual_statarb':
            look,zthr,hold=p
            # Beta-neutral residual dislocation. Hedge each alt with BTC using trailing beta.
            br=[ret(btc,j,1) or 0 for j in range(bi-look+1,bi+1)]
            for s in ALTS:
                i=idx[s].get(ts); c=candles[s]
                if i is None or i<look:continue
                sr=[ret(c,j,1) or 0 for j in range(i-look+1,i+1)]
                beta=sum(a*b for a,b in zip(br[:-1],sr[:-1]))/max(1e-12,sum(a*a for a in br[:-1]))
                resid=[b-beta*a for a,b in zip(br[:-1],sr[:-1])]; cur=sr[-1]-beta*br[-1]; z=zscore(resid,cur)
                if z is not None and abs(z)>=zthr:
                    side=-1 if z>0 else 1
                    va=future_trade(c,idx[s],ts,side,hold,delay,costbps)
                    vb=future_trade(btc,idx['BTC'],ts,-side*(1 if beta>=0 else -1),hold,delay,costbps)
                    if va is not None and vb is not None:out.append((va+abs(beta)*vb)/(1+abs(beta))); last_exit=ts+hold*HOUR
            continue

        elif fam=='carry_hedged':
            look,hold=p
            # Harvest persistent funding against the crowded side; require flat price trend and hedge market beta with BTC.
            for s in ALTS:
                vals=[]
                for h in range(1,look+1):
                    x=fby[s].get(ts-h*HOUR)
                    if x is not None:vals.append(x)
                i=idx[s].get(ts); r=ret(candles[s],i,look) if i is not None else None
                if len(vals)>=max(8,look//6) and r is not None:
                    m=statistics.fmean(vals)
                    if abs(m)>=0.005 and abs(r)<10:
                        side=-1 if m>0 else 1
                        va=future_trade(candles[s],idx[s],ts,side,hold,delay,costbps)
                        vb=future_trade(btc,idx['BTC'],ts,-side,hold,delay,costbps)
                        if va is not None and vb is not None:
                            # approximate received funding from genuine observed trailing mean, conservative half persistence
                            carry=abs(m)*(hold/8)*.5
                            out.append((va+vb)*.5+carry); last_exit=ts+hold*HOUR
            continue

        elif fam=='crash_rebound':
            look,shock,hold=p
            # Market panic event, then stabilization confirmation before long entry.
            br=ret(btc,bi,look); one=ret(btc,bi,1)
            if br is not None and br<=shock and one is not None and one>0:
                recovering=0
                for s in ALTS:
                    i=idx[s].get(ts); r=ret(candles[s],i,1) if i is not None else None
                    if r is not None and r>0:recovering+=1
                if recovering>=3:picks=[('BTC',1,hold)]

        elif fam=='session_opening_range':
            hour,rangeh,hold=p
            # UTC session opening-range breakout, independent of long-horizon trend logic.
            d=datetime.datetime.fromtimestamp(ts/1000,tz=datetime.timezone.utc)
            if d.hour==hour:
                for s in ['BTC','ETH','SOL']:
                    i=idx[s].get(ts); c=candles[s]
                    if i is None or i<rangeh+1:continue
                    hi=max(float(x['high']) for x in c[i-rangeh:i]); lo=min(float(x['low']) for x in c[i-rangeh:i]); cl=float(c[i]['close'])
                    if cl>hi:picks.append((s,1,hold))
                    elif cl<lo:picks.append((s,-1,hold))

        elif fam=='compression_expansion':
            look,q,hold=p
            # Volatility compression then fresh range expansion; direction comes from current breakout only.
            for s in ALTS:
                i=idx[s].get(ts); c=candles[s]
                if i is None or i<look*2:continue
                vols=[]
                for j in range(i-look,i):
                    vv=vol(c,j,24)
                    if vv is not None:vols.append(vv)
                curv=vol(c,i-1,24)
                if not vols or curv is None:continue
                threshold=sorted(vols)[max(0,min(len(vols)-1,int(len(vols)*q)))]
                if curv<=threshold:
                    hi=max(float(x['high']) for x in c[i-24:i]); lo=min(float(x['low']) for x in c[i-24:i]); cl=float(c[i]['close'])
                    if cl>hi:picks.append((s,1,hold))
                    elif cl<lo:picks.append((s,-1,hold))

        elif fam=='lead_lag':
            lag,thr,hold=p
            # BTC impulse first, alt has not yet moved proportionally; trade catch-up rather than same-bar momentum.
            bimp=ret(btc,bi-lag,lag)
            if bimp is not None and abs(bimp)>=thr:
                for s in ALTS:
                    i=idx[s].get(ts); simp=ret(candles[s],i,lag) if i is not None else None
                    if simp is not None and abs(simp)<abs(bimp)*.35:picks.append((s,1 if bimp>0 else -1,hold))

        elif fam=='orderflow_depth':
            # Deliberately unavailable in long historical cache. Never synthesize depth/order flow.
            continue

        elif fam=='pair_cointegration':
            look,zthr,hold=p
            # Causal stable log-price spread. Trade only if hedge ratio is stable across two trailing halves.
            pairs=[('ETH','BTC'),('SOL','ETH'),('BNB','BTC')]
            for a,b in pairs:
                ia=idx[a].get(ts); ib=idx[b].get(ts)
                if ia is None or ib is None or ia<look or ib<look:continue
                xa=[math.log(float(candles[b][ib-look+j]['close'])) for j in range(look)]
                ya=[math.log(float(candles[a][ia-look+j]['close'])) for j in range(look)]
                def beta_seg(x,y):
                    den=sum(v*v for v in x); return sum(u*v for u,v in zip(x,y))/max(1e-12,den)
                half=look//2; b1=beta_seg(xa[:half],ya[:half]); b2=beta_seg(xa[half:],ya[half:])
                if abs(b1-b2)>0.15*max(.1,abs((b1+b2)/2)):continue
                beta=(b1+b2)/2; spread=[y-beta*x for x,y in zip(xa,ya)]; z=zscore(spread[:-1],spread[-1])
                if z is not None and abs(z)>=zthr:
                    side=-1 if z>0 else 1
                    va=future_trade(candles[a],idx[a],ts,side,hold,delay,costbps); vb=future_trade(candles[b],idx[b],ts,-side,hold,delay,costbps)
                    if va is not None and vb is not None:out.append((va+abs(beta)*vb)/(1+abs(beta)));last_exit=ts+hold*HOUR
            continue

        elif fam=='breadth_capitulation':
            k,shock,hold=p
            # Cross-market capitulation followed by breadth improvement, not single-asset oversold.
            weak=0; improve=0
            for s in SYMS:
                i=idx[s].get(ts); c=candles[s]
                if i is None:continue
                r24=ret(c,i-1,24); r1=ret(c,i,1)
                if r24 is not None and r24<=shock:weak+=1
                if r1 is not None and r1>0:improve+=1
            if weak>=k and improve>=4:picks=[(s,1,hold) for s in ALTS]

        if picks:
            vals=[]
            for s,side,hold in picks:
                v=future_trade(candles[s],idx[s],ts,side,hold,delay,costbps)
                if v is not None:vals.append(v)
            if vals:
                out.append(sum(vals)/len(vals));last_exit=ts+max(x[2] for x in picks)*HOUR
    return out


def stage_ok(m,stage):
    mintr={'development':25,'validation':20,'confirmation':20,'holdout':10}[stage]
    pfmin=1.10 if stage in ('development','validation') else (1.20 if stage=='confirmation' else 1.0)
    return m['trades']>=mintr and (m['pf'] or 0)>=pfmin and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<45


def evaluate_family(f,candles,idx,fby):
    if f=='orderflow_depth':
        return {'family':f,'status':'DATA_UNAVAILABLE','robust':False,'tested':0,'note':'Long historical depth/order-flow is not present in the genuine USD-M cache; skipped rather than synthesized.'}
    survivors=[]
    for p in reps(f):
        d=metric(generate(f,p,candles,idx,fby,*PERIODS['development'],NORMAL_BPS,0))
        if stage_ok(d,'development'):
            v=metric(generate(f,p,candles,idx,fby,*PERIODS['validation'],NORMAL_BPS,0))
            if stage_ok(v,'validation'):survivors.append((p,d,v))
    # Selection is exclusively Dev+Validation. Confirmation never feeds tuning.
    survivors.sort(key=lambda x:((x[1]['pf'] or 0)+(x[2]['pf'] or 0),x[1]['returnPct']+x[2]['returnPct']),reverse=True)
    if not survivors:
        return {'family':f,'status':'NO_ROBUST_IMPROVEMENT','robust':False,'tested':len(reps(f)),'devValidationPasses':0}
    p,d,v=survivors[0]
    c=metric(generate(f,p,candles,idx,fby,*PERIODS['confirmation'],NORMAL_BPS,0))
    cs=metric(generate(f,p,candles,idx,fby,*PERIODS['confirmation'],STRESS_BPS,1))
    confok=stage_ok(c,'confirmation') and (c['pfWithoutBest'] or 0)>1 and (cs['pf'] or 0)>1 and cs['returnPct']>0
    result={'family':f,'tested':len(reps(f)),'devValidationPasses':len(survivors),'selectedParams':p,'development':d,'validation':v,'confirmation':c,'stressConfirmation':cs,'robust':False}
    if not confok:
        result['status']='NO_ROBUST_IMPROVEMENT'; result['holdout']=None; result['stressHoldout']=None; return result
    h=metric(generate(f,p,candles,idx,fby,*PERIODS['holdout'],NORMAL_BPS,0)); hs=metric(generate(f,p,candles,idx,fby,*PERIODS['holdout'],STRESS_BPS,1))
    robust=stage_ok(h,'holdout') and (h['pf'] or 0)>1 and (h['pfWithoutBest'] or 0)>1 and (hs['pf'] or 0)>1 and hs['returnPct']>0 and hs['maxDDPct']>-20
    result.update({'holdout':h,'stressHoldout':hs,'robust':robust,'status':'ROBUST_PASS' if robust else 'NO_ROBUST_IMPROVEMENT'})
    return result


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--family',required=True); args=ap.parse_args()
    candles,idx,fby=base.load(); r=evaluate_family(args.family,candles,idx,fby)
    r.update({'strategyId':'DISTINCT_LOGIC_TOURNAMENT_V56','normalRoundTripBps':NORMAL_BPS,'stressRoundTripBps':STRESS_BPS,'stressDelayHours':1,'productionChanged':False,'realTradingEnabled':False,'chronology':'2023 Development -> 2024 Validation -> 2025 untouched Confirmation -> 2026 untouched Holdout; Holdout opens only after Confirmation pass','limitations':['Only genuine cached public USD-M OHLCV/funding is used for historical testing.','Missing order-flow/depth history is skipped, never fabricated.','V9 forward cycles are not optimization data.','No production, VPS, credentials, orders, accounts, positions, approvals or LIVE state touched.']})
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
    stem=f"distinct-logic-tournament-v56-{args.family}"
    (out/f'{stem}.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
    (out/f'{stem}.md').write_text(f"# Distinct Logic Tournament V56 — {args.family}\n\n- Status: **{r['status']}**\n- Robust: **{r['robust']}**\n\n```json\n{json.dumps(r,indent=2)}\n```\n",encoding='utf-8')
    print(json.dumps(r,indent=2))

if __name__=='__main__':main()
