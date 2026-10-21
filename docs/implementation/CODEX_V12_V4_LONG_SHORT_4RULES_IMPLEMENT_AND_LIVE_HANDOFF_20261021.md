# Codex implementation request — V12 V4 LONG/SHORT 4 protective exits

**Status: USER REQUESTED IMPLEMENTATION HANDOFF. No LIVE work in this branch.
Use this branch as a SOURCE BUNDLE, not as an assumed production release.**

Repository: dunamishajime-bit/-ai-dex-manager
Bundle branch: codex/v12-v4-long-short-4rules-handoff-20261021
Contract: config/research/v12-v4-long-short-4rules-20261021.json

## Objective

Finish FULL production implementation, test, certify and — only once release
and venue safety requirements are actually fulfilled — deploy LIVE on Xserver
VPS. Prioritize limiting losses for both LONG and SHORT, accepting that
historical profit may decline. Never bypass existing legitimate protective
controls or claim LIVE while orders or runners remain blocked.

## Four exact policies

(A) LONG risk control: V12 V4 TIME 37 routes ONLY. Initial resident
reduce-only emergency stop is entry average fill -8%. Once prior causally
completed M5 high records >= +2% favorable excursion after entry, raise the
resident protective trigger to entry -5%; persist per-leg arm stage and NEVER
restore -8% on reboot/reconciliation. Handle slippage/gaps honestly.

(B) LONG profit protection: ONLY X09/X10/X14 TIME routes. If MFE >=+3%,
then two completed consecutive bearish H1 closes confirm retreat of the
position's gain to <= +1%, exit reduce-only at next executable quote.
This is NOT a guaranteed +1% fill. Do not expand to all37 without a new
BT and explicit authorization.

(C) SHORT early loss control: V12 V4 SHORT 41 routes eligible for research
policy, with route-native original exits preserved. After >=12 elapsed
hours, if prior maximum favorable excursion is BELOW +1%, and signed
entry-relative price has moved adversely +2.5% or more, perform causal
reduce-only early exit. Set same-symbol SHORT-only cooldown for 12 hours
starting ONLY on confirmed actual exchange EXIT fill, never on mere
candidate/reject/failed order; no LONG cooldown. TIME37 original
entry +8% emergency STOP remains resident until safely closed;
ATR3/NATIVE1 continue their individual exit policies.

(D) SHORT profit protection: V12 V4 TIME 37 SHORT routes ONLY.
After maximum favorable SHORT gain >=+5%, if the SHORT's remaining gain
drops to <=+2% while two fully completed consecutive bullish H1 closes
confirm the price rebound, cover reduce-only at next executable quote.
This is NOT a guaranteed +2% fill. PENGU is expressly unchanged.

Competing exits: evaluate independently using only already-known bars;
earliest causally eligible *actual* filled exit closes each leg;
resolve race with existing exchange STOP, pending cancel/replace,
partial fills, shared symbol ownership and one-way mode. No duplicate
or unprotected position and no future peeking.

## Existing implementation resources in this ONE branch

LONG pure policy:
lib/v12-v4-long-accepted-exit-policy.ts
tests/v12-v4-long-accepted-exit-policy.test.ts

SHORT pure policy:
lib/v12-v4-short-two-axis-research-policy.ts
tests/v12-v4-short-two-axis-research-policy.test.ts

Long research artifacts:
docs/research/results/v12-v4-long-route-risk-20261021/
Short research artifacts:
docs/research/results/v12-v4-short-risk-20261021/

Reproduction source scripts including Task9 research dependencies:
scripts/dd-reduction/
Shared Task9 research config:
config/research/task9-unified-v12-short-20261021.json

The pure TypeScript policies are NOT connected to LIVE runner orders.
The research scripts use modeled H1/M5 prices and do NOT certify signed
venue fill prices or Production parity. These scripts and their evidence
were checked against exact originating Git blob content.

## Required before Production activation

1. Inspect the REAL current GitHub Production SHA, VPS release/current
   symlink, rollback SHA, running Runner PIDs/restarts, open positions,
   orders, pending exposures, Shared Risk, Margin Guard, Kill Switch,
   rate-budget/account mutex, watchdog and disk. Do NOT assume this
   research branch is newer than the current LIVE release. If release
   mismatch or V4 abnormal inspection is present, identify and repair
   the cause; retain rollback.
2. Implement the 4 policies in an isolated worktree based on the actual
   CURRENT production runtime, preserving other recent changes. Build
   production M5 completed-bar and H1 completed-bar pipelines; persist
   signed fill average price, peak MFE, stage, stop quote, IDs and
   venue evidence to a durable journal. Restart/partial-fill/duplicate
   rejection and causal boundary tests are mandatory.
3. On LONG STOP upgrade, use exchange-authenticated stop-market
   reduce-only order, read back exact side/trigger/quantity/ownership,
   then retire old stop and read back uniqueness. If venue rules
   disallow simultaneous protective STOPs, design and certify a safe
   swap without a naked exposure window. A market gap can fill worse
   than the -5% trigger. Never claim a retrospective profit floor.
4. On SHORT early exit and profit cover, use signed exchange readback
   and exact one-time exit ownership; do not create premature cooldown.
   Preserve original +8% STOP until position is actually flat.
5. Run deterministic full 8-logic 4-policy COMBINED integrated economic
   BT with existing accepted LONG and SHORT options applied
   SIMULTANEOUSLY, 2025-08-10..2026-08-10, initial JPY 10,000,
   zero contributions, compounding, 10bps + 30bps, dynamic admission,
   route priority, quantity, gross/pending, shared limits, market MTM,
   H1/M5 causality and no position conflicts. Compare original baseline,
   LONG-only, SHORT initial-only, SHORT profit-only and ALL FOUR.
   You must NOT add prior separate-BT results arithmetically;
   no all-4-rule BT parity has yet been proven. Verify latest Task9
   independent engine exactly matches the implemented native strategy
   source at trade/leg and economic event level; fail closed on drift.
6. Preserve the explicitly risk-first operator preference and report
   (not conceal) historic wealth reduction. Existing SHORT combined
   30bps sample capital retention is ~64.7% of untouched baseline;
   SHORT profit addition WORSENS 30bps portfolio DD relative to
   SHORT initial stop alone. Existing economic acceptance gate FAILS.
   Document the exact gate, results and any separate user/operator
   authorization before overriding a financial risk acceptance rule.
   A V4 DD 21% target is a research benchmark, NOT a LIVE kill switch.
7. Run unit/integration/regression suite and CI for all routes:
   37 TIME/3 ATR/1 NATIVE, LONG vs SHORT, partial/unfilled,
   H1/M5 boundary, slippage/gaps, 12h countdown, same symbol
   cross-runner conflicts, restart & per-leg journal persistence.
   Certify real Aster STOP place/readback/cancel/exit/partial
   fill under authenticated venue conditions, non-production
   shadow/canary first if supported. Never fabricate venue proofs,
   manipulate operator approvals, bypass safety gates or directly
   force real orders solely to satisfy a test.
8. Operator exact-SHA artifact, release/rollback marker, rate budget
   and shared locks must certify the final release before a
   controlled LIVE cutover. Verify open positions/STOPs, Runner
   health, signal-to-order decision status, HP alignment and
   absence of abnormal alerts after cutover. If blocked, fix the
   fixable code/data issue and report the exact remaining blocker,
   without silently changing current LIVE orders.

## Required final report

- Integration branch + final commit SHA + GitHub remote SHA exact match.
- Which of A/B/C/D is implemented, in shadow, or genuinely LIVE.
- Current Production release SHA and rollback SHA (before and after).
- Actual 4-rule combined 8-logic economics and exact Task9 parity.
- Which CI/unit/venue checks passed and explicit order/fill evidence;
  no claims of actual orders without venue confirmation.
- Detailed all-runner/PID/order/position/pending/shared-lock/safety
  and HP status before and after, including any residual blockers.
- No unrelated strategy modifications, no PENGU changes, and no
  operator security gate bypass.

The user has requested a Codex implementation task, not approved
unsafe deletion/cancellation of unrelated LIVE positions. Prefer
production functionality complete over UI polish, but do not
sacrifice orders' resident protective coverage.
