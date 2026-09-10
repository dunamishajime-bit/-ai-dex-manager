# BT comparison contract — Top2 / PENGU V20+V8 / V52 / Q102

This document freezes the naming and comparison rules so future backtests do not mix historical results with a changed Quality102 allocation.

## Historical six-case baseline

The previously recorded six-case comparison remains an immutable historical baseline.

- Period: 2025-08-10 to 2026-08-10
- Capital: JPY 100,000 lump sum
- Additional contributions: none
- Compounding: enabled
- V12 Top2 semantics: max 2 positions, each <= 1.0x, aggregate <= 1.5x
- PENGU V8 semantics: Short V20 remains active; Recovery V8 is a supplemental Long path
- PENGU Recovery hard-stop cooldown: 24h
- Q102 in this historical six-case baseline: 0.5x, one slot
- Crypto Gross cap: 2.0x
- Total Gross cap: 2.5x

Historical winner:
`V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_0.5`

Recorded NORMAL: JPY 15,101,400 / PF 2.791 / DD -28.02%
Recorded SEVERE: JPY 1,444,286 / PF 1.810 / DD -35.83%

## Implementation candidate from now on

The implementation candidate is changed to:

`V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_1.0_1SLOT`

Quality102 is fixed at:

- Gross cap: 1.0x
- Maximum positions: 1
- Selector: Causal V4

This change does not rewrite the historical JPY 15,101,400 result. A fresh integrated replay is required for the 1.0x candidate before any LIVE adoption.

A prior formal DCA research result with Q102 1.0x / one slot exists as a reference benchmark: JPY 18,442,769.04 NORMAL, PF 3.5706, DD -14.34%. Its capital contract was different (JPY 10,000 initial plus JPY 10,000 x 12 contributions), so it must not be substituted for the six-case lump-sum result.

## DD sweep rule

From this point, Q102 allocation is not an optimization axis. Keep Q102 at 1.0x / one slot and change only drawdown controls. V12, PENGU, V52 and Q102 signal definitions stay frozen.

The DD experiment may vary portfolio risk controls only, for example staged gross reduction after portfolio drawdown, tighter temporary shared-risk throttling, or Recovery V8 size reduction during an active drawdown state. It must not alter entry signals to manufacture a better in-sample curve.

Every candidate must report NORMAL and SEVERE ending asset, PF, maximum DD, sleeve PnL, Q102 episodes/PnL, gross maxima and gross conflicts.

## Adoption gate

LIVE remains unchanged until all of the following are true:

- Q102 1.0x / one-slot integrated replay is reproduced from event-level inputs.
- NORMAL and SEVERE DD are measured under the same fixed strategy contract.
- The chosen DD control improves risk without an unacceptable destruction of ending asset.
- Crypto Gross <= 2.0x and Total Gross <= 2.5x remain conflict-free.
- Regression tests and research-contract checks pass.

Do not label a Q102 1.0x result with the historical Q102 0.5x metrics, and do not label the historical six-case result as Q102 1.0x.
