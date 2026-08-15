"""Manifest-based extended V96+ trade harvest.

Uses the already frozen metadata inventory, so it performs no repository-wide artifact
listing. Selection is outcome-blind and based only on artifact name/branch/version
metadata: likely trade-bearing research artifacts (loss/audit/trade/entry/diagnosis/
episode/attribution/records/clean/ownership/router/backtest/replay/forward/pair).
Explicit pre-V96 versions are excluded. Winner features are not inspected.
"""
from __future__ import annotations
import json,os,re
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
import research_loss_only_trade_harvest as h
import research_loss_only_trade_harvest_redirect_safe as safe

NAME_RE=re.compile(r'(?i)(loss|audit|trade|entry|diagnos|episode|attribution|records|clean|ownership|router|backtest|replay|forward|pair)')
INCLUDE_BRANCH_TERMS=("research/win80-profit-optimization","research/v96","chatgpt/3y-entry","chatgpt/pairwise","chatgpt/router","codex/priority-router","codex/router-v","research/equal-gross","research/pengu-dual")
EXCLUDE_BRANCH_TERMS=("aster-only","stock","market-hours-preflight","production","live-promotion","v52-market-hours","feature/v96")
h.req_bytes=safe.redirect_safe_bytes
h.RETURN_KEYS=safe.h.RETURN_KEYS;h.MFE_KEYS=safe.h.MFE_KEYS;h.MAE_KEYS=safe.h.MAE_KEYS

def select(inv):
    rows=[]
    for m in inv['candidateArtifactManifest']:
        nm=m.get('name','');br=(m.get('branch') or '').lower();vs=m.get('versionsInName') or h.versions(nm)
        explicit=any(int(v)>=96 for v in vs);inc=any(x in br for x in INCLUDE_BRANCH_TERMS);exc=any(x in br for x in EXCLUDE_BRANCH_TERMS)
        if not NAME_RE.search(nm) or exc or not (explicit or inc) or int(m.get('size') or 0)>h.MAX_ARTIFACT_BYTES:continue
        if vs and max(int(v) for v in vs)<96 and not inc:continue
        rows.append({'id':m['id'],'name':nm,'size_in_bytes':m.get('size',0),'created_at':m.get('createdAt'),'expired':False,'workflow_run':{'id':m.get('runId'),'head_sha':m.get('headSha'),'head_branch':m.get('branch')}})
    uniq={}
    for a in sorted(rows,key=lambda x:x['created_at'] or ''):uniq[(a['name'],a['workflow_run'].get('head_sha'))]=a
    return list(uniq.values())
def main():
    inv=json.loads(Path(os.environ['LOSS_ONLY_INVENTORY_PATH']).read_text());chosen=select(inv);results=[]
    with ThreadPoolExecutor(max_workers=10) as ex:
        fs=[ex.submit(h.process_artifact,a) for a in chosen]
        for i,f in enumerate(as_completed(fs),1):
            results.append(f.result())
            if i%50==0:print(f'EXTENDED_HARVEST_PROGRESS {i}/{len(fs)}',flush=True)
    rec=[]
    for x in results:rec.extend(x['records'])
    uniq={}
    for r in rec:
        v=r.get('version');br=str(r.get('branch') or '').lower()
        if isinstance(v,(int,float)) and int(v)<96:continue
        if 'research/v71' in br and (v is None or int(v)<96):continue
        k=(r['sourceFamily'],r['symbol'],r['side'],r['entryTs'],r['exitTs'],round(r['returnPct'],8),r['mode']);uniq[k]=r
    rec=sorted(uniq.values(),key=lambda r:(r['entryTs'],r['sourceFamily'],r['symbol']));los=[r for r in rec if r['loser']]
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True)
    for name,rows in [('loss-only-extended-normalized-trades.jsonl',rec),('loss-only-extended-losing-trades.jsonl',los)]:
        with (root/name).open('w',encoding='utf-8') as f:
            for r in rows:f.write(json.dumps(r,sort_keys=True)+'\n')
    s={'researchLine':'LOSS_ONLY_EXTENDED_MANIFEST_HARVEST','researchOnly':True,'selectionOutcomeBlind':True,'winnerFeaturesInspected':False,'blockersSelected':False,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'selectedArtifacts':len(chosen),'selectedArtifactBytes':sum(int(a['size_in_bytes'] or 0) for a in chosen),'downloadErrors':sum(bool(x['error']) for x in results),'machineReadableFilesScanned':sum(x['files'] for x in results),'normalizedTradeRecords':len(rec),'losingRecords':len(los),'sourceFamilies':len({r['sourceFamily'] for r in rec}),'symbolCounts':{s:sum(r['symbol']==s for r in rec) for s in h.SYMS},'partitionCounts':{p:sum(r['partition']==p for r in rec) for p in ('LOSS_DISCOVERY','LOSS_VALIDATION')},'errorExamples':[x['error'] for x in results if x['error']][:20]}
    (root/'loss-only-extended-harvest-summary.json').write_text(json.dumps(s,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(s,indent=2,sort_keys=True))
if __name__=='__main__':main()
