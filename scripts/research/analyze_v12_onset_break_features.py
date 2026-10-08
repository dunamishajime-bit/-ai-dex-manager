"""Diagnose ONSET_BREAK continuation vs failure using train-half thresholds and later-half validation."""
import json
import run_v12_momentum_onset as q
import run_v12_logic_dissection as s
import v12_entry_state_logic as m

OUT=s.ROOT/'docs/research/results/v12-momentum-onset-20261008'
s.w.load_bars()
pool=[json.loads(x) for x in (OUT/'onset_break-pool.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
cs=q.select(pool)
rows=[]
for c in cs:
    x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
    if not x:
        continue
    f=c['features']; sg=c['sg']; level=f['level_high'] if sg==1 else f['level_low']
    rows.append(dict(
        symbol=c['symbol'],side=c['side'],entry_ts_ms=c['entry_ts_ms'],net10=x['unit_gross_return']-.001,
        signed_ret6=sg*f['ret6'],signed_rel6=sg*f['rel6'],signed_btc6=sg*f['btc6'],
        clv=f['clv_long'] if sg==1 else f['clv_short'],body=f['body_atr'],vol=f['volume_ratio'],
        compression=f['compression'],er=f['previous_er'],mom=sg*c['momentum90'],
        breakout_atr=sg*(f['close']-level)/f['atr'],atr_ratio=f['atr']/f['close']
    ))

first=[x for x in rows if x['entry_ts_ms']<s.MID]
second=[x for x in rows if x['entry_ts_ms']>=s.MID]

def stat(a):
    vals=[x['net10'] for x in a]; n=len(vals)
    pos=sum(max(v,0) for v in vals); neg=-sum(min(v,0) for v in vals)
    return {'n':n,'win_rate':sum(v>0 for v in vals)/n if n else None,
            'pf':pos/neg if neg else None,'mean':sum(vals)/n if n else None,
            'sum':sum(vals)}

features=['signed_ret6','signed_rel6','signed_btc6','clv','body','vol','compression','er','mom','breakout_atr','atr_ratio']
tests=[]
for feat in features:
    vals=sorted(x[feat] for x in first)
    for quantile in (0.25,0.50,0.75):
        idx=min(len(vals)-1,int(quantile*(len(vals)-1)))
        threshold=vals[idx]
        for op in ('GE','LE'):
            if op=='GE':
                a=[x for x in first if x[feat]>=threshold]
                b=[x for x in second if x[feat]>=threshold]
            else:
                a=[x for x in first if x[feat]<=threshold]
                b=[x for x in second if x[feat]<=threshold]
            A=stat(a); B=stat(b)
            if A['n']>=40 and B['n']>=40:
                tests.append({'feature':feat,'op':op,'quantile':quantile,'threshold':threshold,
                              'train':A,'later':B,'min_pf':min(A['pf'] or 0,B['pf'] or 0),
                              'min_mean':min(A['mean'] or 0,B['mean'] or 0)})
tests.sort(key=lambda x:(x['min_pf'],x['min_mean']),reverse=True)

symbols={}
for sym in sorted({x['symbol'] for x in rows}):
    a=[x for x in first if x['symbol']==sym]; b=[x for x in second if x['symbol']==sym]
    if len(a)+len(b)>=10:
        symbols[sym]={'first':stat(a),'second':stat(b)}

out={
    'method':'Thresholds are first-half 25/50/75 percentiles; later half is evaluated without refitting.',
    'baseline':{'first':stat(first),'second':stat(second)},
    'top_single_feature_tests':tests[:50],
    'symbol_split':symbols,
    'side_split':{
        'first_LONG':stat([x for x in first if x['side']=='LONG']),
        'second_LONG':stat([x for x in second if x['side']=='LONG']),
        'first_SHORT':stat([x for x in first if x['side']=='SHORT']),
        'second_SHORT':stat([x for x in second if x['side']=='SHORT'])
    }
}
(OUT/'onset-break-feature-screen.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps(out,indent=2))
