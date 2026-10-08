# V12 Entry Redesign Research Status — 2026-10-08

## Status

**RESEARCH_ONLY / NO LIVE OR PRODUCTION CHANGE**

Current V12 persistent-momentum entry is not approved. The strongest research candidate is a fast failed-break reversal SHORT architecture, with an additional BTC regime gate showing strong in-sample/pre-selection robustness but insufficient independent holdout count.

## Baseline problem

Current V12 is a persistent 45×H2 (~90h) momentum follower using a ±2.27% momentum threshold. The configured breakout parameters are not an actual price-breakout eligibility requirement in the current core signal.

Integrated 2025-08-10..2026-08-10, 10bps:
- Portfolio final equity: JPY 4,319,497.91
- Portfolio PF: 1.8314
- Portfolio WR: 48.04%
- Portfolio MTM DD: -23.82%
- V12 accepted trades: 1,123
- V12 WR: 40.25%
- V12 PF: 0.7197
- V12 net: -4,717.11 (engine USD accounting)

The V12 loss is therefore an entry-architecture issue, not a trade-count issue.

## Entry timing diagnosis

The existing persistent momentum condition has a sharp age effect at raw-candidate level:
- condition age 0–6h: 122 candidates, 10bps PF 1.252
- age 8–12h: 159 candidates, PF 0.563
- age 26–48h: 504 candidates, PF 0.672

However simply filtering existing V12 to age <=6h did **not** blacken V12 after integrated portfolio acceptance:
- 10bps V12 accepted: 92
- V12 PF: 0.50
- second-half V12 PF: 0.467

It improved the total portfolio mostly because stale V12 trades stopped consuming capital.

A first-crossing momentum-onset architecture also failed to blacken V12 consistently. Entry timing alone is not enough.

## Work's strongest architecture: FAILED_BREAK_REV_SHORT

Economic structure:
1. fresh upward 90h momentum onset;
2. actual structural breakout;
3. breakout fails back below the level quickly;
4. opposite close-location/body confirmation;
5. enter SHORT at next H1 open.

The strongest stable timing was a failure window <=6h. Waiting for an additional H2 confirmation was tested separately and destroyed the edge; three-stage confirmation variants were negative.

### FAILED_BREAK_REV_SHORT_6H

Integrated 2025-08-10..2026-08-10:
- 10bps portfolio: JPY 18,375,534 / PF 2.7562 / WR 66.87% / DD -19.70%
- V12 accepted: 55
- V12 10bps: WR 60.00% / PF 2.4356 / net +4,090.68
- V12 20bps PF: 1.8948
- V12 30bps PF: 1.4862

Raw rule robustness on the development window remained positive across threshold neighborhoods. The 6h window was especially stable:
- raw n=56
- 10bps PF 2.7427
- 20bps PF 2.0849
- 30bps PF 1.5977
- first and second halves were both positive at all three costs.

## Critical pre-development failure

The unfiltered 6h rule was backcast to 2025-01-11..2025-08-08:
- n=28
- 10bps WR 39.29%
- PF 0.7438
- mean -0.2395%

The failure concentrated in 2025-Q2:
- n=12
- WR 16.67%
- PF 0.0995

This prevented production approval.

Diagnosis showed the bad Q2 failures occurred when BTC was still rising:
- PRE-Q2 losers: BTC6 mean +0.75%, BTC24 mean +1.19%
- PRE-Q2 winners: BTC6 mean -0.67%, BTC24 ~+0.92%
- development winners also had weaker BTC6 and lower BTC24 than development losses.

## Fixed BTC regime candidate

Pre-specified research candidate:
**FAILED_BREAK_REV_SHORT_6H + BTC6 <= 0 + BTC24 <= +1.0%**

Rationale: do not treat a one-bar altcoin failed breakout as a true reversal SHORT while BTC is still actively advancing over 6h or strongly positive over 24h.

The +1.0% BTC24 cap was selected from **pre-holdout Jan-2025..Aug-2026 diagnostics only**. Post-2026-08-11 results were not used for the threshold sweep.

### Development integrated replay

10bps:
- portfolio final: JPY 18,483,105.63
- portfolio PF: 2.7876
- portfolio WR: 67.90%
- DD: -19.69%
- V12 accepted: 19
- V12 WR: 73.68%
- V12 PF: 7.7854
- V12 net: +4,546.60

V12 PF:
- 20bps: 5.8281
- 30bps: 4.2826

This sample is very small and cannot by itself justify production.

### Pre-selection historical span after fixed gate

Rebuilt from source H1 data, then gated, re-ranked, and exited with the unchanged legacy 46h exit.

2025-01-11..2025-08-08:
- raw failed-break events: 28
- gated/selected: 12
- 10bps: WR 66.67% / PF 3.5818 / mean +0.7636%
- 20bps: PF 3.0164
- 30bps: PF 2.5550
- without-best remained positive at all three costs

The known bad 2025-Q2 regime changed from 12 trades / PF 0.0995 to:
- 3 trades
- 10bps WR 66.67%
- PF 6.8138
- mean +0.4990%

Important: this pre-period contributed to selecting the BTC regime rule, so it is **not independent OOS evidence**. It only confirms the filter fixes the diagnosed failure in the selection data.

## Independent/post-selection evidence

### Untouched unfiltered 6h rule

2026-08-11..2026-10-06 eligible-entry period, separately refetched Aster H1 data:
- price/volume overlap parity: PASS
- semantic event parity before cutoff: 7/7 exact
- 8 completed trades
- 10bps: WR 62.5% / PF 1.6955 / mean +0.1664%
- 20bps: PF 1.2400 / mean +0.0664%
- 30bps: PF 0.8932 / mean negative

This is encouraging at normal cost but not robust at 30bps, and n=8 is too small.

### Post-selection evaluation of fixed BTC regime gate

Applying the already-fixed BTC6/BTC24 rule without changing thresholds:
- raw holdout events: 8
- gated/selected: 2
- 10bps PF 5.0965 / mean +0.4909%
- 20bps PF 3.3017
- 30bps PF 2.3233

But only **2 trades** remain. Without-best is negative because one trade dominates. This is not enough evidence for production approval.

## Verification

- Entry-state unit tests: 12/12 PASS
- Holdout semantic parity: 7/7 exact event-key parity
- Holdout fetch/price parity: PASS
- Entry-phase audit: PASS
- Production/LIVE code changed: NO

## Current decision

1. Reject current persistent-momentum V12 entry as the final architecture.
2. Reject simple freshness gate/onset-only replacement.
3. Reject delayed three-stage confirmation.
4. Keep **FAILED_BREAK_REV_SHORT_6H** as the strongest redesigned V12 route.
5. Keep **BTC6<=0 & BTC24<=+1.0%** as the strongest regime-qualified research candidate.
6. **Do not deploy it yet**: independent post-selection sample after the BTC gate is only 2 trades.
7. Do not tune the BTC thresholds from the observed holdout. Any new threshold change creates a new validation requirement.
8. Continue research on a separate complementary LONG architecture rather than forcing symmetry onto this SHORT edge.
