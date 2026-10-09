"""Conservative walk-forward V4 priority study.
Train route ranks/gross only on historical exits BEFORE fixed cutoff.
Then replay across full timeline and evaluate validation trades after the cutoff.
No LIVE/Production changes; exploratory second-pass repair rules still selected
on the development window, therefore NOT a clean external OOS validation.
"""
import contextlib, io, json, math, statistics, collections
from pathlib import Path

with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_v4_priority_gross_v2_sweep as v2

ROOT = v2.ROOT
OUT = ROOT / "docs/research/results/v12-v4-priority-forward-split-20261009"
MID = 1778457600000
TRAIN_END = MID
TRAIN_SOURCE = ROOT / "docs/research/results/v12-v4-route-repair-secondpass-integrated-20261009/cases/SECONDPASS/runs/PRICE_MODEL_30BPS/portfolio-trades.jsonl"
REFERENCE = ROOT / "docs/research/results/v12-v4-priority-gross-v2-stress-20261009/comparison-summary.json"

def rows(p):
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]

def pf(vals):
    p=sum(max(0,x) for x in vals); l=-sum(min(0,x) for x in vals)
    return p/l if l else (999 if p else 0)

def clip(x,a,b):return max(a,min(b,x))
def scale(x,a,b):return clip((x-a)/(b-a),0,1)
def route_scores(trades):
    by=collections.defaultdict(list)
    for x in trades:
        if x.get("strategy_id")=="V12" and int(x["exit_ts_ms"])<TRAIN_END:
            by[x.get("route")].append(x)
    trained=[]
    # Every selected route without prior closed-trade evidence receives tier D.
    known=[x["route"] for x in v2.SCORES]
    for route in known:
        sample=by[route]
        returns=[x["total_pnl_jpy"]/x["notional_entry_jpy"] for x in sample if x.get("notional_entry_jpy")]
        net=[x["total_pnl_jpy"] for x in sample]
        n=len(sample); wins=sum(x>0 for x in net)
        # Same .60 win-rate prior as V2, no future second-half PF.
        shrunk=(wins+12)/(n+20)
        mean=statistics.mean(returns) if returns else 0
        p=pf(net)
        q10=statistics.quantiles(returns,n=10,method="inclusive")[0] if len(returns)>=10 else min(returns or [0])
        conf=min(1,n/40)
        # Explicit no look-ahead: use train-only metrics, score emphasizes
        # stress mean, shrunk WR, PF, tail and sample count.
        score=100*(.32*scale(shrunk,.45,.8)+.30*scale(mean,0,.03)+
            .23*scale(math.log(max(p,.01)),0,math.log(3))+.15*conf)
        score-=100*.15*scale(-q10,.05,.12)
        if sum(net)<0:score-=18
        if n<8:score=min(score,49.0)
        score=clip(score,0,100)
        tier='S' if score>=80 else 'A' if score>=70 else 'B' if score>=60 else 'C' if score>=50 else 'D'
        gross={'S':.40,'A':.30,'B':.20,'C':.12,'D':.05}[tier]
        trained.append({'route':route,'n_train':n,'wins_train':wins,'train_win_rate':wins/n if n else None,
           'train_pf30':p,'train_mean_return30':mean,'train_net_jpy':sum(net),
           'train_q10_return30':q10,'score':score,'tier':tier,'gross':gross})
    trained.sort(key=lambda x:(-x["score"],-x["n_train"],x["route"]))
    for i,x in enumerate(trained,1):
        x['priority_order']=i
        x['priority_rank']=None if x['route']==v2.CORE else i+3
    return trained

def split_detail(rows):
    x=v2.s.w.stats(rows)
    return {'trades':x.get('trades'),'win_rate':x.get('win_rate'),'pf_usd':x.get('pf_usd'),'net_pnl_usd':x.get('net_pnl_usd')}

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    train_rows=route_scores(rows(TRAIN_SOURCE))
    (OUT/'training-only-priority.json').write_text(json.dumps(train_rows,ensure_ascii=False,indent=2),encoding='utf-8')
    protocol={'research_only':True,'live_changes':False,'production_changes':False,
        'train_end_exclusive_ms':TRAIN_END,
        'rank_source':'ONLY V12 exits before train_end from secondpass 30bps portfolio trades',
        'validation':'V12 accepted rows with entry >= train_end; first/second parts never mixed in scoring',
        'caution':'SECOND repair feature selection used full 2025-2026 study. This is only priority-score forward split, not untouched holdout.',
        'caps':v2.CAP,'cases':{
            'FW_M150_D05_CORE_NATIVE':{'mult':1.5,'d':.05,'core':'native'},
            'FW_M150_D05_CORE_TIER':{'mult':1.5,'d':.05,'core':'tier'},
        },
        'costs_bps':[10,20,30]}
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    v2.SCORES=train_rows
    v2.SCORE={x['route']:x for x in train_rows}
    v2.CASES=protocol['cases']
    v2.OUT=OUT
    s=v2.s
    s.w.OUT=OUT
    s.w.setup()
    v2.v4.install_virtual_leg_study_adapter()
    v2.final.install_final_routes()
    v2.v3.stage3_transform=v2.final.stage3_candidate_all
    v2.v3.FAILED=v2.ml.failed_candidates()
    v2.v3.v2.FAILED=v2.v3.FAILED
    s.w.base.source_batch=v2.ind.custom_source_batch
    s.w.base.read_table=v2.v3.v2.read_table
    basepatch=s.w.base.patch_admission
    outputs=[]
    for name,cfg in v2.CASES.items():
        v2.v3.CASE[name]={'family_cap':v2.CAP['family'],'gross':.10,'slots':16}
        v2.ind.ACTIVE_RECOVERY_CAP=v2.CAP['family']
        v2.mlift.MAX_LIFT_GROSS=.30
        v2.ind.ORIG_PATCH=basepatch
        s.w.base.patch_admission=v2.patch
        s.w.base._study_filter=v2.make_filter(name,cfg)
        print('START',name,flush=True)
        z=s.w.base.run_study(name,'10,20,30')
        z['cfg']={**v2.CAP,**cfg}
        for scenario in z['scenarios']:
            t=rows(OUT/'cases'/name/'runs'/scenario['scenario_id']/'portfolio-trades.jsonl')
            vv=[x for x in t if x['strategy_id']=='V12']
            train=[x for x in vv if x['exit_ts_ms']<MID]
            valid=[x for x in vv if x['entry_ts_ms']>=MID]
            scenario['v12_details']={
                'all':split_detail(vv),'pre_cutoff':split_detail(train),
                'validation_post_cutoff':split_detail(valid),
                'utilization':v2.util(vv)}
        outputs.append(z)
        (OUT/'comparison-summary.json').write_text(json.dumps(outputs,ensure_ascii=False,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)
if __name__=='__main__':main()
