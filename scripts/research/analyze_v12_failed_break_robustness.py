"""Robustness diagnostics for V12 failed-break reversal SHORT candidate.
Research-only: leave-one-symbol/month-out, rolling calendar buckets, and deterministic month-block bootstrap.
"""
import json, collections, datetime, random, statistics
import run_v12_failed_break_short as fb
import run_v12_logic_dissection as s
import v12_entry_state_logic as m

OUT=s.ROOT/'docs/research/results/v12-failed-break-short-20261008'

selected,trades=fb.prepare()
rows=[]
for x in trades:
    dt=datetime.datetime.fromtimestamp(x['entry_ts_ms']/1000,datetime.timezone.utc)
    rows.append({
      'symbol':x['symbol'],'month':dt.strftime('%Y-%m'),'entry_ts_ms':x['entry_ts_ms'],
      'gross':x['unit_gross_return']
    })

def stat(rs,cost):
    vals=[x['gross']-cost/10000 for x in rs];n=len(vals)
    pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals)
    return {'n':n,'win_rate':sum(v>0 for v in vals)/n if n else None,
            'pf':pos/neg if neg else None,'mean':sum(vals)/n if n else None,
            'sum':sum(vals),'without_best':sum(vals)-max(vals) if vals else None}

symbols=sorted({x['symbol'] for x in rows})
months=sorted({x['month'] for x in rows})
report={'n':len(rows),'costs':{}}
for cost in (10,20,30):
    base=stat(rows,cost)
    los={sym:stat([x for x in rows if x['symbol']!=sym],cost) for sym in symbols}
    lom={mon:stat([x for x in rows if x['month']!=mon],cost) for mon in months}
    report['costs'][str(cost)]={
      'base':base,
      'leave_one_symbol_out':los,
      'leave_one_symbol_out_min_pf':min((v['pf'] or 0) for v in los.values()),
      'leave_one_symbol_out_min_mean':min(v['mean'] for v in los.values()),
      'leave_one_month_out':lom,
      'leave_one_month_out_min_pf':min((v['pf'] or 0) for v in lom.values()),
      'leave_one_month_out_min_mean':min(v['mean'] for v in lom.values()),
    }

# Calendar quarter-like 3-month chunks, fixed sequential bins from first observed month.
def month_index(m):
    y,mo=map(int,m.split('-'));return y*12+mo
m0=min(month_index(m) for m in months)
chunks=collections.defaultdict(list)
for x in rows:
    idx=(month_index(x['month'])-m0)//3
    chunks[idx].append(x)
report['three_month_chunks']={str(k):{'months':sorted({x['month'] for x in v}),
    '10':stat(v,10),'20':stat(v,20),'30':stat(v,30)} for k,v in sorted(chunks.items())}

# Deterministic month-block bootstrap. Resample whole months with replacement to preserve within-month clustering.
rng=random.Random(20261008)
month_rows={m:[x for x in rows if x['month']==m] for m in months}
for cost in (10,20,30):
    means=[];pfs=[]
    for _ in range(5000):
        sample=[]
        for m in (rng.choice(months) for __ in months):
            sample.extend(month_rows[m])
        z=stat(sample,cost)
        means.append(z['mean']);pfs.append(z['pf'] or 0)
    means.sort();pfs.sort()
    report['costs'][str(cost)]['month_block_bootstrap']={
      'mean_p025':means[int(.025*len(means))],
      'mean_median':means[int(.5*len(means))],
      'mean_p975':means[int(.975*len(means))-1],
      'pf_p025':pfs[int(.025*len(pfs))],
      'pf_median':pfs[int(.5*len(pfs))],
      'pf_p975':pfs[int(.975*len(pfs))-1],
      'prob_mean_positive':sum(v>0 for v in means)/len(means),
      'prob_pf_gt1':sum(v>1 for v in pfs)/len(pfs),
    }

(OUT/'robustness-diagnostic.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
