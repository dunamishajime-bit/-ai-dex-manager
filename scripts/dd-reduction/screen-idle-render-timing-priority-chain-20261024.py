#!/usr/bin/env python3
"""Research only: RENDER H1 candidate overlap/priority and 1-12h possible delayed signal chains.
EX POST labels of next candidates are used only to measure *potential* improvement,
NEVER to score or decide whether to enter. P&L is not an admitted full8 portfolio.
"""
from pathlib import Path
import json,datetime,collections,statistics
R=Path(__file__).resolve().parents[2]
D=R/'docs/research/results/idle-entry-three-20261024'
SRC=D/'IDLE_RENDER_REBOUND_FADE_PREALLOCATION_SCREEN_20261024.json'
OUT=D/'IDLE_RENDER_H1_TIMING_CHAIN_AND_CANDIDATE_OWNERSHIP_20261024.json'
HOUR=3600000
def met(v):
 n=len(v);wins=sum(x['win'] for x in v)
 return {'n':n,'wins':wins,'wrPct':round(100*wins/n,2) if n else None,
         'netSumPct':round(sum(x['ret'] for x in v),3)}
def main():
 raw=json.loads(SRC.read_text('utf8'))
 result={'status':'EX_POST_RESEARCH_ONLY_NOT_ADMISSIBLE_ENTRY_OR_PORTFOLIO',
         'costs':{},'dateSplit':'2026-04-01','notes':['Alternative candidate exit is future information used to describe possibilities only.',
         'Additional positions may still be blocked by core strategy ownership, idle gross, HYPE and pending risk.',
         'Each after-entry H1 candidate must be independently validated in the native allocator before being called a trade.']}
 for cost in ('10','30'):
  data=raw['costs'][cost]
  arr=data['candidateDetail']
  byTs=collections.defaultdict(list)
  for x in arr:byTs[x['ts']].append(x)
  chosen=[x for x in arr if x['selected']]
  res=[]
  for x in chosen:
   nexts=[]
   for hrs in (1,2,3,4,6,12):
    group=[y for ts,values in byTs.items() if x['ts']<ts<=x['ts']+hrs*HOUR for y in values]
    if not group:continue
    good=[v for v in group if v['ret']>0]
    cooldown=[v for v in group if 'COOLDOWN' in v['decisionReason']]
    profitable_cooldown=[v for v in cooldown if v['ret']>0]
    nexts.append({'withinHours':hrs,'availableCandidates':len(group),
      'eligibleIfNoFilledCooldown':len(cooldown),'positiveCandidates':len(good),
      'positiveCooldownCandidates':len(profitable_cooldown),
      'earliestNext':{'ts':group[0]['ts'],'ret':group[0]['ret'],
           'reason':group[0]['decisionReason'],'win':group[0]['win']},
      'earliestCooldown':{'ts':cooldown[0]['ts'],'ret':cooldown[0]['ret'],'win':cooldown[0]['win']} if cooldown else None})
   res.append({'candidateId':x['id'],'ts':x['ts'],'dateUTC':datetime.datetime.fromtimestamp(x['ts']/1000,datetime.timezone.utc).strftime('%Y-%m-%d %H:%M'),
      'originalWin':x['win'],'originalReturnPct':x['ret'],'features':x['features'],'followUps':nexts})
  losses=[x for x in res if not x['originalWin']]
  orig=met(chosen)
  potential={}
  for hours in (1,2,3,4,6,12):
   group=[]
   for x in losses:
    zz=next((y for y in x['followUps'] if y['withinHours']==hours),None)
    if zz and zz['earliestCooldown']:
     group.append({'win':zz['earliestCooldown']['win'],'ret':zz['earliestCooldown']['ret']})
   potential[str(hours)]={'losersWithNextCooldownWithinHours':len(group),'hypotheticalFirstCooldown':met(group)}
  reasons=collections.Counter(x['decisionReason'] for x in arr if not x['selected'])
  result['costs'][cost]={'original':orig,'decisionReasons':dict(reasons),'selectedLosses':losses,
       'selectedWinDates':[x['dateUTC'] for x in res if x['originalWin']],
       'nextCooldownPotential':potential}
  print('COST',cost,'BASE',orig,'REASONS',reasons,'LOSERS',len(losses),flush=True)
  for hours,v in potential.items():print('  HRS',hours,v,flush=True)
  print('LOSS_CASES_FIRST',[(x['dateUTC'],round(x['originalReturnPct'],2),x['features']['ret3h'],
         x['features']['last15'],x['followUps'][:1]) for x in losses[:8]],flush=True)
 OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('SAVED',OUT,OUT.stat().st_size)
if __name__=='__main__':main()
