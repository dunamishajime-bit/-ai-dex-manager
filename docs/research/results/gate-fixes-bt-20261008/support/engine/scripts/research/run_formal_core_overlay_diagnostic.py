"""Causal ownership-corrected Core + retained Overlay price-model comparisons.

Not LIVE certification: closed candidate lifecycle inputs do not provide all
hourly baseline runner evidence, pending/latency or historical margin proofs.
Missing source is BLOCKED, never patched with historical timestamp membership.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from scripts.research.formal_core_live_ownership import load_ownership_engine
from scripts.research.formal_core_ownership_audit import find_ownership_conflicts, rows, GATED_SHA

H=3600000


def lifecycle(candles, ts, side, hold, end):
    entry=candles.get(ts)
    if not entry:return None,'ENTRY_BAR_MISSING'
    price=float(entry['open'])
    sign=1 if side=='LONG' else -1
    stop=price*(1-sign*.10);tp=price*(1+sign*.25)
    for t in range(ts,ts+hold*H,H):
        b=candles.get(t)
        if not b:return None,'EXIT_CHAIN_GAP'
        # Conservative deterministic H1 treatment if STOP and TP both touch.
        stopped=float(b['low'])<=stop if sign==1 else float(b['high'])>=stop
        taken=float(b['high'])>=tp if sign==1 else float(b['low'])<=tp
        if stopped:return (t+H,stop,'OVERLAY_HARD_STOP'),'STOP_FIRST_H1'
        if taken:return (t+H,tp,'OVERLAY_TAKE_PROFIT'),'STOP_FIRST_H1'
    exit_ts=ts+hold*H
    if exit_ts>end:return None,'OPEN_AT_SAMPLE_END'
    b=candles.get(exit_ts)
    return ((exit_ts,float(b['open']),'OVERLAY_HOLD') if b else None),'HOLD_BAR' if b else 'HOLD_BAR_MISSING'


def overlay_candidates(features, data, include_doge, include_avax, end):
    out=[];issues=Counter()
    cache={}
    def candle(symbol):
        if symbol not in cache:
            cache[symbol]={int(r['event_time_ms']):r for r in rows(data/'normalized/aster/klines'/f'{symbol}.jsonl')}
        return cache[symbol]
    for f in features:
        ts=f['decisionTs'];current=not f['errors']
        stream=[]
        for x in f['idle']:
            if x['generic']['accepted']:
                stream.append(('IDLE',x['symbol'],x['signal']['accepted'],x['signal']['route'],
                               x['signal']['holdHours'],x['generic']['side'],True,0))
        if not stream:
            # Clock-only probe: never allocates, enables current source audit.
            stream.append(('IDLE','BTCUSDT',False,'CLOCK_PROBE',1,'SHORT',False,0))
        for x in f['long']:
            if x['accepted'] and ((x['symbol']=='DOGEUSDT' and include_doge) or
                                  (x['symbol']=='AVAXUSDT' and include_avax)):
                stream.append(('RESIDUAL',x['symbol'],True,x['route'],12,'LONG',False,x['priority']))
        for role,symbol,selected,route,hold,side,generic,rank in stream:
            bars=candle(symbol);entry=bars.get(ts)
            outcome,reason=lifecycle(bars,ts,side,hold,end) if selected else ((ts+H, float(entry['open']) if entry else 1.,'NO_ORDER_PROBE'),'NO_ORDER_PROBE')
            if selected and not outcome:issues[reason]+=1
            valid=bool(outcome and entry and outcome[0]<=end)
            out.append({'strategy_id':role,'symbol':symbol,'side':side,'signal_ts_ms':ts-H,
                        'entry_ts_ms':ts,'entry_price':float(entry['open']) if entry else 1.,
                        'exit_ts_ms':outcome[0] if outcome else end+H,
                        'exit_price':outcome[1] if outcome else 1.,
                        'exit_reason':outcome[2] if outcome else reason,
                        'requested_gross':1.,'status':'MODELED_CLOSED_TRADE' if valid else 'UNRESOLVED_OVERLAY_EXIT',
                        'route':route,'rank':rank,'generic_accepted':generic,'route_selected':selected,
                        'overlay_source_current':current,'overlay_role':role,'source_runtime_sha':'53eeff5417636369d4709fddfd47d7916ddcf3b1'})
    return out,dict(issues)


def run(data, candidate_root, v52, features_path, output, costs=(8,10,20,30)):
    features=rows(features_path)
    cases=[('CORE',False,False,False),('CORE_IDLE',True,False,False),
           ('CORE_IDLE_DOGE',True,True,False),('CORE_IDLE_AVAX',True,False,True),
           ('CORE_IDLE_DOGE_AVAX',True,True,True)]
    summaries=[];source_issues={}
    if hashlib.sha256((candidate_root/'crypto-price-model-candidates.jsonl').read_bytes()).hexdigest()!=GATED_SHA:
        raise ValueError('CORE_CANDIDATE_INPUT_SHA_MISMATCH')
    for case,idle,doge,avax in cases:
        m=load_ownership_engine()
        extra,issues=overlay_candidates(features,data,doge,avax,m.PERIOD_END_MS) if idle else ([],{})
        source_issues[case]=issues
        original_rows=m._rows
        m._rows=lambda path, read=original_rows, extras=extra: read(path)+extras if Path(path)==candidate_root/'crypto-price-model-candidates.jsonl' else read(path)
        result=m.run_portfolio_model(data,candidate_root,output/case,v52_ledger_root=v52,
            ecb_fx_root=data,cost_scenarios=tuple((f'PRICE_MODEL_{c}BPS',float(c)) for c in costs),
            research_risk_caps={'Q102_BRK':.75,'Q102_MR':.75,'FET':1.})
        for s in result['scenarios']:
            scenario=output/case/s['scenario_id'];trades=rows(scenario/'portfolio-trades.jsonl')
            conflicts=find_ownership_conflicts(trades)
            if conflicts:raise ValueError('OWNERSHIP_CONFLICT_AFTER_GATE')
            if s['accounting_reconciliation']['status']!='PASS':raise ValueError('ACCOUNTING_FAILURE')
            summary={k:s[k] for k in ('scenario_id','final_equity_jpy','profit_factor','maximum_mtm_drawdown','closed_trades','strategy_trades','strategy_pnl_jpy','rejected_entries','monthly_equity_jpy')}
            summary.update(configuration=case,ownership_conflicts=0)
            summaries.append(summary);print(json.dumps({k:v for k,v in summary.items() if k not in ('monthly_equity_jpy','rejected_entries','strategy_pnl_jpy')}),flush=True)
    report={'status':'BLOCKED_OVERLAY_FULL_H1_BASELINE_EVIDENCE_AND_MARGIN_PARITY_NOT_PROVEN',
            'scope':'DIAGNOSTIC_PRICE_MODEL_NOT_LIVE_CERTIFICATION',
            'historical_1275_anchor_unchanged':True,'source_incomplete_hours':sum(bool(f['errors']) for f in features),
            'source_error_counts':dict(Counter(e['symbol']+':'+e['reason'] for f in features for e in f['errors'])),
            'lifecycle_source_issues':source_issues,'scenarios':summaries,
            'unproven':['complete current-H1 baseline eligibility/no-signal evidence, not just lifecycle candidate stream',
                        'LIVE pending reservations, asynchronous fill and account-lock ordering',
                        'historical account available margin, liquidation buffer and venue filters',
                        'all-symbol source errors hold existing residual LONG in LIVE; diagnostic only models blocked admission'],
            'files':[]}
    for p in sorted(output.rglob('*')):
        if p.is_file():report['files'].append({'path':p.relative_to(output).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    (output/'comparison-manifest.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf8')
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--baseline-root',type=Path,required=True)
    p.add_argument('--candidate-root',type=Path,required=True);p.add_argument('--features',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--costs',nargs='+',type=int,default=[8,10,20,30])
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    run(a.baseline_root/'market-Aster-H1-funding-and-manifests',a.candidate_root,
        a.baseline_root/'v52-SHA-verified-original-ledger',a.features,a.output,tuple(a.costs))
