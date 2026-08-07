from __future__ import annotations

import itertools
import math

import research_lab_v97_adaptive_event_core_v1 as v97


def completed_trade_ledger(schedule, market):
    out=[]
    for item in schedule:
        s=item['symbol']; side=int(item['side']); a=int(item['entryTs']); b=int(item['exitTs'])
        ia=market['indexes'][s].get(a); ib=market['indexes'][s].get(b)
        if ia is None: raise RuntimeError(f'V97_LEDGER_ENTRY_PRICE_MISSING {s} {a}')
        if b >= v97.END_MS or ib is None: continue
        ep=float(market['bars'][s][ia]['open']); xp=float(market['bars'][s][ib]['open']); funding=0.0; ts=a
        while ts < b:
            funding += -side*v97.BASE_GROSS*market['funding'][s].get(ts,0.0); ts += v97.BAR_MS
        net=side*v97.BASE_GROSS*(xp/ep-1.0)+funding-2*v97.BASE_GROSS*10/10000
        out.append({**item,'shadowReturn':net,'shadowReturnPct':net*100})
    return out


def local_configs():
    out=[v97.ControlConfig('V97_FIXED_075',30,-999.0,v97.BASE_GROSS,999.0,v97.BASE_GROSS,-999.0,v97.BASE_GROSS,3,-999.0,99,v97.BASE_GROSS)]
    anchors={
        ('A',15,.5,5,1.25,-8,0,3,-.5,3,.5),
        ('B',15,0,5,1.25,-8,.25,3,-.5,2,.5),
        ('C',15,.25,8,1.25,-8,0,3,-.5,3,.25),
        ('D',15,.5,8,1.0,-8,0,3,-.5,3,.5),
        ('E',30,.5,8,1.25,-8,0,3,0,2,.5),
    }
    for name,lb,wg,sr,sg,dd,dg,n,rm,ls,lg in anchors:
        out.append(v97.ControlConfig(f'V97V2_ANCHOR_{name}',lb,0.0,wg,sr,sg,dd,dg,n,rm,ls,lg))
    for lb,wg,sr,sg,dd,dg,n,ls,lg in itertools.product(
        (15,30),(.25,.375,.50),(5.0,8.0),(.90,1.00,1.25),(-7.0,-8.0),(0.0,.25),(3,5),(2,3),(.25,.50)
    ):
        sig=lb*3+int(wg*100)*7+int(sr*10)*11+int(sg*100)*13+int(abs(dd)*10)*17+int(dg*100)*19+n*23+ls*31+int(lg*100)*37
        if sig % 2: continue
        cid=f'V97V2_LB{lb}_WG{wg:g}_SR{sr:g}_SG{sg:g}_DD{dd:g}_DG{dg:g}_N{n}_RM-0.5_LS{ls}_LG{lg:g}'
        out.append(v97.ControlConfig(cid,lb,0.0,wg,sr,sg,dd,dg,n,-0.5,ls,lg))
    seen={};
    for c in out: seen[c.config_id]=c
    return list(seen.values())

_orig_evaluate=v97.evaluate

def robust_evaluate(cfg,market,schedule,shadow,ledger):
    out,replays,entries=_orig_evaluate(cfg,market,schedule,shadow,ledger)
    normals=[out[x]['normal'] for x in ('fold1','fold2','fold3')]
    severes=[out[x]['severe'] for x in ('fold1','fold2','fold3')]
    pre=v97.compound([v97.finite(x['compoundedReturnPct'])/100 for x in normals])*100
    pres=v97.compound([v97.finite(x['compoundedReturnPct'])/100 for x in severes])*100
    positive=sum(v97.finite(x['compoundedReturnPct'])>0 for x in normals)
    positive_s=sum(v97.finite(x['compoundedReturnPct'])>0 for x in severes)
    worst_return=min(v97.finite(x['compoundedReturnPct'],-99) for x in normals)
    worst_severe_return=min(v97.finite(x['compoundedReturnPct'],-99) for x in severes)
    worst_dd=min(v97.finite(x['maxDrawdownPct'],-99) for x in normals)
    apf=sum(min(5,v97.finite(x.get('profitFactor'))) for x in normals)/3
    trades=sum(int(x['tradeEpisodes']) for x in normals)
    eligible=trades>=24 and positive>=2 and positive_s>=2 and pre>=75 and pres>=25 and worst_return>=-2.5 and worst_severe_return>=-8 and worst_dd>=-16.5 and apf>=1.15
    score=pre+0.8*pres+5*(positive+positive_s)+8*worst_return+3*worst_severe_return+5*max(0,apf-1)-0.4*abs(worst_dd) if eligible else -1e12
    out['preSelection']={'eligible':eligible,'score':score,'compoundedReturnPct':pre,'severeCompoundedReturnPct':pres,'positiveFolds':positive,'positiveSevereFolds':positive_s,'tradeEpisodes':trades,'worstFoldReturnPct':worst_return,'worstSevereFoldReturnPct':worst_severe_return,'worstFoldDrawdownPct':worst_dd,'averageFoldProfitFactor':apf,'policy':'V97_V2_ROBUST_TWO_OF_THREE_WITH_BOUNDED_WEAK_FOLD'}
    return out,replays,entries

v97.trade_ledger=completed_trade_ledger
v97.configs=local_configs
v97.evaluate=robust_evaluate

if __name__=='__main__': v97.main()
