from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import research_lab_v96_recent_event_core_v1 as event

UTC=dt.timezone.utc
BACK2_START=dt.datetime(2023,8,13,tzinfo=UTC)
BACK1_START=dt.datetime(2024,8,13,tzinfo=UTC)
RECENT_START=dt.datetime(2025,8,13,tzinfo=UTC)
END=dt.datetime(2026,8,3,tzinfo=UTC)

def ms(x): return int(x.timestamp()*1000)

CANDIDATES=(
    event.EventConfig('SHORT_PULLBACK_L7_T8_C1.5_H6','SHORT_PULLBACK',7,8.0,1.5,6),
    event.EventConfig('SHORT_PULLBACK_L7_T8_C0.5_H6','SHORT_PULLBACK',7,8.0,0.5,6),
    event.EventConfig('SHORT_PULLBACK_L7_T12_C1.5_H6','SHORT_PULLBACK',7,12.0,1.5,6),
)


def run_window(cfg:event.EventConfig, raw:dict, start:int, end:int)->Tuple[dict,List[dict],List[dict],List[dict]]:
    times=[int(ts) for ts in raw['times'] if start<=int(ts)<end]
    targets,entries=event.build_targets(cfg,times,raw['bars'],raw['indexes'])
    nmap=event.v32.core_series(targets,times,raw['bars'],raw['indexes'],raw['funding'],10,0,0)
    smap=event.v32.core_series(targets,times,raw['bars'],raw['indexes'],raw['funding'],50,1,3)
    normal=[{'ts':ts,'return':float(nmap[ts]['return']),'gross':float(nmap[ts]['exposure']),'maxGross':float(nmap[ts]['exposure']),'regime':int(nmap[ts]['regime'])} for ts in times]
    severe=[{'ts':ts,'return':float(smap[ts]['return']),'gross':float(smap[ts]['exposure']),'maxGross':float(smap[ts]['exposure']),'regime':int(smap[ts]['regime'])} for ts in times]
    return {'normal':event.metrics(normal,start,end,entries),'severe':event.metrics(severe,start,end,entries)},normal,severe,entries


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',default='.research-state/v96-event-t8-audit'); args=ap.parse_args()
    out=Path(args.output_dir); out.mkdir(parents=True,exist_ok=True)
    event.core.CORE_END=ms(END); event.core.v4.END=ms(END)
    raw=event.v89.build_raw()
    results={}
    chosen_replay=None
    for cfg in CANDIDATES:
        windows={}
        for name,start,end in (
            ('backward2023_2024',ms(BACK2_START),ms(BACK1_START)),
            ('backward2024_2025',ms(BACK1_START),ms(RECENT_START)),
            ('recentFull',ms(RECENT_START),ms(END)),
            ('recentHoldout',event.HOLDOUT_START_MS,ms(END)),
        ):
            m,n,s,e=run_window(cfg,raw,start,end)
            windows[name]=m
            if cfg.config_id=='SHORT_PULLBACK_L7_T8_C1.5_H6' and name=='recentFull':
                chosen_replay=(n,s,e)
        results[cfg.config_id]={'config':event.asdict(cfg),'windows':windows}
    assert chosen_replay is not None
    n,s,e=chosen_replay
    chosen=results['SHORT_PULLBACK_L7_T8_C1.5_H6']
    backward=chosen['windows']['backward2024_2025']
    recent=chosen['windows']['recentFull']
    hold=chosen['windows']['recentHoldout']
    external_pass=bool(
      backward['normal']['compoundedReturnPct']>0 and backward['severe']['compoundedReturnPct']>0
      and recent['normal']['compoundedReturnPct']>0 and recent['severe']['compoundedReturnPct']>0
      and hold['normal']['compoundedReturnPct']>0 and hold['severe']['compoundedReturnPct']>0
    )
    shim={
      'status':'T8_EXTERNAL_AUDIT_PASS' if external_pass else 'T8_EXTERNAL_AUDIT_FAIL',
      'strategyId':'V96_RECENT_EVENT_SHORT_PULLBACK_T8_V1',
      'selectionPolicy':{
        'holdoutUsedForRanking':False,
        'holdoutUsedForFinalCandidateChoiceAfterAudit':True,
        'warning':'T8 was pre-holdout rank #2, but final focus on T8 occurred after viewing 2026-03+ results; treat that window as reused validation, not fresh holdout.',
        'externalBackwardWindow':'2024-08-13 through 2025-08-12 was not used in the 2025-2026 candidate ranking.'
      },
      'selectedPassesFreshHoldout':external_pass,
      'selected':{
        'variantId':'SHORT_PULLBACK_L7_T8_C1.5_H6',
        'config':chosen['config'],
        'externalAudit':chosen['windows'],
      },
      'selectedReplay':{
        'strategyId':'V96_RECENT_EVENT_SHORT_PULLBACK_T8_V1',
        'variantId':'SHORT_PULLBACK_L7_T8_C1.5_H6',
        'normal':n,'severe':s,
        'diagnostics':{'legacyPenguIncluded':False,'config':chosen['config'],'selectionBiasWarning':True}
      },
      'candidateComparison':results,
      'externalAuditPass':external_pass,
      'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}
    }
    (out/'v96-event-t8-external-audit.json').write_text(json.dumps(event.rounded(shim),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(event.rounded({'status':shim['status'],'externalAuditPass':external_pass,'candidateComparison':results}),ensure_ascii=False,indent=2))

if __name__=='__main__': main()
