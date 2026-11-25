# H48R4 WSIG native reconstruction — 2026-11-25

## Exact scope and source

- Research inputs on Owner PC (unmodified):
  - `C:\tmp\disdex-bt-20251001-20261001\hype_h48r4_market_regime_gate_pretarget_v1_20261113.py`
  - `C:\tmp\disdex-bt-20251001-20261001\hype_h48r4_pretarget_winner_signature_v1_20261114.py`
  - `DIRECTION_RESEARCH_20261109/hype_h48r4_pretarget_winner_signature_v1_20261114.json`
- Research selection JSON SHA256: `05632294b05a64c2fe28bbff63d191feed88d0e80e4eb3fd37e7f16bc67977a9`
- Immutable historical H48 certificate source: `4786f600ae7bf86ffca948f1412956a9113cb20d`, plan `8af6e4eb73e53f63f7f7d441f171176cc420090a8ab29faaacf4f01427a3822d`
- Research selection used PRE-only feature families; target and forward prices were **not** used to refit thresholds.
- Golden fixture: `tests/fixtures/hype-h48-r4-wsig-h1-golden-20261114.json` includes 27 genuine target and 2 forward entries, previous 25 closed HYPE/BTC H1 closes, and exact 48h exit opens and simple returns.

## Frozen entry and exit semantics

- Entry hours on UTC six-hour grid.
- Signal is evaluated strictly at the previous completed 1h bar: signalTs = entryTs - 1h.
- HYPE 12h return <= `0.004297852251518686`.
- HYPE 24h return >= `0.02047426596091347`.
- HYPE 24h return minus BTC 24h return <= `0.026202553353817715`.
- Requires 25 consecutive complete hourly closes for both pairs, the entry-hour opening price with a current observation no older than 120 seconds, no overlapping HYPE position, and exact source pin.
- Exit: 48h after logical entry, **at the verified next bar open**. Never substitute a pre-48h stop-based exit for H48 source parity. The separate risk governance/STOP policy must be assessed before any real trading.
- Implementation: `lib/hype-h48-research-entry.ts` and `lib/hype-h48-native-lifecycle.ts`.
- ENTRY and POSITION read-only attestations call an injected narrow authority matching the existing Root-certificate and account-lease authority interface; the production authority is defined in `lib/hype-stable4-time-only-authority.ts`. This code **does not** submit orders, cancel orders, or change positions.

## Independent verification

- Historical research golden fixture: 27 target + 2 forward H1 snapshots; all 29 entry features and 48h exit open / returns matched the frozen Python research.
- Local Node TS tests: 7/7 entry and parity, 4/4 authority-attestation lifecycle.
- Negative tests cover stale/missing/duplicate/future hourly data, non-6h entries, overlapping positions, wrong SHA, wrong route, unverified next-open exits, invalid quantity, and forged policy evidence.
- The original PRE-only frozen filter's **TARGET** 30bps trade win rate was `16/27 = 59.26%`; its **FORWARD** 30bps sample had only 2 trades, 50% wins and negative mean of about `-0.924%` per trade. This is **not sufficient** evidence for an 80% win-rate LIVE deployment.
- These tests prove parity **of selected entry/exit events**, not full capital-equity replay, venue execution, DD, fees/funding, STOP or entire integrated STABLE4 behavior.

## Remaining production blockers

1. The active HYPE daemon is SHA 4786 in **SHADOW** (verified on VPS), not a signed LIVE H48 executor.
2. Current TREND runner remains a different strategy with STOP/TP exits. It does **not** call the H48 native ENTRY/POSITION authority; the PR #666 preapproval check must continue to reject it.
3. Root-owned LIVE activation, account ownership and writer exclusivity, signed ASTER GET, margin/risk freshness, exact gross and STOP parity, durable H48 pending/fill state and recovery remain unproven.
4. Old e0e4 order permit, legacy overlays, and canonical GLOBAL HOLD need an explicit formal revocation/provenance procedure. Do not delete, clear, or rewrite them by hand. Related HOLD receipt provenance correction: PR #667.
5. New native source bytes change the release SHA. An immutable new release, fresh source/plan-bound formal certificate and **new Owner-signed order-enable approval** will be required; never rebind the already redeemed SHA 4786 token by editing a hash.
6. No new order permit, LIVE switch, deployment, cancellation, or position modification occurred during this repair.

**Deployment decision: HOLD_PROTECTED / SHADOW until every blocker is resolved.**

## Additional critical parity repair: base-first 48h blocking

After inspecting the *actual historical 6-hour timeline*, we found a causal
mismatch in the initial candidate evaluator's use as a sequential strategy:

- Source Python first chooses the non-overlapping **BASE** candidates
  (HYPE12/HYPE24), with a 48h lockout for *every selected BASE event*.
- Only **after** this lockout does it apply the frozen WSIG relative24 filter.
- A rejected WSIG candidate STILL occupies the underlying BASE 48h interval.
- In 2025-10-01 to 2026-10-01 evidence: 84 BASE signals; 62 BASE survivors;
  the correct 27 WSIG events. Applying WSIG *before* lockout creates 31
  hypothetical trades (an unjustified change to the historic strategy).
- New pure sequence module `lib/hype-h48-research-sequence.ts` uses this
  BASE-before-WSIG order and rejects missing/replayed six-hour grid events.
- Independently extracted `tests/fixtures/hype-h48-r4-base-event-golden-20261114.json`
  with 84 actual H1 BASE cases and the original 27 selected timestamps.
- 4 additional replay tests PASS, including 27/27 exact event identity and
  the 31-trade incorrect-order negative control.
- The sequence is **research-exact**; a LIVE implementation must persist it
  independently of real account positions, keep strict clock/data freshness,
  and add venue/risk filters *after* this research sequence.

## Crash-safe order intent journal — implemented but not LIVE wired

- `lib/hype-h48-execution-journal.ts`: separately pinned H48 ENTRY/EXIT
  intent state machine, deterministic idempotency IDs, and exact mode
  transitions `FLAT → ENTRY_PENDING → OPEN → EXIT_PENDING → FLAT`.
- An attempted order must be recorded before making an exchange request.
  A missed/expired authorization and a signed GET preceding submission are
  rejected; UNKNOWN/partial execution and contradictory venue positions
  transition to MANUAL_REVIEW, not automatic retries.
- `lib/hype-h48-journal-store.ts`: dedicated atomic, versioned journal
  store. A missing file is **NOT** interpreted as a flat book; initial
  creation requires a recent flat signed venue read and ASTER account lease.
  Stale revision, forged state transition, corrupt file, untrusted parent,
  stale/missing lock and conflicting state fail closed.
- Original focused suites: sequence 4, execution journal 8, journal store
  (since expanded), entry/exit parity 7, policy attestation 4.
  See the final 46/46 local-test record below. Whole-repository
  `tsc --noEmit` passed in the isolated owner-PC worktree.
- The storage and journal modules have NO exchange order/cancel functions,
  and are not yet connected to the running SHADOW daemon.
- IMPORTANT: GitHub H48 workflow contract passing does not mean that all
  these new test suites have run in Actions; the 27 focused suite results
  and `tsc` evidence above came from the isolated owner PC.

## Outstanding LIVE readiness requirements (not bypassable)

1. Implement and independently test the actual signed ASTER execution caller
   in a **new immutable H48 source release**, with durable mark-attempted
   before each request, post-call signed reconciliation, pending exposure
   reservations, and a restart recovery that never repeats UNKNOWN orders.
2. Prove the real LIVE runner wires the native H48R4 sequence and 48-hour
   exit/Root ENTRY+POSITION authority rather than the legacy TREND+STOP path.
3. Resolve the explicit H48 `residentStopRequired:false` certificate against
   required Shared Risk, DD, emergency STOP/protective exits, and the agreed
   hard-stop protections **before** allowing any exposure.
4. Validate Gross 3.0/4.0/4.25/HYPE 1.5 and all other portfolio constraints
   with fresh signed venue and scheduler data, across all affected runners.
5. Formal Root/Owner old-permit revocation, HOLD receipt provenance, new
   source/plan-bound certificate, signed LIVE activation and permit.
6. Long-run H48 BT/walk-forward and independent adverse scenarios, not
   merely the selected 29 trade-event parity. The original forward sample
   contains only two trades and cannot substantiate an 80% win-rate target.

**Live trading remains intentionally disabled. Do NOT merge or deploy this
candidate as an authorized H48 LIVE executor.**

## 2026-11-25 final read-only H48 pipeline checkpoint

New modules added to this Draft PR since the initial 27-test checkpoint:

- `lib/hype-h48-authenticated-readback.ts`: obtain ASTER Futures positions,
  open orders and venue-time-verified account balance via read-only
  authenticated GET APIs, inside the same immutable ASTER account lease;
  reject malformed/non-fresh GET, changed lease, bad quantities and HTTP errors.
  The adapter itself cannot execute/cancel orders.
- `lib/hype-h48-restart-admission.ts`: inspect a persisted exact-SHA journal
  and fresh venue inventory before restart. FLAT is only accepted if no HYPE
  position and no HYPE open order; OPEN requires the same long position size
  and entry price as recorded; all PENDING states stay in reconciliation HOLD.
  Never auto-resubmit UNKNOWN/partial orders on restart.
- `lib/hype-h48-native-monitor.ts`: connected read-only runner pipeline for
  6-hour research grid decisions, atomic journal checkpoint, and exact 48-hour
  next-open exit surveillance. DUE without a formally authorized executor is
  reported `EXIT_DUE_NOT_AUTHORIZED`, not sent as a SELL order.
  This is an offline candidate, NOT deployed to the VPS SHADOW service.
- `lib/hype-h48-journal-store.ts`: improved crash persistence with a
  process-exclusive, crash-sticky writer lock and Linux directory fsync.
  A stale lock fails closed, rather than assuming interrupted work completed.
  If an existing SUBMITTED attempt is being reconciled, persistence requires
  the exact original order result **and** observed venue position evidence
  and independently re-runs reconciliation; no fabricated SUBMITTED→FLAT.
- `lib/hype-h48-production-gates.ts`: non-authorizing cross-check of
  GLOBAL HOLD, current vs. Owner-approved Gross, daily Shared Risk, Margin
  Guard, pending exposure, DD30 and H48 no-resident-STOP vs. hard-STOP policy.
  This audit **ALWAYS** says BLOCKED and cannot issue an order permit.

Latest owner-PC verification for GitHub branch
`fix/h48-native-lifecycle-20261125`:

| Offline focused test suite | Passed |
|---|---:|
| Frozen research entry and genuine ASTER H1 parity | 7/7 |
| Base-before-WSIG six-hour research sequence | 4/4 |
| Root-backed read-only ENTRY / POSITION attestations | 4/4 |
| Order-intent/reconciliation state machine | 8/8 |
| Atomic journal, crash lock and required order proof | 6/6 |
| Authenticated GET and lease freshness | 5/5 |
| Restart ownership and no-retry admission | 4/4 |
| End-to-end read-only H48 monitor pipeline | 4/4 |
| Gross / DD30 / STOP / GLOBAL HOLD diagnostic | 4/4 |
| **Total** | **46/46** |

TypeScript whole-project `tsc --noEmit`: **PASS**.
H48 scoped PR CI: successful on the checked candidate HEAD (confirm latest
HEAD before merge; new offline suites are independently run locally).
Trading mutations: **zero**.

The work is still NOT a certified H48 LIVE executor. No new immutable release
or source-bound Owner/Root approval has been issued for these new files. Old
immutable SHA 4786 certificate and receipt must not be reused for this
changed source. The old e0e4 order permit and previous HOLD provenance require
formal review, and the conflict between `H48_TIME_ONLY` no-resident-STOP
and hard-stop/DD/protected-exit governance remains unresolved. Until a new
signed risk/STOP/permission plan, ROOT validation, independent full LIVE path
and actual venue reconciliation are proven, keep GLOBAL HOLD protected.
