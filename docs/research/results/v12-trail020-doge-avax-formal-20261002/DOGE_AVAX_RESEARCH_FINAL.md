# DOGE + New Symbol Search Final — 2026-10-02

Status: RESEARCH_COMPLETE_NOT_LIVE

## Critical correction
A research-only scan initially calculated SHORT return as entry/exit - 1. That is not the linear-perpetual notional return used by the formal engine. It was corrected to (entry-exit)/entry and all SHORT-dependent candidate selection and integrated comparisons were rerun. Only corrected results below are controlling.

## Search universe and selection
- 47 symbols beyond the fixed excluded rescue set were scanned.
- Existing formal stack: Trail ATR 0.20, formal five-logic dual-gate configuration.
- DOGE Relative+Volume route fixed at highest supplemental priority.
- Candidate route enters only while formal stack and DOGE are not occupying the residual slot; DOGE can preempt candidate.
- DEV-only route/variant selection, then VAL and HOLD pass required.
- Fresh untouched OOS: 2026-08-10 through 2026-10-01.
- Linear LONG/SHORT PnL, 12h natural hold, 10% stop, 25% TP.
- 10/20/30bps cost checks.

## Corrected formal integrated 10bps
Trail0.20 only: JPY647.16M.
Trail0.20 + DOGE only: JPY706.86M.
DOGE + AVAX REL_LONG: JPY852.25M / overall WR66.27% / PF2.3628 / DD -21.36%.
AVAX overlay: 20 trades / WR70% / weighted PF2.419.

Other corrected one-symbol additions:
- ZEC: JPY1.120B, but fails fresh OOS.
- AAVE: JPY868.64M, outer OOS incremental benefit not robust to 20/30bps.
- LINK: JPY845.81M, fails to improve DOGE fresh OOS.
- INJ: JPY844.43M, fails fresh OOS.
- ASTER: JPY837.59M, fails to improve DOGE fresh OOS.

## AVAX route
AVAX REL_LONG BASE:
- AVAX 24h return relative to BTC >= +3%
- prior-hour volume ratio >= 0.8
- ATR ratio >= 0.7%
- LONG
- DOGE has supplemental priority
- formal strategies have priority over supplemental route

Temporal formal folds:
- DEV 8 trades / WR62.5% / PF5.58
- VAL 5 / WR80% / PF5.91
- HOLD 7 / WR71.4% / PF2.77

## Formal cost sensitivity
DOGE-only:
- 10bps JPY706.86M
- 20bps JPY237.54M
- 30bps JPY70.83M

DOGE + AVAX:
- 10bps JPY852.25M (+20.57% vs DOGE-only)
- 20bps JPY279.76M (+17.78%)
- 30bps JPY81.45M (+14.98%)
DD is unchanged at the 10bps formal comparison.

## Fresh untouched OOS signal check
DOGE-only:
- 10bps: 11 trades / WR63.6% / PF1.838 / summed return +10.62%
- 20bps: PF1.726 / +9.52%
- 30bps: PF1.618 / +8.42%

DOGE + AVAX:
- 10bps: 25 trades / WR60.0% / PF2.106 / summed return +24.36%
- 20bps: 25 / WR56.0% / PF1.948 / +21.86%
- 30bps: 25 / WR56.0% / PF1.801 / +19.36%

The combined AVAX subset improves because DOGE priority/occupancy filters out some weak AVAX windows.

## Rejected after outer OOS
ZEC, LINK, INJ and ASTER looked strong in the formal year but did not improve DOGE-only on the untouched period. AAVE slightly improves 10bps summed return when added to DOGE+AVAX, but loses that incremental advantage at 20/30bps. Do not promote these routes from current evidence.

## Final research candidate
Trail0.20 + DOGE Relative+Volume + AVAX REL_LONG, with existing formal stack > DOGE > AVAX priority.
No LIVE change was made.
