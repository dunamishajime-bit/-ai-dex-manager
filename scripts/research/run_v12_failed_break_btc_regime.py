"""Integrated replay of V12 failed-break SHORT with dual BTC freshness/regime gate.

Frozen research candidate after pre-period + development diagnosis:
- original 6h failed-break reversal SHORT architecture
- BTC 6h return <= 0
- BTC 24h return <= +1.0%
No LIVE/Production changes.
"""
import contextlib, io, json
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as sens
import run_v12_logic_dissection as s
import v12_entry_state_logic as m

OUT=s.ROOT/'docs/research/results/v12-failed-break-btc6-btc24-20261008'
MID=s.MID
H=s.H

def btc_ret_at_entry(c,hours):
    now=int(c['entry_ts_ms'])
    bars=s.w.bars['BTCUSDT']
    a=bars.get(now-H);b=bars.get(now-H-hours*H)
    if not a or not b:return None
    return float(a['close'])/float(b['close'])-1

RAW=[]
for c in sens.events['WINDOW_6H']:
    b6=btc_ret_at_entry(c,6);b24=btc_ret_at_entry(c,24)
    if b6 is not None and b24 is not None and b6<=0 and b24<=.01:
        d=dict(c);d['btc6_gate_value']=b6;d['btc24_gate_value']=b24;RAW.append(d)
SELECTED=sens.select(RAW)

def read_table(strategy,variant='BASELINE'):
    return s.w.frozen_read(strategy,variant)

def filt(candidates,name):
    if name=='BASELINE_Q_RET14':return candidates
    out=[c for c in candidates if c['strategy_id']!='V12']
    for c in SELECTED:
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if not x:continue
        d=s.w.base.candidate(x,'V12')
        d.update(route='FAILED_BREAK_REV_SHORT_6H_BTC_REGIME',
                 entryQualityClass='ONSET_FAILED_BREAK_SHORT_6H_BTC_REGIME',
                 setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],
                 state_age_h=c['state_age_h'],btc6_gate_value=c['btc6_gate_value'],
                 btc24_gate_value=c['btc24_gate_value'])
        out.append(d)
    return out

def detail(a):
    d=s.w.stats(a)
    vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals)
    d['without_best_jpy']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0)
    return d

OUT.mkdir(parents=True,exist_ok=True)
protocol={
 'research_only':True,'live_changes':False,
 'variant':'FAILED_BREAK_REV_SHORT_6H + BTC6<=0 + BTC24<=+1.0%',
 'selection_basis':'Chosen from pre-holdout Jan-2025..Aug-2026 diagnostics; post-2026-08-11 data not used for threshold sweep.',
 'economic_rationale':'A failed upward breakout is not shorted while BTC is still rising over 6h or while the 24h BTC move remains strongly positive; avoids treating a one-bar pullback inside a strong market upswing as reversal.',
 'threshold_neighborhood':'BTC24 caps 0%, +0.5%, +1.0%, +1.5%, +2.0% were compared. 0.5% and 1.0% remained strong; 1.5% admitted the bad 2025-Q2 regime.',
 'exit':'Legacy V12 46h exit retained to isolate entry.',
 'costs_bps':[10,20,30]
}
(OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
(OUT/'raw-selected-events.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in SELECTED),encoding='utf-8')
s.w.OUT=OUT;s.w.setup();s.w.base.read_table=read_table;s.w.base._study_filter=filt
results=[]
for name in ['BASELINE_Q_RET14','FAILED_BREAK_REV_SHORT_6H_BTC_REGIME']:
    print('START',name,flush=True)
    r=s.w.base.run_study(name,'10,20,30');r['research_only']=True
    for sc in r['scenarios']:
        ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
        v=[x for x in ts if x['strategy_id']=='V12']
        sc['v12_details']={'all':detail(v),'first':detail([x for x in v if x['exit_ts_ms']<MID]),
                           'second':detail([x for x in v if x['entry_ts_ms']>=MID])}
    (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
    results.append(r);(OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print('DONE',name,flush=True)
print('RAW_ELIGIBLE',len(RAW),'SELECTED',len(SELECTED),flush=True)
