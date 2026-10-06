# Codex Handoff — Formal Priority / Cooldown LIVE Implementation

Use branch:

`research/formal-priority-cooldown-20261003`

Base production SHA:

`53eeff5417636369d4709fddfd47d7916ddcf3b1`

Read first:

1. `docs/implementation/FORMAL_PRIORITY_COOLDOWN_CONTRACT_20261003.md`
2. `docs/research/results/formal-priority-cooldown-20261003/formal-bt-summary.json`

## Ledger completion gate

Before deploy, read `docs/research/results/formal-priority-cooldown-20261003/manifest.json`.
If its `status` is not exactly `COMPLETE`, or either canonical 10bps ledger SHA256 is missing, **do not deploy**. The formal result summary is already frozen, but the canonical transaction/candidate ledgers must be present and hash-pinned first.

## Goal

The research branch already contains the requested source-level delta. Codex should **validate the delta, fix only integration/compile/test defects if found, deploy it safely, activate LIVE under the existing operator-gate contract, and update the HP**. Do not redesign the strategy or substitute a different sizing/cooldown rule.

## Source delta already encoded

- `config/v12X1AllRuntime.ts`
  - Rank3 Gross cap 0.50.
  - Cooldown contract documented as one 2h bar from actual exit.

- `lib/v12-formal-priority-policy.ts`
  - Rank1/2 1.00 Gross.
  - DOGE/LTC Rank1/2 0.50 Gross.
  - Rank3 0.50 Gross.
  - Q102 handoff families PB/REV/HIGH_VOL only.
  - Q102 V12 victim order Rank3 -> Rank2 -> Rank1.
  - per-symbol actual-exit +2h cooldown helpers and legacy-state compatibility.

- `lib/v12-x1-all.ts`
  - formal fixed Gross target applied at portfolio admission.
  - HC175 remains attribution/gating metadata rather than Gross amplification.

- `lib/v12-x1-all-runner-state.ts`
  - durable `symbolCooldownUntilTs` map.

- `lib/v12-live-execution-engine.ts`
  - protection-fill reconciliation derives cooldown from venue fill `updatedAt`, not `lastReferenceTs`.
  - explicit/reconciled exits set per-symbol actual-exit cooldown.
  - Rank3 is pure residual and may be preempted by a stronger V12 signal.
  - fixed Gross target is used even when the old ATR/risk sizing request is lower.
  - cooldown is checked per candidate symbol.

- `lib/v12-q102-priority-preemption.ts`
  - whole-position V12 preemption executor for Q102.
  - reduce-only execution with venue reconciliation.
  - Rank3 -> Rank2 -> Rank1 order.
  - actual-fill cooldown persisted for every victim.
  - fail-closed on stale quote, unknown execution, remaining venue position, missing exit timestamp, pending/manual-review state.

- `lib/disdex-quality102-causal-v1-runner.ts`
  - capacity-short Q102 PB/REV/HIGH_VOL uses the formal V12 preemption executor.
  - MR/BRK cannot reclaim V12 through this path.
  - refreshed account/position/quote state is used before final Q102 admission.

- tests changed/added:
  - `tests/v12-winrate-entry-gate.test.ts`
  - `tests/v12_top3_rank3_contract.test.ts`
  - `tests/v12_top2_state.test.ts`
  - `tests/v12_formal_priority_policy.test.ts`

## Required validation before LIVE

At minimum run TypeScript compile plus all V12/Q102 tests, including the four files above and the existing V12 quantity/reservation/protection/runtime-lineage and Q102 portfolio/pending/preflight tests.

Specifically prove:

- ETH/SOL etc Rank1/2 target Gross = 1.00.
- DOGE/LTC Rank1/2 target Gross = 0.50.
- Rank3 target Gross = 0.50 and cannot coexist as a same-decision lower-priority add when Rank1/2 is eligible.
- 5x Cross is venue margin configuration only.
- PB/REV/HIGH_VOL can reclaim V12; MR/BRK cannot.
- victim ordering is Rank3, Rank2, Rank1.
- every forced/normal exit produces symbol cooldown from actual venue fill timestamp +2h.
- another symbol is not blocked by that cooldown.
- same symbol cannot re-enter until the new confirmed opportunity after cooldown.
- no blind retry on unknown order state.
- existing protective orders and operator/runtime SHA gates remain fail closed.

## Deployment / LIVE

Do not deploy from a dirty worktree. Produce one deployment release SHA, push it, verify remote SHA equality, then deploy that exact SHA. Preserve current open positions/protection unless strategy logic itself requires an exit.

After rollout verify all relevant services on the exact release SHA, especially V12, Q102, Shared Risk and Margin Guard. Verify Kill Switch false unless there is a real safety condition.

## HP changes

Update dashboard/decision/history surfaces so the new contract is visible:

- V12 Rank1/2 Gross 1.00, DOGE/LTC 0.50, Rank3 0.50 residual.
- same-symbol cooldown display must show actual exit timestamp and cooldown-until.
- Q102 PB/REV/HIGH_VOL priority handoff and victim rank/reason.
- MR/BRK shown as no-V12-handoff.
- history exit reason for Q102-preempted V12 positions.
- official 10bps formal BT headline:
  - JPY 1,229,065,462.0472791
  - PF 2.4887028036012624
  - Max DD -21.296368751349548%
  - 1,275 trades
  - accounting PASS
- label this as H1 causal price-model formal BT, not historical L2 verification.

Do not overwrite or relabel the earlier accepted-intent diagnostic replay as the formal result.
