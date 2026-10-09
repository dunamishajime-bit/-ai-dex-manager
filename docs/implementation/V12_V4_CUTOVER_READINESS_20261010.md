# V12 V4 – cutover readiness, 2026-10-10

STATUS: BLOCKED_V4_RUNNER_AND_PORTFOLIO_CERTIFICATION_INCOMPLETE.

Repository: dunamishajime-bit/-ai-dex-manager
Branch: codex/v12-v4-production-cert-20261009
Production VPS baseline: ce1edeead8d0f9e5d88e829d415057117502a335
Policy: V2_M150_D05_CORE_NATIVE, 41 unchanged routes, frozen rank and gross.
Research DD cap approved 21%; historical DD 10bps -20.420014%.
Gross: V12 3.0x / crypto 3.5x / total 4.75x / recovery 2.5x.
External-period research remains weak (Y06 PF ~0.30, other test ~0.57).

## Implemented (not authorization)

- Completed H1/H2 market-data adapter; native H2 signal extraction and
  read-only failed-break Core replay.
- Durable order IDs and intents, shared pending exposure reservations.
- Fresh signed venue position/open-order comparison to eight runner owners.
- Real V4 positions kept distinct from peer positions in account gross.
- Signed entry and reduce-only exit fill reconciliation, including partial
  fills, fees and restart deduplication.
- Single-owner funding allocation with ambiguous attribution denied.
- Read-only Aster public market-data smoke probe completed.
- Local V4 tests and full TypeScript typecheck passed.

## Remaining engineering blockers – Codex cannot perform only a switch yet

1. The real order-authorized, always-on V4 Production runner does not exist.
   Current candidate daemon intentionally has zero real order authority.
2. Native failed-break Core source is not integrated into final live entry
   admission and entry-price evidence for the complete 41-route strategy.
3. Route-specific resident STOP/TP, trailing amendments and time-based exits
   are not end-to-end bound to real broker protection/virtual-leg ownership.
4. Funding/paginated trade history completeness and all eight independent
   current-runtime programs have not passed integrated external replay.
5. Signed current account readback, operator artifact and shared Gross caps
   must be coherently certified for the final release with rollback.
6. The full-year priority is retrospectively optimized; external PF below 1
   has not been resolved by raising the DD tolerance from 20% to 21%.

## CodeX acceptance boundary

Do not enable orders merely because unit tests, TypeScript or CI are green.
Before a deployment-only handoff, independently prove 41-route signal/exit
parity, no duplicate order authority, native market-data timestamp correctness,
resident STOP protection, funding/accounting, restart recovery, current positions
and open orders, all-eight gross ownership, release signature and operator
activation. Use the existing runtime only until those checks all pass.

This file is a truthful implementation status, not an approval token or a
release artifact.
