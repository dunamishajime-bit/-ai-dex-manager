# V12 V4 — release-bound peer owner integration evidence (2026-10-10)

**STATUS: CODE VERIFIED LOCALLY, LIVE NOT ACTIVATED.** No broker orders, existing
positions, production releases or root authorization artifacts have been changed.

## Read-only VPS observations (original Production ce1edeea)

| Peer | Actual live state file | Current legacy-state obstacle |
|---|---|---|
| V12 | /var/lib/disdex/v12-x1-all/runner.json | flat state omits optional activePositions; old V12 must be stopped before V4 first entry |
| PENGU | /var/lib/disdex/pengu-dual-ls-v2/runner-live.json | v2-final path is stale; runtimeCommitSha absent from legacy serializer |
| Q102 | /var/lib/disdex/quality102-causal-v1/state.json | no position key on flat state; state file can stay unchanged while service runs |
| V52 | /var/lib/disdex/v52-aster-only/runner-live.json | Python state writer did not persist runtimeCommitSha |
| FET | /var/lib/disdex/fet-brk48-residual/state.json | canonical flat state may omit position |
| HYPE_LONG | /var/lib/disdex/hype-zec-long/runner.json | canonical flat state may omit positions |
| IDLE | /var/lib/disdex/idle-priority/state.json | canonical positions array |
| RESIDUAL | /var/lib/disdex/idle-priority/residual-long-state.json | same IDLE systemd unit, not an extra independent Runner |

Observed legacy processes are release-scoped systemd instances
`disdex-v12-x1-all@`, `disdex-pengu-dual-ls-v2@`,
`disdex-quality102-causal-v1@`, `disdex-v52-aster-only@`,
`disdex-fet-brk48@`, `disdex-hype-long@`, and
`disdex-idle-priority-short@` (IDLE also owns RESIDUAL).

## Code preparation and safety invariants

1. `lib/pengu-dual-ls-v2-runner-state.ts` emits the **real** 40-hex
   `DISDEX_RELEASE_SHA` when its LIVE state is next safely saved.
   `deploy/systemd/disdex-pengu-dual-ls-v2@.service` stages
   `DISDEX_RELEASE_SHA=%i`.
2. The **actual** Python V52 engine
   `scripts/disdex_v52_aster_only_live_engine.py` now writes the same
   optional release lineage without changing its existing stock strategy.
   Candidate root-controlled unit drop-in
   `deploy/systemd/disdex-v52-aster-only-release-lineage.conf`
   must be installed by Codex at controlled release promotion.
3. `scripts/v12-v4-production-runner.ts` now fetches the actual seven
   root-managed service unit identities using **read-only** systemctl.
   A stale, dormant peer state is accepted only with the matching exact SHA
   service active/running, nonzero PID, and the previous valid state no older
   than six hours. The **systemd ExecStart and WorkingDirectory must also
   reference exactly the same immutable release SHA**, not just the unit name.
   A missing actual SHA is never fabricated.
4. The old V12 is a **replacement**, not an eighth simultaneously active
   entry Owner. The read-only systemd check rejects ANY running legacy V12
   unit regardless of SHA; a retired legacy state can only be accepted if
   runtime SHA provenance is valid, all positions/pending are flat, and no
   other old V12 instance is running. Final signed Aster position and open
   order readback must also agree exactly.
5. A stopped legacy V12 flat state need not be periodically rewritten just
   to keep a timestamp fresh. Continued verified inactivity and exact venue
   quantity reconciliation are mandatory at every new V4 evaluation.
6. PENGU/V52/Q102/etc. **cannot bypass source release lineage**, pending/
   manual review, shared account lease, signed venue balance/positions,
   gross accounting and Margin Guard.

## Required Codex-controlled final runtime proof

- Update and stage the complete bundle under **one exact release SHA**.
  Startup must not cause real Entry while source Owner is unverified.
- Confirm PENGU and V52 have **actually emitted** their runtimeCommitSha
  for the new release; don't insert values directly into their state files.
- Confirm new-schema idle/fet/q102/hype sources, current signing, and no
  unowned or multiply-owned Aster position. V52's stock state must not be
  silently treated as absent.
- Confirm the old V12 is flat and has no pending protection, then **stop**
  its entry Runner and its watchdog resurrection path. If legacy positions
  remain, BLOCK; do not force close or transfer silently.
- Verify the seven peer systemd units active on the exact new SHA,
  except the deliberately retired legacy V12.
- Independently certify all normal and exception paths for Aster resident
  STOP ownership, partial/competing fills, refund and restart. Mock unit
  tests alone do not authorize orders.
- TIME37 fixed-8% stop remains a research-backed *candidate*, not an
  installed authorized agreement. Root file /etc/disdex/v12-v4-time-stop-approval.json
  and independent /etc/disdex/v12-v4-production-certification.json both
  remain required.
- Operator acknowledgement of the external-period PF deterioration,
  final release SHA, and V12_V4 service activation remains separate.

**Never turn a syntactic SHA field, passing test, or root-owned file into
a fabricated certificate.** Without independent proof, Codex must keep the
old Production alive and report the exact failing gate.
