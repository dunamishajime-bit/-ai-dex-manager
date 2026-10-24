#!/usr/bin/env python3
"""Research-only combined report from completed/native all8 audits."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2]
D=R/'docs/research/results/idle-entry-three-20261024'
a=json.loads((D/'IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json').read_text('utf8'))
chain=json.loads((D/'IDLE_RENDER_H1_TIMING_CHAIN_AND_CANDIDATE_OWNERSHIP_20261024.json').read_text('utf8'))
new=json.loads((D/'IDLE_RENDER_NEW_RETRACEMENT_SHORT_INDEPENDENT_5M_20261024.json').read_text('utf8'))
cases=[
 ('COMBO_BTC_DOT_JUP3_GE_M1P5','JUP−1.5%/DOT−1%/RENDER BTC3h−1.5% cumulative baseline'),
 ('RENDER_PROFIT_F035_JUP_M1P5','RENDER MFE1.5% after floor+0.35%'),
 ('RENDER_PROFIT_F040_JUP_M1P5','RENDER MFE1.5% after floor+0.40%'),
 ('RENDER_PROFIT_F045_JUP_M1P5','RENDER MFE1.5% after floor+0.45%'),
 ('RENDER_INITIAL_WATCH1_2H_JUP_M1P5','RENDER -1% touch, watch2h and MFE<0.25'),
 ('RENDER_INITIAL_WATCH1_2H_F035_JUP_M1P5','RENDER initial watch2h + floor0.35%'),
]
for k,name in cases:
 assert k in a['testedCases'],('MISSING_FULL8',k)
 for cost in ('10','30'):
  assert a['testedCases'][k][cost]['accounting']=='PASS' and a['testedCases'][k][cost]['ledgerSha256']
def fmt(v):return f'{v:,.0f}'
def delta(v):return ('+' if v>=0 else '−')+fmt(abs(v))
def wr(case,sym):
 z=case['symbols'][sym]
 return f"{z['wins']}/{z['n']} ({z['wrPct']:.1f}%)"
BASE=cases[0][0]
b10=a['testedCases'][BASE]['10'];b30=a['testedCases'][BASE]['30']
lines=[
 '# RENDER SHORT ENTRY / EXIT：新ルート・タイミング再選択・初期損失2時間監視（2026-10-24）',
 '',
 'RESEARCH ONLY. VPS, LIVE, Production, HP, actual orders unchanged. All evidence reflects modeled replay only.',
 '',
 '## Compared like-for-like cumulative full8 backtests',
 '- Period: 2025-08-10 to 2026-08-10, normal 10bps and stress 30bps, 3-pass dynamic reselection, 8-logic common wallet.',
 '- Previous PENGU and AVAX research retained, plus DOT 1h change >= -1%, JUP 12h >= -5% and 3h >= -1.5%, RENDER BTC3h >= -1.5%. All risk/gross/ownership protections stay unchanged.',
 '- Historical samples are highly explored. In-sample changes and previously-seen time splits are not independent OOS proof.',
 '',
 '| Model | 10bps final JPY | 10bps delta | all trades | RENDER win rate | 30bps final JPY | 30bps delta | all trades | RENDER win rate | DD 10/30 |',
 '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
]
for k,name in cases:
 x=a['testedCases'][k]['10'];y=a['testedCases'][k]['30']
 lines.append('| '+name+' | '+fmt(x['finalEquityJpy'])+' | '+delta(x['finalEquityJpy']-b10['finalEquityJpy'])+
 ' | '+str(x['portfolioTrades'])+' | '+wr(x,'RENDERUSDT')+' | '+fmt(y['finalEquityJpy'])+
 ' | '+delta(y['finalEquityJpy']-b30['finalEquityJpy'])+' | '+str(y['portfolioTrades'])+
 ' | '+wr(y,'RENDERUSDT')+' | '+f"{x['ddPct']:.5f}%/{y['ddPct']:.5f}%"+' |')
lines+=['',
 '## Why simply waiting one to six hours is not a substitute for entrance logic',
 '- Native selected RENDER H1: 24 of 164 candidates accepted. Other 140: 81 competing core, 44 RENDER cooldown, 8 simultaneous capacity, 7 insufficient gross.',
 '- At 30bps, 12 winning/12 losing selected. Eight of 12 losing trades have a cooldown-rejected RENDER candidate within six hours. The first such candidate is hypothetically profitable for only 1 of 8; projected first-followup sum is negative (not an executable portfolio result).',
 '- Moving an order entry forward by one hour is not justified; a new completed-M5 price-action confirmation and ownership-aware native testing are required.',
 '',
 '## Independent NEW SHORT entrance signals (NOT included in full8 economic results)',
 '- 11 causal hourly-retrace/mean-reversion/fade entrances, 3 fixed short exit contracts, M5 stop-first, 12h cooldown, entry at next M5 open; no full8 capital, funding, borrow or live venue fill.',
 '| Standalone model, 30bps | trades | wins | PF | early PF/wins | later PF/wins |',
 '|---|---:|---:|---:|---:|---:|'
]
for n in ['BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD12',
          'BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD6',
          'BROAD_RETRACE_RESISTANCE__TP1P75_SL2P5_HOLD12']:
 x=new['results']['30'][n];v=x['overall'];first=x['early'];last=x['late']
 lines.append('| '+n+' | '+str(v['n'])+' | '+str(v['wrPct'])+'% | '+str(v['pf'])+
   ' | '+str(first['pf'])+'/'+str(first['wrPct'])+'% | '+str(last['pf'])+'/'+str(last['wrPct'])+'% |')
lines+=['',
 '- BTC_TRAP (12h) achieves 30bps 44 trades, 70.45% WR, PF1.2349 in this isolated model, but early PF2.5893 and later PF0.6329. This does not prove an edge that survives regime changes; no implementation or LIVE approval.',
 '- Risk of overfitting is substantial because thresholds were compared on a repeatedly researched period.',
 '',
 '## Decision and next valid evidence',
 '- Compare both costs, maximum mark-to-market DD, and individual RENDER count/wins as well as all eight trade count. Reject an idea that increases WR by cutting all important winning opportunity.',
 '- If a model makes profits but not RENDER 70% WR, it is research/Forward Shadow candidate only, not an adopted live strategy.',
 '- Require source-permission/venue-entry lifecycle, recovery of protective stop after partial fills/restart, pending-margin parity, exact Production SHA, plus unseen OOS/replay before production.',
 '',
 '## Evidence files',
 '- scripts/dd-reduction/run-idle-three-entry-native-full8-20261024.py',
 '- scripts/dd-reduction/audit-idle-entry-three-native-full8-20261024.py',
 '- scripts/dd-reduction/screen-idle-render-timing-priority-chain-20261024.py',
 '- scripts/dd-reduction/screen-render-fresh-rally-fade-m5-20261024.py',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_H1_TIMING_CHAIN_AND_CANDIDATE_OWNERSHIP_20261024.json',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_NEW_RETRACEMENT_SHORT_INDEPENDENT_5M_20261024.json',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json']
older=json.loads((D/'IDLE_RENDER_NEW_SHORT_OLDER_OUT_OF_YEAR_M5_VALIDATION_20261024.json').read_text('utf8'))
manifest=json.loads((D/'IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
assert len(manifest['files'])==24 and all(x['available'] and x['zipCrcPass'] and x['sha256'] for x in manifest['files'])
lines+=['',
 '## Critical disjoint older-year validation, fixed rules and exits',
 'Public Binance USD-M Futures BTC and RENDER M5 archives, August 2024 through July 2025: 24/24 downloaded, CRC+SHA256 source checks pass. Earlier rules are frozen; no new threshold selected based on older outcomes.',
 'This disjoint historical window is still retrospective, not prospective forward OOS and not eight-strategy allocator parity.',
 '| Fixed model and round-trip cost | Older n | Older WR | Older PF | Later research n | Later WR | Later PF |',
 '|---|---:|---:|---:|---:|---:|---:|']
for cost in ('10','30'):
 for name in ('BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD12',
              'BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD6',
              'BROAD_RETRACE_RESISTANCE__TP1P75_SL2P5_HOLD12'):
  xx=older['costs'][cost][name];old=xx['older'];recent=xx['newer']
  lines.append('| '+name+' '+cost+'bps | '+str(old['n'])+' | '+str(old['wrPct'])+
               '% | '+str(old['pf'])+' | '+str(recent['n'])+' | '+str(recent['wrPct'])+'% | '+str(recent['pf'])+' |')
 lines.append('- Both-year PF>1 with minimum 20 trades at '+cost+
  'bps among 33 independently generated rule+exit models: '+
  str(older['comparison'][cost]['bothYearsPFOver1AndAtLeast20Cases'])+' models.')
lines+=['',
 'The BTC_TRAP 12h short is rejected: 30bps later-year 44 trades, 70.45% WR, PF1.2349; older disjoint-year 50 trades, 52% WR, PF0.5762. There is no 30bps new-entrance model with both-year PF>1 in this 33-model group.',
 'This is direct evidence against declaring victory from an in-sample high WR.',
 '',
 'Evidence:',
 '- scripts/dd-reduction/acquire-render-btc-independent-older-m5-20261024.py',
 '- scripts/dd-reduction/evaluate-render-new-short-older-2024-2025-m5-20261024.py',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_NEW_SHORT_OLDER_OUT_OF_YEAR_M5_VALIDATION_20261024.json']
dest=D/'IDLE_RENDER_DEEP_ENTRY_EXIT_TIMING_DECISION_20261024.md'
dest.write_text('\n'.join(lines).rstrip()+'\n',encoding='utf8',newline='\n')
print('REPORT_GENERATED',dest,dest.stat().st_size,'CASES',len(a['testedCases']))
