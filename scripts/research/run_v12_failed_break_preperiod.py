"""Pre-development temporal backcast of the already-frozen V12 6h failed-break SHORT rule.

This is NOT labeled untouched because the project may have examined 2025 data elsewhere.
It is used only as an independent regime/time-direction robustness check. No tuning.
"""
import collections, datetime as dt, json
from pathlib import Path
import run_v12_untouched_holdout as h

OUT=h.ROOT/'docs/research/results/v12-failed-break-short-6h-preperiod-20261008'
FROZEN=Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines')
h.DATA=FROZEN
h.START=int(dt.datetime(2025,1,11,tzinfo=dt.timezone.utc).timestamp()*1000)
h.DATA_END=int(dt.datetime(2025,8,10,tzinfo=dt.timezone.utc).timestamp()*1000)
h.ENTRY_END=h.DATA_END-46*h.H

def iso(ms):return dt.datetime.fromtimestamp(ms/1000,dt.timezone.utc).isoformat()

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    h1={s:h.load(s) for s in h.SYMS};h2={s:h.h2_series(h1[s]) for s in h.SYMS};maps={s:{b['end']:i for i,b in enumerate(a)} for s,a in h2.items()}
    ev=h.build_events(h1,h2,maps);sel=h.select(ev);tr=[]
    for c in sel:
        x=h.exit_legacy(c,h1[c['symbol']])
        if x:tr.append(x)
    months=collections.defaultdict(list);symbols=collections.defaultdict(list);quarters=collections.defaultdict(list)
    for x in tr:
        d=dt.datetime.fromtimestamp(x['entry_ts_ms']/1000,dt.timezone.utc)
        months[d.strftime('%Y-%m')].append(x);symbols[x['symbol']].append(x);quarters[f'{d.year}-Q{(d.month-1)//3+1}'].append(x)
    rep={
      'status':'COMPLETE_PRE_DEVELOPMENT_BACKCAST_NOT_UNTOUCHED',
      'research_only':True,'rule_changed':False,
      'period':{'entry_start':iso(h.START),'entry_end_exclusive':iso(h.ENTRY_END),'data_end':iso(h.DATA_END)},
      'selected':len(sel),'completed':len(tr),
      'costs':{str(c):h.stat(tr,c) for c in [10,20,30]},
      'by_quarter':{k:{str(c):h.stat(v,c) for c in [10,20,30]} for k,v in sorted(quarters.items())},
      'by_month':{k:{str(c):h.stat(v,c) for c in [10,20,30]} for k,v in sorted(months.items())},
      'by_symbol':{k:{str(c):h.stat(v,c) for c in [10,20,30]} for k,v in sorted(symbols.items())},
      'note':'This period precedes the Aug-2025..Aug-2026 development window, but is not claimed globally untouched.'
    }
    (OUT/'events.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in ev),encoding='utf-8')
    (OUT/'trades.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in tr),encoding='utf-8')
    (OUT/'report.json').write_text(json.dumps(rep,indent=2,allow_nan=True),encoding='utf-8')
    print(json.dumps(rep,indent=2,allow_nan=True))
if __name__=='__main__':main()
