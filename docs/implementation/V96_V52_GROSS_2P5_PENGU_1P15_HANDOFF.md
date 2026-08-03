# V96 + V52 Production Handoff: Gross 2.5 / PENGU 1.15

## Source boundary

- Branch base: `cb7080742bf8d937dc0e48415f21c526a2abcaf4`
- This branch is a direct descendant of the currently reported VPS LIVE release.
- It replaces the invalid document-only SHA `d794c25917c9d32c1b7acc270c906862f5195780` for Production deployment.

## Approved target limits

- V96 PENGU target Gross: `1.15`
- Operator Override PENGU cap: `1.15`
- PENGU profile: Long-strengthened A plus Short candidate with an 18-hour holding window.
- V96 / shared portfolio maximum Gross: `2.5`
- V96 Core remaining capacity when PENGU is fully active and no Stock exposure exists: `1.35`
- Stock sleeve maximum: `1.5`, but only within the shared portfolio residual.
- Combined portfolio Daily Loss limit remains `5%`.
- V96 Operator Override Daily Loss maximum remains `5%`.
- Kill Switch behavior is unchanged.

## Cross-sleeve Gross enforcement

The Crypto child is allowed to use up to Gross `2.5`, but the V96 execution-capacity planner subtracts all authenticated non-V96 positions before sizing an exposure-increasing order. Therefore existing V52 Stock or other external Aster exposure consumes the same Gross `2.5` ceiling.

Examples:

- PENGU `1.15` + V96 Core `1.35` + Stock `0.00` = `2.50`
- Existing Stock `1.50` permits at most additional V96 Gross `1.00`
- Existing Stock `1.00` permits at most additional V96 Gross `1.50`
- Any exposure-increasing order projecting portfolio Gross above `2.50` is proportionally reduced or blocked.
- Reduce-only safety orders remain allowed.

## Leverage precondition

Gross above `1.0` requires authenticated venue leverage. The read-only preflight now verifies all managed V96 symbols:

- `BTCUSDT`
- `ETHUSDT`
- `BNBUSDT`
- `SOLUSDT`
- `PENGUUSDT`

Each must report Aster leverage of at least `3x`. If any row is missing or below `3x`, preflight fails closed and sends no orders. Changing exchange leverage is not performed by this repository change.

## Mandatory VPS sequence

1. Keep the current LIVE service unchanged until the new exact Production SHA is reviewed.
2. Stop `disdex-v96-v52-live.service` before approval renewal or release switching.
3. Build a new immutable release from the exact branch head SHA.
4. Run install, TypeScript checks, V52 contract tests, V96 self-tests, execution safety tests and `scripts/disdex-v96-gross-2p5-selftest.ts`.
5. Confirm Aster managed-symbol leverage is at least `3x` through authenticated read-only data.
6. Migrate state through the existing formal migration path. Do not copy or relabel old state approval data.
7. Reissue execution parity for the exact release SHA and new Configuration Fingerprint.
8. Reissue Operator Override using:

```text
DISDEX_V96_INITIAL_PENGU_GROSS=1.15
DISDEX_V96_MAX_GROSS=2.5
DISDEX_V96_MAX_DAILY_LOSS_PCT=5
```

9. Run the read-only preflight. Required outcome:

```text
ordersSent=false
cancelSent=false
positionChangesSent=false
stateChanged=false
approvalChanged=false
requiredExecutionLeverage=3
```

10. Restart LIVE only when every gate passes. Otherwise remain stopped or retain the existing release without modification.

## Safety boundary of this GitHub change

This change does not:

- deploy to the VPS;
- stop or restart systemd;
- send, cancel or replace orders;
- modify positions;
- modify runtime state;
- create, revoke or replace approval artifacts;
- activate or clear the Kill Switch.
