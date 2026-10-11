# Codex handoff — V12 V4 4759 frozen candidate final read-only certification

Date: 2026-10-11 JST

## Scope

This handoff freezes the candidate and asks Codex to finish every remaining **read-only / no-trading-mutation** certification step. It does not authorize a real order, cancellation, position change, production certificate installation, operator activation artifact installation, canary order, or ordinary LIVE order authority.

Repository: `dunamishajime-bit/-ai-dex-manager`

Frozen candidate branch:
`research/v4-rate-budget-stop-recovery-20261011`

Frozen candidate SHA:
`4759dec0d8f3d8a55e09dbce97e3a9fd0dfae038`

Existing Production SHA:
`ce1edeead8d0f9e5d88e829d415057117502a335`

Policy:
`V2_M150_D05_CORE_NATIVE` / 41 routes.

Do not change the frozen candidate SHA. Any source change requires a new SHA and recertification.

## Evidence already verified

### GitHub / Linux

GitHub Actions run `38108814393` is SUCCESS on the exact frozen SHA.

The Linux run passed:
- root type checks;
- V4 lifecycle/fail-closed checks;
- full Linux root regression;
- UI contract tests;
- Linux UI production build.

The full root regression reports 171 root Node test files plus the V52 Python capacity test PASS. UI tests report 114 PASS / 0 fail.

The final CI step named “Adoption remains blocked” is an intentional guard. It explicitly states that code checks do not certify strategy adoption and that V4 order authority stays disabled.

### Staging

Actions run `38109173530` is SUCCESS.

Verified on Xserver VPS:
- candidate staged at `/home/deploy/disdex-trading/releases/4759dec0d8f3d8a55e09dbce97e3a9fd0dfae038`;
- `SELF_TEST_PASS`;
- `routes=41`;
- `realOrderEnabledV4=0`;
- current remained `ce1edeead8d0f9e5d88e829d415057117502a335`;
- orders sent = 0.

### Flat reconciliation / cutover preparation

Actions run `38109261404` is SUCCESS.

Verified:
- Aster positions = 0;
- Aster open orders = 0;
- orders sent / cancels / position changes = 0;
- stale legacy V12 ETH state reconciled from signed fill history;
- `reconciliationStatus=PASS`;
- `V12_STATE_FLAT=TRUE`;
- V4 Canary and Production systemd templates installed;
- V4 Canary inactive;
- V4 Production inactive;
- Canary permit absent;
- Production certificate absent;
- current SHA unchanged.

The later failed reruns `38109805132` and `38109808253` are not new trading failures. They reran stale-state assumptions after reconciliation had already completed. The diagnostic readback showed:
- `STATE_ACTIVE=False`;
- `STATE_MANUAL_REVIEW=False`;
- `STATE_RECONCILIATION_STATUS=PASS`;
- zero orders/cancels/position changes.

### Legacy V12 retirement

Actions run `38109440903` is SUCCESS.

Verified:
- legacy V12 state flat;
- Aster flat;
- old unit stopped;
- old V12 unit masked at runtime;
- `OLD_V12_MASKED=TRUE`;
- V4 Canary inactive;
- V4 Production inactive;
- no Canary permit;
- no Production certificate.

Do not unmask or restart the old V12 during certification.

## 41-route evidence

Exact candidate repository evidence:
- external 25 routes: Entry replay 258/258 PASS;
- external 25 routes: Exit replay 258/258 PASS;
- remaining historical 16 routes: source/Entry/rank/Gross 212/212 PASS;
- remaining historical 16 routes: independent H1 Exit price-model 212/212 PASS.

This is not permission to claim 41/41 independent unseen-period broker execution. Preserve that distinction.

## Rate-budget and resident STOP hardening

The frozen SHA contains the rate-budget / STOP recovery changes.

Regression evidence includes:
- reconciliation traffic sheds before consuming protective headroom;
- protective Aster calls use protective priority;
- market-data reads shed earlier than reconciliation;
- global shared budget lock/cooldown handling remains fail-closed;
- restart after a venue-accepted STOP response loss reads the STOP back and does not duplicate ENTRY or STOP;
- additional cumulative ENTRY fill re-arms a larger STOP before retiring the smaller one;
- V4 Canary and Production systemd units restart after fail-closed exit so protection recovery can run.

Do not relabel these mock/regression checks as authentic venue lifecycle evidence.

## TIME37 exact-SHA boundary

The operator previously adopted the TIME37 fixed 8% emergency policy at source SHA
`cb945768dc2903b4c4c7373a5e8688fde2fe0031`.

The following files have identical Git blob SHA at that approval SHA and at the frozen 4759 SHA:
- `lib/v12-v4-time-stop-approval.ts`;
- `lib/v12-v4-production-lifecycle.ts`;
- `lib/v12-v4-time-emergency-stop-research.ts`.

Therefore the policy semantics did not change, but the existing root approval artifact is SHA-bound and must not be rewritten or reused as if it already approved 4759.

Codex may verify and prepare the exact 4759 artifact payload for operator review, but must not install or fabricate a renewed approval without an explicit operator action.

## Real-venue certification — preferred order

Testnet is optional. Follow:
1. `AUTHENTIC_PRODUCTION_HISTORY` first.
2. Only if authentic history cannot establish the required semantics, report exactly which lifecycle proofs remain absent.
3. Do not place a controlled Production canary from this handoff. A canary requires its own separate operator authorization.

Run the repository’s signed-GET-only Production history audit against the current Production release and preserve sanitized SHA-256 evidence. It must remain:
- production host = true;
- mutationCalls = 0;
- secretDisclosed = false.

Determine whether authentic existing records can prove, without inference:
- signed orders;
- signed positions;
- restart recovery;
- same-symbol STOP/EXIT race protection;
- partial-fill/re-protection behavior;
- reduceOnly / remaining quantity / normalized STOP trigger identity.

A flat GET alone is insufficient.

## Fresh final read-only audit required

At one coherent observation window, collect and report:
- current symlink and release marker;
- candidate staged marker;
- legacy V12 runtime mask;
- V4 Canary/Production unit inactive state;
- all other runner PIDs, NRestarts, WorkingDirectory, actual state source;
- Aster positions and open orders;
- shared pending exposure;
- account/shared lock;
- shared Aster rate-budget state;
- Shared Risk;
- Margin Guard;
- Kill Switch;
- watchdog/supervisor state;
- disk free space;
- operator artifact presence/metadata only;
- TIME37 artifact metadata/readback only.

Use no order, cancel, flatten, or position mutation.

## Operator-only adoption items

Do not silently turn these into PASS:

1. The final SHA-bound TIME37 approval must be renewed legitimately for 4759.
2. External/Y06 underperformance must be presented to the operator. Do not set `forwardUnderperformanceAcknowledged=true` unless the operator explicitly accepts that risk.
3. The V4 Production certificate requires authentic real-venue lifecycle SHA-256 proofs and exact 41-route metadata.
4. The separate V12_V4 operator activation scope remains independent from the seven legacy runner scopes.

Codex may compute candidate certificate hashes and produce a proposed certificate for review, but must not install a certificate or activation artifact and must not enable real-order authority under this handoff.

## Required final Codex report

Return one of:

`READY_FOR_OPERATOR_FINAL_ACTIVATION`

only when every non-operator technical condition above is independently proved and the only remaining steps are explicit operator approvals / activation;

or

`BLOCKED_<EXACT_REASON>`

with the exact missing evidence.

The report must include:
- frozen branch + SHA;
- current Production SHA;
- rollback release;
- CI run IDs;
- staging / reconciliation / old-V12-retirement run IDs;
- all 41-route evidence counts;
- current signed Aster account readback;
- lifecycle evidence mode;
- proof hashes;
- runner/risk/margin/kill/lock/rate-budget/watchdog/disk readback;
- exact operator-only items still outstanding.

Do not report `LIVE_ACTIVE` or `LIVE_V4_FULLY_VERIFIED` from this read-only handoff.
