$ErrorActionPreference='Stop'
$root='C:\tmp\disdex-bt-20251001-20261001'
$rr=$root+'\DIRECTION_RESEARCH_20261109\STABLE3_REPRO_RECOVERED_20261113'
$env:DISDEX_Q102_ADOPTED_MODE='ON'
$env:DISDEX_PRETARGET_STABLE_CASE='STABLE3'
python ($rr+'\portfolio_causal_three_pretarget_stable_route_ab_REPRO_20261113.py')
if($LASTEXITCODE -ne 0){throw 'STABLE3_REPRO_FAILED'}
$out=$root+'\VPS_EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON_20261111_REPRO_20261113'
$j=Get-Content ($out+'\RUN_MANIFEST.json') -Raw|ConvertFrom-Json
$j.results|Select-Object cost_bps_roundtrip,final_compounded_jpy,max_hourly_dd_pct,modeled_fills,win_rate_pct,profit_factor,source_intents|Format-Table -AutoSize
