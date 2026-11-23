from pathlib import Path
s=Path('scripts/research_patch_v74_independent_long_sleeve.py').read_text();d=Path('scripts/research_patch_v74_dual_pengu_dca.py').read_text()
for t in ['V74Family = "RELATIVE_STRENGTH_SIGN_FLIP"','V74_NEW_LONG_GROSS=0.25','lag.relativeReturn24h<=0','f.relativeReturn24h>=0.015','f.penguReturn24h>=0.01','f.close>f.ema72','f.btcReturn24h>=-0.02','f.volumeRatio6OverPrior36>=0.90','f.rsi14>=48&&f.rsi14<=72','2025-08-10T00:00:00Z','2025-12-09T16:00:00Z','2026-04-10T08:00:00Z','2026-08-10T00:00:00Z','V74_MIN_TRADES_PER_FOLD=2','assert.equal(incNM.trades,41','303.9903920953809']:assert t in s,t
for t in ['V74_FAMILIES','candidateCount','selectedTraining','grid_search','optimize_threshold','optimize_gross','EMA72_REGIME_FLIP','VOLATILITY_COMPRESSION_RELEASE','FAILED_BREAKDOWN_RECLAIM','PULLBACK_CONTINUATION','BREAKOUT_CONFIRMATION','OVERSOLD_REVERSAL']:assert t not in s,t
for t in ['V74_NEW_LONG_GROSS_CAP','V74_RESERVE_V64_GROSS','PENGU_V74_NEW_LONG_SLEEVE','V74_NEW_LONG_ENTERED','PENGU_V64_RESERVED_CAPACITY_BLOCKED']:assert t in d,t
print('V74_INDEPENDENT_LONG_POLICY=PASS')
