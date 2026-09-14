# V12 / Q102 Dynamic Margin Handoff

Base production SHA: `ba32a19ec67a70185ce14cd281a01631c4ee07cf`
Branch: `codex/v12-q102-dynamic-5x-20260914`

## Confirmed production mismatch

The latest V12 DOGE short opened at approximately 1.0x Gross: 715 DOGE at 0.084130 (~60.153 USDT) against an account balance around 60.477 USDT.

The V12 strategy sizing contract is intentionally `leverage: 1`, with per-position Gross capped at 1.0x and aggregate V12 Gross capped at 1.5x. Do not change those strategy sizing values.

The shared Aster margin policy is 5x Cross, but the current managed-symbol list is static and excludes dynamic V12/Q102 symbols such as DOGEUSDT. During the observed DOGE position, the margin guard reported `activeManagedPositionCount: 0`.

Current fixed managed crypto symbols are BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT and PENGUUSDT, plus the V52 stock symbols.

## Required behavior

Preserve all strategy Gross sizing, selectors, slots, ranking, signal logic and portfolio caps. This change is only about venue-side margin configuration and monitoring coverage.

Before a new LIVE exposure is submitted by V12 or Q102, the selected Aster symbol must be verified as 5x Cross. If it is not 5x Cross, the entry path must fail closed until the required venue-side configuration is confirmed.
The shared margin guard must include active and pending dynamic V12/Q102 symbols in its managed set so that post-entry risk monitoring cannot omit a position simply because the symbol is outside the old fixed list.

Existing PENGU/V52 behavior must remain unchanged.

## Contract that must remain unchanged

- V12: max 2 positions, 1.0x per position, aggregate Gross 1.5x.
- PENGU: Gross cap 0.75x.
- Q102: 1.0x, one slot, selector CAUSAL_V4.
- Crypto Gross cap: 2.0x.
- Stock Gross cap: 1.5x.
- Total Gross cap: 2.5x.
- No synthetic/test orders.
- Existing shared account lock, kill switch and Fail Closed behavior remain mandatory.

The 5x venue setting must not multiply strategy notional. It exists only to reduce initial-margin usage while the existing Gross contract determines actual exposure.

At Total Gross 2.5x, a 5x venue leverage corresponds to approximately 0.5x equity used as initial margin before other reserves. The target is therefore the same portfolio Gross exposure, not 5x P/L.
## Validation requirements

1. Add regression coverage showing a dynamic V12/Q102 symbol cannot increase exposure unless the venue-side 5x Cross requirement is satisfied.
2. Prove the failure path submits zero new exposure orders.
3. Prove the margin guard counts an active dynamic V12/Q102 position as managed.
4. Prove V12/Q102 strategy Gross calculations remain unchanged.
5. Run the existing V12, Q102, strict portfolio and margin-guard tests.
6. Run the canonical integrated backtest/parity checks and confirm no strategy-selection or Gross-contract drift.
7. Report every changed file, test command, result, and any runtime/config migration needed.

Do not deploy directly to LIVE from the implementation task. Produce a reviewed commit/branch first, with a separate deployment step after verification.

## Previously verified baseline

Before this handoff branch was modified, the relevant baseline tests passed: 20/20 selected Node tests, `V12_X1_ALL_SELFTEST_PASS`, and `QUALITY102_CAUSAL_V1_RUNNER_SELFTEST_PASS`.

The production code itself has not been changed by this handoff branch; this document is the implementation specification for Codex.
