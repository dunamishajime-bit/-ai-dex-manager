"""Instrumentation-only side/book diagnosis for frozen V11.
No strategy changes; no Fresh OOS; no production paths.
"""
from __future__ import annotations
import json, os
from pathlib import Path
from typing import Any
import research_persistent_opportunity_ownership_v11 as v11


def diag(records:list[dict[str,Any]])->dict[str,Any]:
    side={'LONG':{'gross':0.0,'intervals':0},'SHORT':{'gross':0.0,'intervals':0}}
    pair={s:{'LONG':0.0,'SHORT':0.0} for s in v11.TRADE}
    initial={'gross':0.0,'intervals':0}; continuation={'gross':0.0,'intervals':0}
    prev_book=None
    books=[]; current=None
    for r in records:
        weights={str(k):float(v) for k,v in r.get('weights',{}).items()}
        key=tuple(sorted((s,1 if w>0 else -1) for s,w in weights.items()))
        gross=sum(float(x.get('pnlPct',0)) for x in r.get('legs',[]))
        if weights:
            sd='LONG' if sum(weights.values())>0 else 'SHORT' if sum(weights.values())<0 else 'MIXED'
            if sd in side:
                side[sd]['gross']+=gross;side[sd]['intervals']+=1
            for leg in r.get('legs',[]):
                s=str(leg['symbol']);w=float(leg['weight']);p=float(leg['pnlPct']);pair[s]['LONG' if w>0 else 'SHORT']+=p
        is_new=bool(weights) and key!=prev_book
        if is_new:
            initial['gross']+=gross;initial['intervals']+=1
            if current:books.append(current)
            current={'key':key,'intervals':1,'gross':gross}
        elif weights:
            continuation['gross']+=gross;continuation['intervals']+=1
            if current is None:current={'key':key,'intervals':1,'gross':gross}
            else:current['intervals']+=1;current['gross']+=gross
        elif current:
            books.append(current);current=None
        prev_book=key if weights else None
    if current:books.append(current)
    wins=[b for b in books if b['gross']>0]
    return {'side':side,'pairSideGrossPctPoints':pair,'initialBookInterval':initial,'continuationBookIntervals':continuation,'books':{'count':len(books),'positive':len(wins),'winRatePct':100*len(wins)/len(books) if books else 0,'avgIntervals':sum(b['intervals'] for b in books)/len(books) if books else 0,'grossPctPoints':sum(b['gross'] for b in books)}}


def main():
    candles,idx,_=v11.v109.b.base.load();out={'researchLine':'V11_SIDE_OWNERSHIP_DIAGNOSIS','instrumentationOnly':True,'strategyChanged':False,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'freshOosRead':False,'periods':{}}
    for label,(a,b) in v11.PERIODS.items():
        run=v11.simulate(candles,idx,a,b,v11.NORMAL_BPS,0);out['periods'][label]={'metrics':run['metrics'],**diag(run['records'])}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'v11-side-ownership-diagnosis.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
