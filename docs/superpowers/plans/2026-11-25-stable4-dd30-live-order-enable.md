# STABLE4 DD30 LIVE Order Enable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bind the adopted STABLE4 DD30 economics and current production SHA to separate, exact Owner-approved scoped permits for the six non-HYPE runners and the HYPE H48 runner, then validate the official workflows without bypassing GLOBAL HOLD or STOP protection.

**Architecture:** Keep the existing monitor-only release and GLOBAL HOLD unchanged. Add current-SHA plan/manifest constants to the existing fail-closed scoped permit helpers, keep HYPE on its separate H48 certificate path, and use official GitHub Actions plus HP Owner approvals for activation. No direct VPS order-enable mutation is performed outside the Root workflows.

**Tech Stack:** TypeScript, Python, GitHub Actions, Root-owned VPS helpers, HP signed approvals.

**Spec:** User request for STABLE4 DD30 all-seven Runner Production LIVE order authorization (2026-11-25).

## Global Constraints

- Current source SHA: 63ba8d6ad2085ed00b3cb1f11d6461b17bc03724 before merge; final approvals bind the merged exact SHA.
- Adopted economics remain Crypto 3.0x, Stock 4.0x, Total 4.25x, V52 2.0x, V4 Aggregate 2.0x, PENGU 1.0x, HYPE Trend 1.5x, DD30%, PENGU DD17%, Shared Risk 7.5%.
- GLOBAL HOLD, resident STOP, Shared Risk, Margin Guard, and fail-closed gates remain active.
- No test orders, cancellations, position changes, stale SHA approvals, or manual token/hold bypasses.

## Review Focus

- Current-SHA and plan mismatches must fail before redemption; covered by scoped permit and workflow contract tests.
- Adopted Gross/DD values must be exact in both bundle and H48 certificates; covered by TypeScript/Python policy tests.
- HYPE must remain isolated from the six-runner bundle; covered by manifest and workflow tests.
- Existing GLOBAL HOLD digest/reason must remain unchanged; covered by Root preflight/permit tests.
- Approval status must be exact and run-bound; covered by redemption validation tests.

### Task 1: Exact current-SHA plans and manifest

Files: create `config/stable4-dd30-runner-plan.json`, `config/stable4-dd30-h48-plan.json`, `config/stable4-dd30-runner-bundle-manifest.json`; modify `lib/stable4-runner-bundle.ts`.

- [ ] Add canonical no-newline plans and manifest for the six-runner bundle and HYPE H48 scope.
- [ ] Bind source SHA, adopted economics, HOLD-preserve semantics, and child plan digest.
- [ ] Add tests proving the manifest digest and economics are exact.

### Task 2: Six-runner scoped permit path

Files: modify `scripts/ops/deploy/disdex_runner_scoped_order_enable.py`, `.github/workflows/disdex-stable4-runner-bundle-order-enable.yml`, related tests.

- [ ] Replace stale SHA/plan pins with the current release and computed bundle/child hashes.
- [ ] Keep the existing GLOBAL HOLD reason/digest unchanged and require zero trading mutations.
- [ ] Add contract tests for source, plan, economics, and six-runner exclusion of HYPE.

### Task 3: HYPE H48 exact path

Files: modify `scripts/ops/deploy/disdex_stable4_h48_formal_issue.py`, `scripts/ops/root/disdex_stable4_h48_policy.py`, `scripts/ops/deploy/disdex_stable4_h48_order_enable.py`, `lib/deploy-approval-token.ts`, H48 workflow/tests.

- [ ] Bind current source SHA and H48 plan.
- [ ] Adopt Gross 3.0/4.0/4.25/HYPE 1.5 with DD30 and Shared Risk 7.5.
- [ ] Preserve separate H48 scope and GLOBAL HOLD.

### Task 4: CI, merge, and formal approvals

- [ ] Run focused tests, CI, and inspect the merged SHA.
- [ ] Obtain one exact HP Owner approval for the six-runner bundle and one for HYPE H48; do not reuse monitor-only approval.
- [ ] Dispatch official Root workflows only after protected Environment review.

### Task 5: Production evidence

- [ ] Re-run signed read-only VPS checks before/after each activation.
- [ ] Verify seven active units, exact permits/certificates, unchanged HOLD digest, zero mutations, and HP/VPS parity.
- [ ] Record run IDs, SHAs, approvals, and any fail-closed blockers in Issues #633 and #651.
