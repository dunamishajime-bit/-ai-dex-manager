"""Research-only mirror test for failed-break reversal LONG.

Pre-specified mirror of the SHORT BTC regime hypothesis:
- FAILED_BREAK_REV output side LONG
- BTC6 >= 0
- BTC24 >= -1.0%
No LIVE/Production changes.
"""
import collections
import json
from pathlib import Path
import run_v12_logic_dissection as s
import v12_entry_state_logic as m

ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-failed-break-long-mirror-20261008'
SRC=ROOT/'docs/research/results/v12-onset-state-machine-20261008/events.jsonl'
H=s.H

def btc_ret(c,hours):
    t=int(c['entry_ts_ms'])
    n=s.w.bars['BTCUSDT'].get(t-H)
    o=s.w.bars['BTCUSDT'].get(t-H-hours*H)
    return n['close']/o['close']-1 if n and o else None

def select(rows):
    groups=collections.defaultdict(list)
    for c in rows:
        groups[c['entry_ts_ms']].append(c)
    out=[]
    for ts,cs in sorted(groups.items()):
        for rank,c in enumerate(sorted(cs,key=lambda z:(-z['score'],z['symbol']))[:3],1):
            e=c['entry_price']; dist=max(2.477*c['atr'],e*.005)
            gross=min(1.,.0319/(dist/e))
            if rank==3:gross=min(.1,gross)
            x=m.exit_trade(dict(c,rank=rank,requested_gross=gross),s.w.bars[c['symbol']],structured=False)
            if x:out.append(x)
    return out

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    s.w.load_bars()
    rows=[json.loads(x) for x in SRC.read_text(encoding='utf-8').splitlines() if x.strip()]
    raw=[x for x in rows if x.get('route')=='FAILED_BREAK_REV' and x.get('side')=='LONG']
    gated=[]
    for c in raw:
        b6=btc_ret(c,6); b24=btc_ret(c,24)
        if b6 is None or b24 is None:continue
        if b6>=0 and b24>=-.01:
            gated.append(dict(c,btc6_gate_value=b6,btc24_gate_value=b24))
    trades=select(gated)
    def stats(z,cost):
        return s.stat([x['unit_gross_return']-cost/10000 for x in z])
    rep={
      'status':'COMPLETE_RESEARCH_ONLY',
      'rule':'FAILED_BREAK_REV_LONG + BTC6>=0 + BTC24>=-1.0%',
      'selection_basis':'Exact economic mirror of the pre-specified SHORT regime gate; no parameter sweep.',
      'research_only':True,'live_changes':False,
      'raw_events':len(raw),'gated_events':len(gated),'selected':len(trades),
      'all':{str(c):stats(trades,c) for c in [10,20,30]},
      'first':{str(c):stats([x for x in trades if x['exit_ts_ms']<s.MID],c) for c in [10,20,30]},
      'second':{str(c):stats([x for x in trades if x['entry_ts_ms']>=s.MID],c) for c in [10,20,30]},
    }
    (OUT/'report.json').write_text(json.dumps(rep,indent=2),encoding='utf-8')
    (OUT/'selected.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in gated),encoding='utf-8')
    (OUT/'trades.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in trades),encoding='utf-8')
    print(json.dumps(rep,indent=2))

if __name__=='__main__':
    main()
