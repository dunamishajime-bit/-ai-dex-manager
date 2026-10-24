from pathlib import Path
import json,hashlib,collections,datetime
ROOT=Path('C:/tmp/render-mtf-study-20261024')
E=Path('C:/tmp/r4427c3/RENDER_4427_INDEPENDENT_ASOF_SELL55_NATIVE8_20261024/engine')
RUNS={10:['cmp_5bb26c207eb3','cmp_88139ccf92bb','cmp_d112f9aef1ff'],30:['cmp_2104321c587e','cmp_3a77ec7e46bd','cmp_433aa2452f5a']}
EXTRA='V12:TASK9_ADVERSE_SIDE_COOLDOWN'
ID_FIELDS={'candidate_id','event_seq','owner_candidate_id'}
def sha(o):return hashlib.sha256(json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def load(cost,rid):
    f=E/rid/rid/f'{cost}bps'/'cases'/'V2_M150_D05_CORE_NATIVE'/'runs'/f'PRICE_MODEL_{cost}BPS'/'candidate-decisions.jsonl'
    assert f.exists(),str(f)
    return [json.loads(s) for s in f.read_text(encoding='utf-8').splitlines()]
report={'status':'RESEARCH_ONLY_RAW_DECISION_SEMANTIC_PARITY_PROVEN_IDENTITY_PARITY_FAILED','owner_route_registered':False,'raw_sha_equal':False,'costs':{}}
for cost,ids in RUNS.items():
    runs=[load(cost,rid) for rid in ids]
    assert list(map(len,runs))==[2543,2523,2523]
    extras=[[x for x in rows if x.get('reason')==EXTRA] for rows in runs]
    assert list(map(len,extras))==[20,0,0]
    assert all(x.get('decision')=='REJECTED_PORTFOLIO' and x.get('strategy_id')=='V12' for x in extras[0])
    retained=[[x for x in rows if x.get('reason')!=EXTRA] for rows in runs]
    assert len({x['candidate_id'] for x in runs[0]})==len(runs[0])
    norm=[[{k:v for k,v in x.items() if k not in ID_FIELDS} for x in rows] for rows in retained]
    assert norm[0]==norm[1]==norm[2],f'SEMANTIC_DECISION_MISMATCH_{cost}'
    assert runs[1]==runs[2],f'RUN_2_3_RAW_MISMATCH_{cost}'
    accepted=[[x for x in rows if x.get('decision')=='ACCEPTED_MODELED_ENTRY'] for rows in retained]
    assert len({len(x) for x in accepted})==1
    independent=[x for x in accepted[1] if x.get('route')=='IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT']
    assert len(independent)==2
    assert all(x.get('reason')=='GROSS_ALLOCATED' for x in independent)
    assert all(0<x['accepted_gross']<=x['requested_gross'] for x in independent)
    report['costs'][str(cost)]={
       'raw_counts':[len(x) for x in runs],
       'first_only_v12_rejected':len(extras[0]),
       'first_only_v12_routes':dict(collections.Counter(x['route'] for x in extras[0])),
       'all_retained_decisions_identical_after_identity_fields_removed':True,
       'identity_fields_removed':sorted(ID_FIELDS),
       'retained_decisions':len(norm[0]),
       'semantic_decision_sha256':sha(norm[0]),
       'run_2_3_raw_equal':True,
       'accepted_count':len(accepted[1]),
       'new_render_accepted_gross':[{ 'entry_ts_ms':x['entry_ts_ms'],'requested':x['requested_gross'],'accepted':x['accepted_gross']} for x in independent],
       'extra_v12_rejected_semantic_sha256':sha([{k:v for k,v in x.items() if k not in ID_FIELDS} for x in extras[0]])
    }
report['limitations']=['Exact raw decision and candidate identity reproducibility remains FAIL: 20 rejected V12 candidates are missing from warm runs.','Root cause of first-run-only V12 candidate generation is not proven by this differential audit.','Owner/Route is not formally registered; safety gates and live venue fills/funding are not certified.','All historical windows previously explored; no untouched OOS.','VPS/LIVE/Production/HP/orders unchanged.']
p=ROOT/'RENDER_4427_RAW_DECISION_SEMANTIC_DIFF_AUDIT_20261025.json'
p.write_text(json.dumps(report,indent=2,ensure_ascii=False,sort_keys=True)+'\n',encoding='utf8')
lines=['# RENDER #4427 raw decision semantic diff audit (2026-10-25)','','STATUS: RESEARCH ONLY; not eligible for adoption.','']
for c in (10,30):
 a=report['costs'][str(c)]
 lines.extend([f"## {c}bps",f"- 3 raw decision files: {a['raw_counts']} rows; first run alone has 20 V12 adverse-side cooldown rejections.",f"- After removing only those 20 rejected rows and identity fields {a['identity_fields_removed']}, all {a['retained_decisions']} remaining candidate decisions match exactly in all 3 runs.",f"- Semantic decision SHA256: {a['semantic_decision_sha256']}",f"- Accepted entries per run: {a['accepted_count']}. New RENDER accepted gross: {a['new_render_accepted_gross']}.",''])
lines.extend(['## Decision','The only remaining semantic candidate-row discrepancy among the 3 runs is the presence of 20 first-run-only rejected V12 cooldown rows. No accepted candidate decision differs after identity normalization. This does not fix raw decision determinism and does not establish the source of the cold/warm discrepancy.','', 'Formal Owner/Route, all risk-gate parity, 2025 Aster H1 mark, venue fills and funding remain unverified. No production changes.',''])
md=ROOT/'RENDER_4427_RAW_DECISION_SEMANTIC_DIFF_AUDIT_20261025.md'
md.write_text('\n'.join(lines),encoding='utf8')
print(json.dumps({'status':report['status'],'report_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'costs':report['costs']},ensure_ascii=False))
