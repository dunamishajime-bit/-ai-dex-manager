#!/usr/bin/env python3
"""2024 A/B dual M5 exit 49-case research-only integrity test."""
from pathlib import Path
import ast,json
root=Path(__file__).resolve().parents[2]
folder=root/'docs/research/results/render-three-regime-20261024'
j=json.loads((folder/'RENDER_2024_A_B_EXITS_49_CAUSAL_WINRATE_RESCREEN_20261024.json').read_text('utf8'))
assert j['status'].startswith('RESEARCH_ONLY') and j['searchCount']==49 and len(j['cases'])==49
baseline='TAKE40_STOP30_H24__TAKE40_STOP30_H24'
candidate='TRAIL_MFE15_FLOOR05_H18__TRAIL_MFE25_FLOOR10_H24'
assert j['baseKey']==baseline
for yr,n,w,pf in [('2024',69,55.072,1.2796),('2025',63,50.794,1.2174),('2026',41,56.098,1.464)]:
 r=j['cases'][baseline]['year'][yr]['30']
 assert r['n']==n and r['wr']==w and r['pf']==pf
for yr,n,win,w,pf in [('2024',70,51,72.857,1.4535),('2025',64,43,67.188,1.2239),('2026',40,30,75.,1.3747)]:
 r=j['cases'][candidate]['year'][yr]['30']
 assert r['n']==n and r['wins']==win and r['wr']==w and r['pf']==pf
 assert j['cases'][candidate]['year'][yr]['10']['pf']>1
assert j['cases'][candidate]['periods']['25_AUG_DEC']['30']['pf']<1
qualify=0
for key,item in j['cases'].items():
 if item['year']['2024']['30']['wr']>=70 and item['year']['2026']['30']['wr']>=70 and item['year']['2024']['30']['n']>=65:
  if all(item['periods'][segment]['30']['pf'] is not None and item['periods'][segment]['30']['pf']>1 for segment in ('25_JAN_MAR','25_APR_JUL','25_AUG_DEC')):
   qualify+=1
assert qualify==0
script=root/'scripts/dd-reduction/render-2024-AB-dual-exit-winrate-49-research-20261024.py'
ast.parse(script.read_text('utf8'))
assert 'source()' in script.read_text('utf8') and 'simul' in script.read_text('utf8')
print('PASS: 49 causal 5m dynamic cooldown A/B exits; 2024 WR72.857 with n70, 2025H2 loss flagged, no LIVE')
