# V12 V4 Full-LIVE Watchdog Multi-SHA Contract — 2026-10-12

## Purpose

V12 V4 and the already-running peer strategies can legitimately run from different immutable releases during a controlled V4 cutover. The watchdog must therefore pin each runtime independently without merging operator scopes or pretending all services share one SHA.

This operational contract changes monitoring/restart authorization only. It does not change V4 routes, sizing, signal selection, stops, exits, or the existing peer strategies.

## Required pins

- `DISDEX_WATCHDOG_EXPECTED_SHA` and `DISDEX_WATCHDOG_APPROVED_SHA` pin the watchdog support release itself and must match exactly.
- `DISDEX_WATCHDOG_V12_MODE=V4` selects the V4 runner identity; it must not fall back to the legacy X1 runner.
- `DISDEX_WATCHDOG_V12_EXPECTED_SHA`, `DISDEX_WATCHDOG_V12_RELEASE_ROOT`, and `DISDEX_WATCHDOG_V12_SERVICE_UNIT` pin V4 to its exact certified release.
- `DISDEX_WATCHDOG_V12_OPERATOR_ACTIVATION_PATH` points only to the root-owned V4 full-LIVE artifact. Other peers continue to use `DISDEX_WATCHDOG_OPERATOR_ACTIVATION_PATH` and their own exact SHA pins.
- Each peer runner (`PENGU`, `V52`, `Q102`, `FET`, `HYPE`, and `IDLE`) must explicitly pin its own currently deployed SHA, release root, and unit. Missing pins may not silently relabel a peer as the watchdog SHA.
- `DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA` and `DISDEX_WATCHDOG_MARGIN_GUARD_EXPECTED_SHA` independently pin the currently active safety daemons. The watchdog support release SHA is not a substitute for either safety-daemon SHA.

The V4-specific operator path is optional for legacy watchdog configurations and defaults to the shared path. For V4 Full-LIVE, it must be explicitly set to `/var/lib/disdex/shared/operator-activation/v12-v4-full.json` so a V4 restart cannot borrow another runner's approval. Peer restart approvals remain scoped to the shared peer artifact.

## V4 safety environment precedence

The V4 systemd template must load `/etc/disdex/current-runtime/%i.env` after the legacy credential/config environment files. That SHA-bound file supplies the canonical shared account lock, pending registry, daily-risk state, and Aster global rate-budget path. Because older base env files may define different kill-switch aliases, the generated runtime contract must set all five aliases recognized by the shared kill-switch reader (`DISDEX_SHARED_KILL_SWITCH_FILE`, `DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE`, `DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE`, `DISDEX_V96_KILL_SWITCH_FILE`, and `PENGU_DUAL_LS_V2_KILL_SWITCH_FILE`) to the same `/var/lib/disdex/shared/kill-switch.json`. A missing or divergent alias/rate-budget value is a pre-activation block, not a reason to bypass either safety mechanism.

## Fail-closed rules

- An absent, noncanonical, wrong-SHA, wrong-runner, or insecure operator artifact blocks restart with `HOLD_FAIL_CLOSED`.
- A missing or invalid runner/Safety SHA pin blocks watchdog execution; the watchdog must not infer or rewrite a peer SHA.
- V4 can never resolve to `disdex-v12-x1-all@...`; legacy X1 remains persistently masked.
- In V4 mode, any non-inactive legacy X1 instance or `disdex-v12-v4-canary@...` instance is a composition conflict; the watchdog must hold rather than permit two V12 authorities.
- The full V4 systemd unit reads only `/var/lib/disdex/shared/operator-activation/v12-v4-full.json`; it must not borrow or replace peers' shared `current.json` approval. Its Wants/After graph must not start a same-SHA Shared Risk or Margin Guard when the independently SHA-pinned peers are already active.
- The watchdog is observational/recovery-only and must report zero order, cancel, and position-mutation effects.
- This file is not itself an operator approval, V4 production certificate, TIME37 approval, deployment, or permission to enable orders.

## Verification

The watchdog contract test and source self-test must prove that V4 reads only its dedicated full-LIVE artifact, peers retain their peer artifact, the Margin Guard can remain pinned to its own SHA, and invalid pins remain fail closed. Production activation still requires the exact release certificate, V4 operator artifact, fresh read-only venue reconciliation, and successful systemd preflight.
