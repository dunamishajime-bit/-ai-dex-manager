import research_lab_v96_recent_event_core_v10 as v10

A_CFG = v10.v6.Config('V10_A_EXACT','SHORT_PULLBACK',10,5.0,8,1.0,0.0,84)


def exact_a_opportunities(market):
    result=[]
    for ts in market['times']:
        if not (v10.START_MS <= ts < v10.END_MS - v10.BAR4):
            continue
        item=v10.v6.short_signal(A_CFG,ts,market,False)
        if item is None:
            continue
        symbol,side,meta=item
        result.append(v10.Opportunity('A4H',ts,ts+v10.BAR4,symbol,side,84,meta))
    return result


def corrected_evaluate(cfg, market, opp_a, opp_b, shadow_a, shadow_b, shadow_a_s, shadow_b_s):
    # Router decisions are identical in Normal and Severe. Severe changes execution cost only.
    normal, entries = v10.simulate_meta(cfg, market, opp_a, opp_b, shadow_a, shadow_b, False)
    severe, severe_entries = v10.simulate_meta(cfg, market, opp_a, opp_b, shadow_a, shadow_b, True)
    ranges={'fold1':(v10.START_MS,v10.F1_MS),'fold2':(v10.F1_MS,v10.F2_MS),'fold3':(v10.F2_MS,v10.F3_MS),'lateEvaluation':(v10.F3_MS,v10.END_MS),'full':(v10.START_MS,v10.END_MS)}
    out={'variantId':cfg.config_id,'config':v10.asdict(cfg)}
    for name,(a,b) in ranges.items():
        out[name]={'normal':v10.metrics(normal,entries,a,b),'severe':v10.metrics(severe,severe_entries,a,b)}
    ns=[out[x]['normal'] for x in ('fold1','fold2','fold3')]
    ss=[out[x]['severe'] for x in ('fold1','fold2','fold3')]
    pre=v10.compound([v10.finite(x['compoundedReturnPct'])/100 for x in ns])*100
    pre_s=v10.compound([v10.finite(x['compoundedReturnPct'])/100 for x in ss])*100
    pn=sum(v10.finite(x['compoundedReturnPct'])>0 for x in ns)
    ps=sum(v10.finite(x['compoundedReturnPct'])>0 for x in ss)
    trades=sum(int(x['tradeEpisodes']) for x in ns)
    worst=min(v10.finite(x['maxDrawdownPct'],-99) for x in ns)
    avg_pf=sum(min(5.0,v10.finite(x.get('profitFactor'))) for x in ns)/3
    eligible=bool(trades>=10 and pn==3 and ps>=2 and pre>=45 and pre_s>=15 and worst>=-15 and avg_pf>=1.12)
    score=pre+0.7*pre_s+5*(pn+ps)+5*max(0,avg_pf-1)-0.2*abs(worst) if eligible else -1e12
    out['preSelection']={'eligible':eligible,'score':score,'compoundedReturnPct':pre,'severeCompoundedReturnPct':pre_s,'positiveFolds':pn,'positiveSevereFolds':ps,'tradeEpisodes':trades,'worstFoldDrawdownPct':worst,'averageFoldProfitFactor':avg_pf}
    return out,normal,severe,entries

v10.build_a_opportunities=exact_a_opportunities
v10.evaluate=corrected_evaluate

if __name__=='__main__':
    v10.main()
