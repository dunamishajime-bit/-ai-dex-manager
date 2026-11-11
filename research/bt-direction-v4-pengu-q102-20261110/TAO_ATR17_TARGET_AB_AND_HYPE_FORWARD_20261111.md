# TAO ATR17 target A/B and HYPE true-forward audit — 2026-11-11

Research only. Production, orders, positions, STOPs, Runner state, Kill Switch and systemd were not changed.

## Locked reference

Corrected canonical current-implementation baseline after the V52 strategy-capital scope fix:
- 10bps: JPY 887,336.06 / DD -56.3135% / 537 fills / Win 57.3557% / PF 1.2223
- 30bps: JPY 321,161.96 / DD -63.1958% / 537 fills / Win 56.2384% / PF 1.1678

Latest causally-supported bundle CAUSAL_THREE:
- 10bps: JPY 1,585,699.80 / DD -41.3525% / 540 fills / Win 59.6296% / PF 1.4313
- 30bps: JPY 579,086.35 / DD -50.6043% / 539 fills / Win 58.2560% / PF 1.3223

## IDLE TAO ATR17 frozen candidate

Candidate selected outside the target year from pre-target Binance UM proxy plus validation/prehold/true-forward checks:
`features.atrRatio <= 0.017`.

Latest canonical target-year A/B was run twice with exact artifact hashing.

TAO_ATR17 only:
- 10bps: JPY 892,594.75 / DD -55.9506% / 536 fills / Win 57.2761% / PF 1.2242
- 30bps: JPY 323,738.18 / DD -62.8875% / 536 fills / Win 56.1567% / PF 1.1692
- 21 candidate intents removed.
- determinism: 21/21 artifacts exact SHA256 match across two independent reruns.

CAUSAL_FOUR = CAUSAL_THREE + TAO_ATR17:
- 10bps: JPY 1,571,335.34 / DD -41.3525% / 538 fills / Win 59.4796% / PF 1.4287
- 30bps: JPY 576,122.07 / DD -50.6043% / 537 fills / Win 58.1006% / PF 1.3209
- determinism: 21/21 artifacts exact SHA256 match across two independent reruns.

Decision: reject TAO_ATR17 as a fourth gate. It does not improve CAUSAL_THREE max DD and slightly reduces final equity, win rate and PF. Keep CAUSAL_THREE unchanged.

## HYPE true Aster forward replay

A new forward replay was built against the untouched 2026-10-01 through 2026-11-08 Aster H1/M5 holdout, with pre-target/target-end H1 history used only for indicator warmup. The exact pinned HYPE signal and the previously validated M5 exit model were reused unchanged.

Result:
- full observed forward candidate count: 0
- unresolved: 0
- signal rejection reasons:
  - TREND_ALIGNMENT_NOT_MET: 718
  - REGIME_SLOPE_NOT_MET: 193
  - BREAKOUT_NOT_MET: 19
  - DISTANCE_FROM_SLOW_EMA_TOO_LARGE: 2

Therefore there is no true-forward HYPE trade sample capable of validating or falsifying a new HYPE admission gate. Combined with the weak August/September pre-target validation results, no HYPE gate is adopted. Do not force a complex gate from the 39 Binance proxy candidates.

## Next

The remaining CAUSAL_THREE drawdown is dominated by Q102. Continue with causal/pre-period Q102 route-family research, generating thresholds only outside the target-year evaluation slice and using validation/forward data to falsify them before any integrated A/B.

No Production mutation.
