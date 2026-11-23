from pathlib import Path
s=Path('scripts/research_patch_v73_independent_long_sleeve.py').read_text()
d=Path('scripts/research_patch_v73_dual_pengu_dca.py').read_text()
for token in ['V73Family = "EMA72_REGIME_FLIP"','V73_NEW_LONG_GROSS = 0.25','below>=4','valid===6','prev.close<=prev.ema72','f.close>f.ema72','f.btcReturn24h>=-0.02','f.relativeReturn24h>=0','f.volumeRatio6OverPrior36>=1.0','f.rsi14>=50 && f.rsi14<=70','2025-08-10T00:00:00Z','2025-12-09T16:00:00Z','2026-04-10T08:00:00Z','2026-08-10T00:00:00Z','V73_MIN_TRADES_PER_FOLD = 2','assert.equal(incNM.trades,41','303.9903920953809']:
    assert token in s, token
for forbidden in ['V73_FAMILIES','candidateCount','selectedTraining','threshold_candidates','gross_candidates','grid_search','optimize_threshold','optimize_gross','VOLATILITY_COMPRESSION_RELEASE','FAILED_BREAKDOWN_RECLAIM','PULLBACK_CONTINUATION','BREAKOUT_CONFIRMATION','OVERSOLD_REVERSAL']:
    assert forbidden not in s, forbidden
for token in ['V73_NEW_LONG_GROSS_CAP','V73_RESERVE_V64_GROSS','PENGU_V73_NEW_LONG_SLEEVE','V73_NEW_LONG_ENTERED','PENGU_V64_RESERVED_CAPACITY_BLOCKED']:
    assert token in d, token
print('V73_INDEPENDENT_LONG_POLICY=PASS')
