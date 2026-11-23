from pathlib import Path
s=Path('scripts/research_patch_v75_independent_long_sleeve.py').read_text();d=Path('scripts/research_patch_v75_dual_pengu_dca.py').read_text()
for t in ['V75Family="BTC_WEAK_RELATIVE_RESILIENCE"','V75_NEW_LONG_GROSS=0.25','f.btcReturn24h<=-0.005','f.btcReturn24h>=-0.04','f.relativeReturn24h>=0.025','f.penguReturn24h>=-0.005','f.volumeRatio6OverPrior36>=0.90','f.rsi14>=42&&f.rsi14<=62','2025-08-10T00:00:00Z','2025-12-09T16:00:00Z','2026-04-10T08:00:00Z','2026-08-10T00:00:00Z','V75_MIN_TRADES_PER_FOLD=2','assert.equal(incNM.trades,41)','303.9903920953809']:assert t in s,t
assert "src=src.replace(marker,insert+marker,1)" in s
for t in ['V75_FAMILIES','candidateCount','selectedTraining','grid_search','optimize_threshold','optimize_gross','RELATIVE_STRENGTH_SIGN_FLIP','EMA72_REGIME_FLIP','VOLATILITY_COMPRESSION_RELEASE','FAILED_BREAKDOWN_RECLAIM','PULLBACK_CONTINUATION','BREAKOUT_CONFIRMATION','OVERSOLD_REVERSAL']:assert t not in s,t
for t in ['V75_NEW_LONG_GROSS_CAP','V75_RESERVE_V64_GROSS','PENGU_V75_NEW_LONG_SLEEVE','V75_NEW_LONG_ENTERED','PENGU_V64_RESERVED_CAPACITY_BLOCKED']:assert t in d,t
print('V75_INDEPENDENT_LONG_POLICY=PASS')
