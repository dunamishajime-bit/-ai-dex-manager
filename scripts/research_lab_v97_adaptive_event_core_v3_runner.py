from __future__ import annotations

import research_lab_v97_adaptive_event_core_v1 as v97
import research_lab_v97_adaptive_event_core_v2_runner as v2

_orig=v2._orig_evaluate

def risk_adjusted_evaluate(cfg,market,schedule,shadow,ledger):
    out,replays,entries=_orig(cfg,market,schedule,shadow,ledger)
    normals=[out[x]['normal'] for x in ('fold1','fold2','fold3')]
    severes=[out[x]['severe'] for x in ('fold1','fold2','fold3')]
    extremes=[out[x]['extreme'] for x in ('fold1','fold2','fold3')]
    pre=v97.compound([v97.finite(x['compoundedReturnPct'])/100 for x in normals])*100
    pres=v97.compound([v97.finite(x['compoundedReturnPct'])/100 for x in severes])*100
    prex=v97.compound([v97.finite(x['compoundedReturnPct'])/100 for x in extremes])*100
    positive=sum(v97.finite(x['compoundedReturnPct'])>0 for x in normals)
    positive_s=sum(v97.finite(x['compoundedReturnPct'])>0 for x in severes)
    worst_return=min(v97.finite(x['compoundedReturnPct'],-99) for x in normals)
    worst_s=min(v97.finite(x['compoundedReturnPct'],-99) for x in severes)
    worst_dd=min(v97.finite(x['maxDrawdownPct'],-99) for x in normals)
    apf=sum(min(5,v97.finite(x.get('profitFactor'))) for x in normals)/3
    trades=sum(int(x['tradeEpisodes']) for x in normals)
    eligible=trades>=24 and positive>=2 and positive_s>=2 and pre>=75 and pres>=25 and prex>0 and worst_return>=-2.5 and worst_s>=-8 and worst_dd>=-16.5 and apf>=1.15
    denominator=max(1.0,abs(worst_dd))
    efficiency=(pre+0.8*pres+0.25*max(0,prex))/denominator
    score=100*efficiency+4*(positive+positive_s)+4*max(0,apf-1)+2*worst_return+worst_s if eligible else -1e12
    out['preSelection']={'eligible':eligible,'score':score,'stressAdjustedEfficiency':efficiency,'compoundedReturnPct':pre,'severeCompoundedReturnPct':pres,'extremeCompoundedReturnPct':prex,'positiveFolds':positive,'positiveSevereFolds':positive_s,'tradeEpisodes':trades,'worstFoldReturnPct':worst_return,'worstSevereFoldReturnPct':worst_s,'worstFoldDrawdownPct':worst_dd,'averageFoldProfitFactor':apf,'policy':'V97_V3_PRE_ONLY_STRESS_ADJUSTED_RETURN_PER_DRAWDOWN'}
    return out,replays,entries

v97.trade_ledger=v2.completed_trade_ledger
v97.configs=v2.local_configs
v97.evaluate=risk_adjusted_evaluate

if __name__=='__main__': v97.main()
