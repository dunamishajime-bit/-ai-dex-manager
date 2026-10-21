# Q102 early-loss and profit protection after permanently freezing V12 V4 adopted 4 rules

> **RESEARCH COMPLETE / NO new Q102 candidate accepted / V4 remains pinned.** This is NOT a Production release or venue readback.

## Inherited cumulative baseline (8 strategies, 2025-08-10..2026-08-10, JPY 10,000 compounded, zero deposits)

| Metric | 10bps | 30bps |
|---|---:|---:|
| Final JPY | ¥191,750,055 | ¥74,740,268 |
| Mark-to-market max DD | -14.6033% | -15.7782% |
| PF | 3.1750 | 2.5811 |
| Trades | 1319 | 1316 |

V4 is fixed: LONG TIME37 +2% MFE -> -5% emergency, X09/X10/X14 LONG +3% -> +1% H1x2; SHORT early +2.5% adverse after12h MFE<1% and accepted-fill 12h cooldown; SHORT TIME37 +5% -> +2% H1x2. **Never revert these four rules when testing Q102.**

## Q102 candidates (independent one-at-a-time on top of fixed V4)

| Q102 modification | 10bps JPY | DD 10bps | 30bps JPY | DD 30bps | New accepted Q102 exits 10bps/30bps |
|---|---:|---:|---:|---:|---|
| Q102_PROFIT_ARM2_FLOOR0P5 | ¥191,750,055 | -14.6033% | ¥74,740,268 | -15.7782% | 0/0 |
| Q102_INIT_2P5_6H_MFE0P5 | ¥181,728,641 | -18.4642% | ¥63,873,671 | -20.3706% | 11/11 |
| Q102_BOTH_PROFIT2_AND_INITIAL6H | ¥181,728,641 | -18.4642% | ¥63,873,671 | -20.3706% | 11/11 |
| Q102_MR_SHORT_INIT2P5_6H | ¥189,118,791 | -14.6033% | ¥72,822,273 | -15.8012% | 4/4 |
| Q102_HV_LONG_INIT2P5_6H | ¥191,750,055 | -14.6033% | ¥74,740,268 | -15.7782% | 0/0 |
| Q102_INIT_2P5_12H_MFE1 | ¥188,654,502 | -17.3399% | ¥63,455,875 | -19.1551% | 8/8 |

## Conclusions

- Q102 existing optional M5 **CLOSE-confirmed** gain >=+2% -> resident +0.5% profit floor adds zero accepted exits / zero incremental DD in this source model. Do not model high-only arming; unlike V4 LONG, Q102 uses confirmed CLOSE.
- Q102 all-family initial adverse +2.5% after6h with MFE<0.5% makes DD much worse under both 10/30bps despite additional early exits, so REJECT.
- Q102 all-family initial adverse +2.5% after12h with MFE<1% still worsens DD and profits in both costs, so REJECT.
- Q102 MR SHORT 6h restricted candidate reduces profits and fails 30bps DD guard; no adoption.
- Q102 HIGH_VOL LONG 6h restricted candidate adds zero accepted exits. Too few cases to infer robustness; no adoption.
- The combined profit-floor and 6h early-stop proposal is economically equivalent to early-stop-only; no DD or wealth rescue.
- 6/6 candidates fail the both-cost 0.10 percentage point maximum DD improvement gate. **Keep Q102 unchanged and preserve V4 four-rule fixed baseline for next tests.**

## Next controlled research

Family×Side risk tails: MR SHORT has substantial losing PnL in the baseline; HIGH_VOL LONG has 6 annual accepted trades with one dominant loss. Derive causal market-regime and entry-depth features with holdout validation before modifying these family rules; never weaken already approved gross/stop and do not backfit to one loss.

Model limitations: Venue signed readback, exact production SHA parity and independent new Task9 full8 economic allocator certification remain unproved. No live orders or release changed.

Reproducible code: scripts/dd-reduction/run-v4-locked-next-q102-20261021.py and test-v4-locked-next-q102-20261021.py. Full model ledgers remain on owner PC.
