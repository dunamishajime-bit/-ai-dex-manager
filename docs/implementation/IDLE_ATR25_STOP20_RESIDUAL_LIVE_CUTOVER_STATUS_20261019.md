# Idle SHORT ATR2.5% + SHORT STOP-risk20% + residual sizing — production preparation (2026-10-19)

**STATUS: IMPLEMENTATION STAGED, LIVE CUTOVER BLOCKED.** User approved LIVE intent, but approval is not proof of venue STOP coverage or release parity. Do not force an order, reset a risk latch, forge operator/venue evidence, or overwrite immutable release files.

## Observed live environment
- Xserver VPS authenticated read-only SSH, 2026-10-19 22:36 JST.
- Idle/PENGU/Q102/V52/HYPE/FET/shared risk/margin guard systemd units: active.
- Idle and peer service release: `dd87161165330310df39dd644aa35cd8a6eca6a4`.
- V12 V4 service release: `cd99d7e2cfab91dd2571cd403bbb95b70c83225d`. Mixed release is expected at the moment, but runtime compatibility must be certified.
- Prior adopted **research-only** helper: `7052f593311a8c0959cf9cc338ceae91c35ac0a2`.
- No production unit, symlink, real-money order, position, protection or operator artifact changed during this preparation.

## Implemented on isolated branch
1. Preserve causal confirmed H1 ATR ≤0.025 immediately before Idle SHORT admission.
2. Preserve old account lock, operator, baseline ownership, sidecar, Shared Risk, Margin Guard, Kill Switch, same-symbol and venue 5x Cross gates.
3. Add opt-in partial quantity capacity admission (strict old admission remains the default for existing nonopt-in calls).
4. Produce per-SHORT-position venue STOP readback from full-account authenticated exchange positions/orders, requiring one active reduce-only BUY STOP_MARKET of **exact matching held size**, fresh position readback, positive mark/entry/STOP. Missing/duplicate STOPs block.
5. Pending SHORT risk can be used only if a separately verified fresh risk proof matches each active reservation ID. `disdex-pending-exposure/v1` does not contain this proof. Current caller therefore passes none, and blocks if any SHORT pending reservation exists.
6. Compute candidate quantity with original pure STOP20 budget helper, including 2% adverse gap, 10bps roundtrip, mark-to-STOP risk floored at zero, crypto+total gross caps and venue minQty/step/minNotional. Round down, never increase to fill budget.
7. Persist actual downward-rounded gross in reservation and entry state; entry notional cap uses that same gross. Preserve native 10% STOP, 25% TP, 12h/24h exits, PENGU unchanged.
8. No arbitrary global 1.5x cap, no profit-lock overlay, no daily loss reset, no operator gate bypass.

## Locally verified
- Candidate helper: 10/10 tests PASS.
- Venue STOP and pending-risk bridge: 9/9 tests PASS.
- New partial-admission tests: 7/7 PASS.
- Existing seven Idle regression suites: 50/50 PASS.
- TypeScript normal and research `tsc --noEmit`: PASS.
- This is source + synthetic test validation, **not** a signed live-venue lifecycle test, not a full runner integration certification and not fresh integrated trading BT.

## Material outstanding blockers (do not claim LIVE)
- **Signed cross-runner pending risk:** Registry v1 only stores side/gross/notional, not resident STOP price or verified worst-case loss. Implement a tamper-resistant, lock-protected signed proof writer and reader across all runner reservations, including partial fill, expiration, restart/recovery and UNKNOWN statuses. Current staged bridge correctly blocks UNKNOWN active SHORT risk rather than guessing.
- **Baseline idle ownership parity:** Current LIVE Idle intentionally rejects any baseline/core position, pending core order, same-timestamp core acceptance or active sidecar. This guard remains in staged code; removing it changes the strategy and requires a new exact causal BT/ownership certificate. Consequently this staged version does NOT assert that every old research-simulation partial-sizing trade can occur in the modern runtime.
- **Current eight-strategy compound BT:** The historical ¥208,386,196 partial sizing result is from an older five-runner/1,284-event simulation with max DD -22.8191%, **not** 2026-10-17 latest eight-strategy full portfolio. Compute current combined 10bps/30bps, maximum DD, margin/reservations and loss gap stresses before acceptance. Do not transplant old BT results into current baseline.
- **Actual venue signed lifecycle:** Verify STOP order API coverage for all runner types, hedge/BOTH position signs, exact quantities after partial fill, stop triggers, 2%+ adverse gaps, post-fill protection re-read, existing in-flight orders, account-lock ownership and rate-budget failures.
- **Operator + release parity:** Regenerate/validate a new dynamic sizing route/parity certificate and operator artifact tied to new candidate SHA; run complete CI, release marker and rollback tests. Do not relabel historical 1x certification as dynamic sizing certification.
- **Before switching:** Check real Aster account positions/orders/pending/equity, Shared Risk daily-loss latch, Margin Guard, Kill Switch, runtime-coherence guard, V12 V4 on separate release, and all runner PIDs/watchdog. Any failure blocks new orders.
- **After switching:** Read-back current SHA, unit and PID state, signed STOP protection, updated reserved basket loss and actual order quantity in both logs and UI.

## Commands for isolated validation
```sh
node --experimental-strip-types scripts/idle-priority-short-basket-adopted-selftest.mjs
node --experimental-strip-types scripts/idle-priority-short-basket-venue-bridge-selftest.mjs
node --import tsx --test tests/idle-basket-atr25-partial-admission.test.ts
node --import tsx --test tests/idle-priority-short-idle-gate.test.ts tests/idle-priority-short-live-path.test.ts tests/idle-priority-short-postdeploy-regression.test.ts tests/idle-priority-short-baseline-admission.test.ts tests/idle-quantity-feasibility.test.ts tests/idle-priority-short-parity-cert.test.ts tests/idle-priority-short-signal.test.ts
tsc --noEmit
tsc --noEmit -p tsconfig.research.json
```

**Promotion rule:** Only enable or deploy after ALL blockers are satisfied and written into evidence for the exact release SHA. Otherwise leave existing LIVE release unchanged.
