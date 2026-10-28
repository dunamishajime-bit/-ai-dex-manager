# Q102 scoped operator promoter / 2026-10-28

**Status: IMPLEMENTED_IN_REVIEW_BRANCH, FAIL_CLOSED, NOT LIVE.** This document does not grant permission to bypass an unavailable economic or signed venue certificate.

## Scope and unchanged production
- Target Q102 SHA `ef1ab178e26a7bf5bddb6473467765edba242e1d`, old LIVE SHA `7688ed7c93a1918d8b44837339b7da5584a868f5`.
- Stage: `/home/deploy/disdex-trading/staging/q102-ef1ab178e26a7bf5bddb6473467765edba242e1d-20261028`.
- Candidate is a historical `CAUSAL_V4` signal change: it removes an account-wide other-runner occupancy veto, but retains Q102 one-slot, same-symbol, planner/shared gross/risk/order-lock conditions and cannot displace existing runner exposure.
- Old Q102 systemd instance, V4 and all peer systemd instances, positions, stops and shared approval are not touched by code review/testing.

## Owner-only activation dependency
Existing master workflow `.github/workflows/disdex-q102-owner-approved-live.yml` (PR #276) restricts dispatch to `dunamishajime-bit` and requires protected `q102-production-manual` owner review. It delegates to `sudo -n /usr/local/sbin/disdex-q102-owner-approved-promote TARGET_SHA OLD_SHA`.
The new operator-side script in this PR provides that executable's **source**, not a running VPS deployment.

## Preconditions; all must be proved independently
1. Reviewed source and CI exact commit SHA, target immutable stage release marker plus source-file SHA-256 digests; Q102/PENGU/UI three target CI PASS.
2. **Exact target Q102 Causal V4 8-strategy shared-wallet** 10bps and 30bps economics (not a historical archived Native8 proxy), including identical signal and exit source, latest V4 C/D and RENDER policies, capital contention, deterministic ledgers, costs, Gross Q102=3/Crypto=3/Total=4.25 and DD. Root-owned economic certificate at `/var/lib/disdex/quality102-causal-v1/economics/exact-eight-native.json`, schema `q102-exact-eight-native-economics/v1`, `status=CERTIFIED_NEW_Q102_CONCURRENCY_NATIVE8`, source hashes verified. **This certificate does not currently exist; never create an unearned PASS.**
3. Root-owned `0600` Q102-only operator artifact at `/var/lib/disdex/quality102-causal-v1/operator-activation/current.json`, exact target SHA and no non-Q102 approved runners.
4. Old LIVE Q102 state valid, position/pending empty; global operator approval unchanged and pinned old SHA, shared Kill Switch off, shared daily risk valid and below 7.5%, no old/new dual-runner.
5. Signed Aster read-only GET preflight against staged target using **isolated SHA-copy state**, with no real, test or synthetic order, no state mutation, managed protective orders reconciled.
6. Exact target env/drop-in, copied immutable release, atomic flat-state migration with old-state backup, stop old before start new, live health and signed post-activation monitoring.
7. On ambiguous post-start failure do **not** restart old or delete new state before explicit signed venue reconciliation; this avoids a duplicate-open exposure.

## Safety details
- The promoter is disabled by the absence of independently certified economics and Q102-only authorization; `--check` is also blocked until preconditions are met.
- The legacy selector `QUALITY102_LIVE_ENABLED=false` must remain false; active Causal V4 flags use their separate names.
- Never overwrite the shared `/var/lib/disdex/shared/operator-activation/current.json`; it authorizes other runners.
- No authorization renewal via a guessed order, test order, or manually edited economic PASS.
- All script tests use offline fixtures, never exchange credentials or Orders API.
- Current research Native8 sensitivity results distinguish *archived-proxy* from exact-SHA certification. A 10/27 C/D+RENDER Native8 model is newer than the 10/24 control and must be reconciled.

## Operator recovery and mandatory review
The promoter is an initial implementation, not approved for unattended real-money activation until independent security review, full branch CI, signed Aster/STOP readback, environment parser compatibility, source provenance, process privilege/lifecycle and crash-window checks are completed.
Do not enable deploy-user sudo or install for real-money cutover merely because its local unit tests pass.
