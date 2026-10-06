# Exact SHA LIVE Approval and Audit Plan

> Execute inline with superpowers:executing-plans.

**Goal:** Activate ebcef8297a30517f3f42c97b80fb0661dc7dc03b, restore all seven traders and both safety daemons, verify the full order path without manual orders.
**Architecture:** Root-owned staged exact-SHA approval is validated by existing gates, then consumed atomically by the manual Production workflow. Preserve runtime strategy and sizing bytes; use existing rollback and read-only venue diagnostics.
**Tech Stack:** Node 24, TypeScript, Python, systemd, GitHub Actions, Hajime Remote.
**Spec:** User instructions received 2026-10-06T17:35:12+09:00 in this conversation.

## Global Constraints
- No strategy or sizing changes; no manual venue orders/cancels.
- Current 4c57efbb86ae0bbfe94bbe7dea4d09f0e1ec6c19; candidate ebcef8297a30517f3f42c97b80fb0661dc7dc03b.
- Preserve rollback and account/state reconciliation; verify zero references before remnant removal.

## Review Focus
- Staged approval must be exact SHA, correct target, root-owned, regular file and protected mode.
- Stopped V52 must report exact readiness blockers.
- Nonzero exits and heartbeat failure must run rollback.
- Safety daemon freshness, pending exposure and venue state must agree.
- Cleanup must retain current/rollback/dependency targets, state, live locks and evidence.

## Tasks
1. Read runtime delta, cutover/approval gates, systemd, state and real account; test existing order-path and approval contracts.
2. Record this user authorization; validate staged candidate approval; repair current V52 readiness as prerequisite using existing wiring with rollback backup.
3. Execute exact candidate manual-dispatch workflow; verify cutover logs, systemd PIDs/cwd/env, state/journal, account and HP; roll back any deployment failure.
4. Audit remnants and remove only proven unreferenced entries; rerun safety/runtime/HP checks; push evidence and report limits.

## Progress
- Read-only preflight: current SHA confirmed; V52 stopped, other six traders and two safety daemons active. Account positions/openOrders empty; shared risk complete/untripped, margin healthy, kill off, pending released only.
- Candidate delta contains only approval/deployment/readiness/test files; critical strategy/sizing/config bytes unchanged.
