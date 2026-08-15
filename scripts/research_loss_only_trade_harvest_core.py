"""High-confidence trade-bearing V96+ harvest used as a fast, schema-complete core set.

Selection is metadata-only and fixed before outcomes: artifact names must indicate
loss/audit/trade/entry/diagnosis/episode/attribution. This complements the broad
harvest; it does not replace it. Winner features are not inspected here.
"""
from __future__ import annotations
import json,os,re
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
import research_loss_only_trade_harvest as h

NAME_RE=re.compile(r"(?i)(loss|audit|trade|entry|diagnos|episode|attribution|records)")
INCLUDE_BRANCH_TERMS=("research/win80-profit-optimization","research/v96","chatgpt/3y-entry","chatgpt/pairwise","chatgpt/router","codex/priority-router","codex/router-v","research/equal-gross","research/pengu-dual")
EXCLUDE_BRANCH_TERMS=("aster-only","stock","market-hours-preflight","production","live-promotion","v52-market-hours","feature/v96")

# Schema expansion based only on known machine-readable record formats.
h.RETURN_KEYS=("netContributionPct","netReturnPct","net_return_pct","netPct","net_pct","tradeReturnPct","trade_return_pct","netPnlPct","net_pnl_pct","pnlPct","pnl_pct","returnPct","return_pct","profitPct","roiPct","pnl")
h.MFE_KEYS=("mfePct","mfe_pct","mfe","maxFavorablePct","maxFavorable","maxFavorablePct")
h.MAE_KEYS=("maePct","mae_pct","mae","maxAdversePct","maxAdverse")

def choose(arts):
    v96=[a for a in arts if 96 in h.versions(a.get('name',''))]
    if not v96:raise RuntimeError('NO_EXPLICIT_V96')
    cutoff=min(a['created_at'] for a in v96);out=[]
    for a in arts:
        if a.get('expired') or a.get('created_at','')<cutoff:continue
        nm=a.get('name','');br=((a.get('workflow_run') or {}).get('head_branch') or '').lower()
        if not NAME_RE.search(nm) or h.EXCLUDE_NAME_RE.search(nm):continue
        explicit=any(v>=96 for v in h.versions(nm));inc=any(x in br for x in INCLUDE_BRANCH_TERMS);exc=any(x in br for x in EXCLUDE_BRANCH_TERMS)
        if (explicit or inc) and not exc and int(a.get('size_in_bytes') or 0)<=h.MAX_ARTIFACT_BYTES:out.append(a)
    uniq={}
    for a in sorted(out,key=lambda x:x['created_at']):uniq[(a.get('name'),((a.get('workflow_run') or {}).get('head_sha')))]=a
    return cutoff,list(uniq.values())

def main():
    arts=h.list_artifacts();cutoff,chosen=choose(arts);results=[]
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs=[ex.submit(h.process_artifact,a) for a in chosen]
        for i,f in enumerate(as_completed(futs),1):
            results.append(f.result())
            if i%50==0:print(f'CORE_HARVEST_PROGRESS {i}/{len(futs)}',flush=True)
    records=[]
    for x in results:records.extend(x['records'])
    uniq={}
    for r in records:
        key=(r['sourceFamily'],r['symbol'],r['side'],r['entryTs'],r['exitTs'],round(r['returnPct'],8),r['mode']);uniq[key]=r
    records=sorted(uniq.values(),key=lambda r:(r['entryTs'],r['sourceFamily'],r['symbol']));losers=[r for r in records if r['loser']]
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True)
    for name,rows in [('loss-only-core-normalized-trades.jsonl',records),('loss-only-core-losing-trades.jsonl',losers)]:
        with (root/name).open('w',encoding='utf-8') as f:
            for r in rows:f.write(json.dumps(r,sort_keys=True)+'\n')
    summary={'researchLine':'LOSS_ONLY_TRADE_HARVEST_CORE','researchOnly':True,'winnerFeaturesInspected':False,'blockersSelected':False,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'earliestExplicitV96CreatedAt':cutoff,'selectedArtifacts':len(chosen),'selectedArtifactBytes':sum(int(a.get('size_in_bytes') or 0) for a in chosen),'downloadErrors':sum(bool(x['error']) for x in results),'machineReadableFilesScanned':sum(x['files'] for x in results),'normalizedTradeRecords':len(records),'losingRecords':len(losers),'winningOrFlatRecords':len(records)-len(losers),'sourceFamilies':len({r['sourceFamily'] for r in records}),'symbolCounts':{s:sum(r['symbol']==s for r in records) for s in h.SYMS},'partitionCounts':{p:sum(r['partition']==p for r in records) for p in ('LOSS_DISCOVERY','LOSS_VALIDATION')},'errorExamples':[x['error'] for x in results if x['error']][:20]}
    (root/'loss-only-core-harvest-summary.json').write_text(json.dumps(summary,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(summary,indent=2,sort_keys=True))
if __name__=='__main__':main()
