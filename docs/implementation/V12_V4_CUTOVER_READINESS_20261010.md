# V12 V4 – cutover readiness, 2026-10-10

STATUS: BLOCKED_V4_REAL_ORDER_AUTHORIZATION_AND_VENUE_PARITY_INCOMPLETE.

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
- A real always-on V4 runner entrypoint now exists:
  scripts/v12-v4-production-runner.ts and lib/v12-v4-runner-engine.ts.
- Mock-venue full-cycle test: signed account -> durable reservation -> ENTRY ->
  independent fill -> resident STOP -> H1 TIME exit -> signed closing fill ->
  STOP removal -> flat. Resident STOP-triggered close and exact trade-id
  restart deduplication are also covered by dedicated tests.
- Native failed-upward-break event is mapped to the single frozen SHORT Core
  route with real H1 opening price and source ATR; cannot grant source parity.
- Signed-flat-only first-state bootstrap refuses any existing foreign exposure.
- Read-only Aster public market-data smoke probe completed.
- Local V4 tests and full TypeScript typecheck passed.

## Remaining engineering blockers – Codex cannot perform only a switch yet

1. The permanent Production runner code now exists, but deployment-time
   assertAuthority and assertSourceParity deliberately fail closed until
   independent signed V4 evidence and operator attestation are certified.
   Neither test success nor modifying a boolean authorizes live trading.
2. Core route mapping is implemented and mock-verified, but independent source
   parity for the 41 research routes and their full production entry order is
   still unverified on live historical data.
3. A stop-first mock fill and H1 TIME exit pass. Nevertheless, every TIME-only
   route lacks a contract-approved exchange resident emergency STOP blueprint;
   native trailing amendments, overlapping virtual legs, partial STOP resize
   and live protection are not fully certified against Aster.
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
