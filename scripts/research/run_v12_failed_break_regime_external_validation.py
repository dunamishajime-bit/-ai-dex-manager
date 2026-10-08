"""External validation for pre-specified failed-break BTC regime gate.

Research only. Rebuilds events from source H1 data, applies the already-fixed:
  FAILED_BREAK_REV_SHORT_6H + BTC6<=0 + BTC24<=+1.0%
then re-ranks simultaneous events and replays the unchanged legacy 46h exit.

The BTC thresholds were selected from Jan-2025..Aug-2026 pre-holdout diagnostics
before evaluating the post-2026-08-11 segment. No LIVE/Production changes.
"""
import collections
import datetime as dt
import json
from pathlib import Path
import run_v12_untouched_holdout as h

ROOT=h.ROOT
OUT=ROOT/'docs/research/results/v12-failed-break-btc-regime-external-validation-20261008'
FROZEN=Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines')
H=h.H

def iso(ms):
    return dt.datetime.fromtimestamp(ms/1000,dt.timezone.utc).isoformat()

def btc_ret(h1, entry_ts, hours):
    now=h1['BTCUSDT'].get(entry_ts-H)
    old=h1['BTCUSDT'].get(entry_ts-H-hours*H)
    if not now or not old:
        return None
    return now['close']/old['close']-1

def event_key(x):
    return (x['symbol'], int(x['entry_ts_ms']), x['side'])

def run_segment(name, data_path, start, data_end, require_parity=False):
    h.DATA=Path(data_path)
    h.START=start
    h.DATA_END=data_end
    h.ENTRY_END=data_end-46*H
    if require_parity:
        parity=json.loads((h.BASE/'parity-report.json').read_text(encoding='utf-8'))
        if parity.get('status')!='PASS_FETCH_AND_PRICE_PARITY':
            raise RuntimeError('holdout parity gate not passed')

    h1={s:h.load(s) for s in h.SYMS}
    h2={s:h.h2_series(h1[s]) for s in h.SYMS}
    maps={s:{b['end']:i for i,b in enumerate(a)} for s,a in h2.items()}
    raw=h.build_events(h1,h2,maps)

    gated=[]
    rejected=collections.Counter()
    for c in raw:
        b6=btc_ret(h1,int(c['entry_ts_ms']),6)
        b24=btc_ret(h1,int(c['entry_ts_ms']),24)
        if b6 is None or b24 is None:
            rejected['MISSING_BTC_FEATURE']+=1
            continue
        d=dict(c,btc6_gate_value=b6,btc24_gate_value=b24)
        if b6>0:
            rejected['BTC6_POSITIVE']+=1
            continue
        if b24>.01:
            rejected['BTC24_ABOVE_1PCT']+=1
            continue
        gated.append(d)

    selected=h.select(gated)
    trades=[]
    for c in selected:
        x=h.exit_legacy(c,h1[c['symbol']])
        if x is None:
            raise RuntimeError(f'incomplete exit coverage: {c}')
        trades.append(x)

    quarters=collections.defaultdict(list)
    months=collections.defaultdict(list)
    symbols=collections.defaultdict(list)
    for x in trades:
        d=dt.datetime.fromtimestamp(x['entry_ts_ms']/1000,dt.timezone.utc)
        quarters[f'{d.year}-Q{(d.month-1)//3+1}'].append(x)
        months[d.strftime('%Y-%m')].append(x)
        symbols[x['symbol']].append(x)

    report={
        'segment':name,
        'research_only':True,
        'production_changes':False,
        'rule':'FAILED_BREAK_REV_SHORT_6H + BTC6<=0 + BTC24<=+1.0%',
        'rule_changed_for_segment':False,
        'period':{
            'entry_start_inclusive':iso(start),
            'entry_end_exclusive':iso(h.ENTRY_END),
            'data_end_exclusive':iso(data_end),
        },
        'raw_events':len(raw),
        'gated_events':len(gated),
        'selected_events':len(selected),
        'completed_trades':len(trades),
        'rejected':dict(rejected),
        'costs':{str(c):h.stat(trades,c) for c in [10,20,30]},
        'by_quarter':{k:{str(c):h.stat(v,c) for c in [10,20,30]} for k,v in sorted(quarters.items())},
        'by_month':{k:{str(c):h.stat(v,c) for c in [10,20,30]} for k,v in sorted(months.items())},
        'by_symbol':{k:{str(c):h.stat(v,c) for c in [10,20,30]} for k,v in sorted(symbols.items())},
        'selected_event_keys':[list(event_key(x)) for x in selected],
    }
    return report,raw,gated,selected,trades

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    pre_start=int(dt.datetime(2025,1,11,tzinfo=dt.timezone.utc).timestamp()*1000)
    pre_end=int(dt.datetime(2025,8,10,tzinfo=dt.timezone.utc).timestamp()*1000)
    hold_start=int(dt.datetime(2026,8,11,tzinfo=dt.timezone.utc).timestamp()*1000)
    hold_end=int(dt.datetime(2026,10,8,tzinfo=dt.timezone.utc).timestamp()*1000)

    pre=run_segment('PRE_DEVELOPMENT_BACKCAST',FROZEN,pre_start,pre_end,False)
    hold=run_segment('POST_SELECTION_HOLDOUT',h.BASE/'data'/'klines',hold_start,hold_end,True)

    combined={
        'status':'COMPLETE_FROZEN_BTC_REGIME_EXTERNAL_VALIDATION',
        'research_only':True,
        'live_changes':False,
        'production_changes':False,
        'selection_audit':{
            'rule':'FAILED_BREAK_REV_SHORT_6H + BTC6<=0 + BTC24<=+1.0%',
            'threshold_selection_source':'Jan-2025..Aug-2026 pre-holdout diagnostics only',
            'post_2026_08_11_used_for_threshold_selection':False,
            'holdout_label':'post-selection holdout evaluation; no threshold changes allowed from these outcomes',
        },
        'pre_development':pre[0],
        'post_selection_holdout':hold[0],
        'interpretation_guard':'Passing a small holdout is not production proof; failure at stressed costs or low sample size remains material.'
    }
    (OUT/'report.json').write_text(json.dumps(combined,indent=2,allow_nan=True),encoding='utf-8')
    for prefix,pack in [('pre',pre),('holdout',hold)]:
        for fname,rows in [('raw-events',pack[1]),('gated-events',pack[2]),('selected',pack[3]),('trades',pack[4])]:
            (OUT/f'{prefix}-{fname}.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in rows),encoding='utf-8')

    print(json.dumps({
        'status':combined['status'],
        'pre':{
            'raw':pre[0]['raw_events'],'gated':pre[0]['gated_events'],'selected':pre[0]['selected_events'],
            'costs':pre[0]['costs'],'quarters':pre[0]['by_quarter'],
        },
        'holdout':{
            'raw':hold[0]['raw_events'],'gated':hold[0]['gated_events'],'selected':hold[0]['selected_events'],
            'costs':hold[0]['costs'],'months':hold[0]['by_month'],
        }
    },indent=2,allow_nan=True))

if __name__=='__main__':
    main()
