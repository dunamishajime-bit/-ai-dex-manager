# STABLE4 DD30 + Q102 D126 + H48 STOP8 unified immutable source candidate

Status on 2026-11-26 JST: **PRE-LIVE SOURCE / REVIEW REQUIRED / ORDERS NOT ENABLED**.
This branch is based on master e770a4179d329f04bcfb668bcde3eea462955121;
source ancestry includes H48 PR #668 head a775d0e3d854e339a2cf0f7e046f910496e12314
and Q102/V52 PR #671 head eb8fb3ecf945ce2de9e7199dd499bff45e1dd193.

## What is integrated
1. Q102 HIGH_VOL D126: only fully completed UTC 1D/12H/6H close-to-close positive for all three overrides a SHORT setup to LONG. Original requested Gross 0.6x preserved; missing or duplicate history blocks. Unaffected families keep their source pin and policy.
2. H48R4 resident STOP8 candidate (Root issuer/verifier, production-shaped executor, shadow monitor, native coordinator, journal, restart, source-only testing), no Root-issued actual STOP8 certificate or order permit.
3. V52 verified 3.5% daily strategy-loss trigger: V52-owned V11/V50 flatten intent is durable through crash and UTC rollover, only on confirmed trading loss (not unknown API data); entry blocked, scope-limited reduce-only exit, post-exit flat check; ledger timestamp and net fee corrected.
4. Gross source: owner-approved candidate Crypto3.0/Stock4.0/Total4.25/HYPE1.5. An updated candidate is NOT a signed, active source-plan contract.
5. Legacy STABLE4 DD30 source pin: 30 critical paths checksum-pinned. No prior live authority inherited; original c731 Root cutover is explicitly disabled.

## Local validation before remote CI
- Q102: 182 candidate historical signal decision/return parity and no future-bar leakage; native new D126, existing V4 signal, exits and protective order tests.
- H48: 24 offline H48 TS test suites + 2 Gross tests; 7 Root STOP8 issuer no-mutation tests.
- V52: verified scoped flatten, persisted retry, incomplete/external API failclosed, daily time/commission tests.
- Full TypeScript tsc --noEmit PASS; original integrated-source gate and manifest tamper tests PASS.
- Source-only workflow disdex-stable4-dd30-unified-release-source-only.yml must pass on exact unified commit.

## Blockers that MUST remain fail-closed before Codex can enable orders
- The H48 STOP8 source shape has no certified installed production systemd service/immutable release evidence; the old H48_TIME_ONLY certificate is incompatible.
- Gross candidate has not been signed by HP and Root for the exact unified commit; old approval carries different caps.
- Individual runner cumulative-DD entry gates remain unimplemented and unvalidated, despite research attribution; do not misrepresent shared-account attribution indexes as strategy capital DD.
- The V4 37 TIME route emergency STOP8 root-owned approval for the exact new SHA is not installed. Signed venue STOP coverage, multi-symbol ownership, and remaining live exit restoration must be certified.
- The latest D126/Q102/H48/V52 combined full-year and independent forward + synthetic BT (10/30bps, M5 slippage, funding, source parity, 7 runners) has NOT been independently rerun against this immutable candidate. Previous favorable Q102 D126 results are research only.
- New exact-SHA HP Owner authorization, Root protected ENTRY/EXIT and 7 runner scoped permits must be issued; GLOBAL HOLD cannot be bypassed or cleared prematurely.

## Codex final role
After ALL above gates green, Codex receives reviewed immutable release, owner-signed exact plan/certificate, unified preflight results and performs the **last formal order-capable production cutover only**. If any gate is false, remain SHADOW/HOLD and report blockers. No paper orders, no canary trades, no unapproved live orders.
