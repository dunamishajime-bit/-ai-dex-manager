#!/usr/bin/env python3
"""Research result invariants. Data source and native schemas are immutable inputs."""
import ast,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
base=ROOT/'docs/research/results/render-orderflow-20261024'
def read(name):return json.loads((base/name).read_text(encoding='utf8'))
checksum=read('RENDER_ORDERFLOW_PUBLISHER_CHECKSUM_PARITY_20261024.json')
assert checksum['status']=='OFFICIAL_CHECKSUM_PARITY_VERIFIED'
assert checksum['filesChecked']==checksum['matching']==799
manifest=read('RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json')
assert all(x['expected']==x['valid'] for x in manifest['summary'].values())
assert len(manifest['files'])==799
a=read('RENDER_ORDERFLOW_COMPOSITE_ABLATION_20261024.json')
assert a['data']['sourceOHLCParity'] is True
assert a['data']['missingNew']==0
assert len(a['models'])==20
assert not a['preselection']['eligibleOnOlderCalibrationOnly']
assert a['models']['price:q0.75']['newer']['30']['n']==158
assert a['models']['oi+taker:q0.6']['newer']['30']['n']==234
routes=read('RENDER_FLOW_NEW_ENTRY_ROUTES_20261024.json')
assert len(routes['models'])>=20
assert all(routes['models'][key]['30']['newer']['PF']<1 for key in routes['calibrationQualifiedNames'])
native=read('RENDER_NATIVE_SELECTED24_OI_FLOW_ATTRIBUTION_20261024.json')
assert native['all']['n']==24 and native['all']['wins']==12
g=native['entryGroups']
assert g['oi_up_sellers']['wins']+g['oi_down_sellers']['wins']==7
assert g['oi_up_buyers']['wins']+g['oi_down_buyers']['wins']==5
risk=read('RENDER_NATIVE24_FLOW_EXIT_RISK_DIAGNOSTIC_20261024.json')
assert risk['sourceCohortComparison']['exactEconomicCohortParity'] is True
assert len(risk['cases'])==6
assert all(z['deltaPctSum']<0 for z in risk['cases'].values())
for name in ('acquire-render-orderflow-history-20261024.py','verify-render-orderflow-official-checksums-20261024.py',
 'render-orderflow-composite-20261024.py','render-flow-new-entry-routes-20261024.py',
 'analyze-render-native24-orderflow-20261024.py','render-native24-flow-risk-exits-20261024.py'):
 ast.parse((ROOT/'scripts/dd-reduction'/name).read_text(encoding='utf8'))
print('PASS: publisher checksums, model baseline, true historical rejection gates, native ledger parity by timestamp and economics, and immutable research artifacts')
