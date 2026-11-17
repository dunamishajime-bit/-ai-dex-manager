# STABLE4 Production Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the already-reviewed STABLE4 candidate to Production LIVE through the existing owner-approved root deployment path without changing production safety controls.

**Architecture:** Complete the Q102 bootstrap transaction and generated root/runner source integration, stage an immutable candidate release from the verified runtime delta, then execute the existing GitHub Actions/HP Owner approval/root-gate cutover. Existing DD stop, Shared Risk, Gross, Kill Switch, protective STOP, and rollback semantics remain authoritative.

**Tech Stack:** Python root-operation generators/tests, TypeScript runtime, GitHub Actions, systemd, SSH/root gate, signed venue read-only diagnostics.

**Spec:** User-provided “STABLE4正式LIVE切替を最短で完了させる” request in the current conversation.

## Global Constraints

- Do not change or bypass DD stop, Shared Risk, Gross, Kill Switch, or protective STOP controls.
- Do not issue test orders, cancellations, forced closes, or fabricate unresolved Q102 data.
- Keep credentials and private configuration out of source, reports, and output files.
- Use the existing formal owner approval and rollback paths; do not execute before exact approval.
- Keep generated LIVE audit artifacts under `DisDex_AI_Files\03_VPS_LIVE`.

## Review Focus

- Q102 old/new writer exclusivity and rollback must remain fail-closed; test the active-old-writer rejection and prepared-receipt rollback path.
- Bootstrap state/result/source/evidence hashes must bind to the candidate SHA and remain truthful about the five unresolved observations.
- Root plan/source SHA mismatches must block preflight; test exact plan and source binding.
- Candidate release must not include credentials or unapproved research artifacts; verify the runtime-only archive and immutable marker.
- Post-cutover must show one writer per role, three progressing cycles, zero mutation counters, and signed flat account proof.

---

### Task 1: Complete and verify Q102 bootstrap/root integration

**Files:**
- Modify: `scripts/ops/root/disdex_stable4_q102_bootstrap_seal.py`
- Modify: `scripts/ops/root/disdex_stable4_flat_peer_cutover.py`
- Test: `scripts/ops/root/test_disdex_stable4_q102_bootstrap_seal.py`

- [ ] Run the focused Python tests with elevated filesystem access and inspect the complete result.
- [ ] Run the full STABLE4 root test subset and record pass/fail evidence.
- [ ] Run `git diff --check` and Python compilation for the changed root modules.
- [ ] Commit only the verified integration changes.

### Task 2: Publish and stage an immutable candidate

**Files:**
- Candidate runtime archive derived from the verified old release and current branch.
- Generated root source bundle and Q102 bootstrap input under `/var/tmp` on the VPS.

- [ ] Push the verified branch and wait for successful GitHub Actions.
- [ ] Build and transfer only the runtime delta, generated root bundle, signed/read-only evidence, and truthful bootstrap result/state.
- [ ] Stage the candidate release from the existing verified release, set the exact release marker, and verify dependencies/permissions.
- [ ] Prepare exact desired deployment plans without mutating live pins.

### Task 3: Obtain exact Owner approval and execute formal cutover

- [ ] Re-run signed venue GET and verify positions/open orders/mutation counters are zero before mutation.
- [ ] Run root preflight for every target scope with exact candidate SHA and plan SHA.
- [ ] Request/confirm HP Owner approval for the exact operation, scope, SHA, and plan.
- [ ] Execute the formal root cutover sequentially, fail-closed on any mismatch, with rollback available.

### Task 4: Verify LIVE and publish evidence

- [ ] Verify systemd PID/SHA/state for all target runners and no duplicate old writer.
- [ ] Observe at least three real decision cycles; verify orders, STOP, Shared Risk, Gross, Kill Switch, and signed account state.
- [ ] Reconcile HP status with VPS state.
- [ ] Commit/push final implementation evidence and save the durable LIVE audit under `DisDex_AI_Files\03_VPS_LIVE`.

