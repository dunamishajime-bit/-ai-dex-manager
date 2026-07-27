# V52 / V96 Codex Diff Review Handoff

## Scope

Review the latest branch below and apply only residual safety or correctness fixes.

- Repository: `dunamishajime-bit/-ai-dex-manager`
- Branch: `codex/research-trade-history-sync-pr98`
- Baseline before this assistant's implementation: `014ea910678630e1cc74b508c3c36e2e0531e7ab`
- Assistant implementation head before this handoff document: `b41923d086793f2b1fc066f11347b85ffe044e53`

Always fetch the remote branch first and treat the current remote HEAD as the source of truth.
Review the complete range with:

```bash
git diff --stat 014ea910678630e1cc74b508c3c36e2e0531e7ab...HEAD
git diff 014ea910678630e1cc74b508c3c36e2e0531e7ab...HEAD
```

## What was implemented

- Explicit `ASTER_SIGNED` request isolation from public/reference 429 cooldowns.
- V52 safe-runner wrapper used by supervisor and authenticated no-order preflight.
- V11 50 bps and V50 75 bps strategy-specific entry rechecks.
- Entry rechecks before order, during post-only wait, and after fills.
- Post-fill Gross validation that does not count an already-filled position twice.
- Dynamic execution Gross audit fields based on reported free `availableBalance`.
- GTX post-only exit rejection handling without polling an order that was never created.
- New client ID for reduce-only market fallback.
- Failed-entry flatten and pending-state reconciliation.
- Transient public/reference data grace handling.
- UNKNOWN order, signed account failure, and reconciliation failure halt without blind flatten or pending deletion.
- Reduce-only below-minNotional behavior retained while minQty and stepSize remain enforced.
- Combined state root aligned between supervisor and preflight.
- Direction-aware V96/V11/V50 trade-history pairing, including One-way Mode `positionSide=BOTH`.
- Expanded Python safety self-tests and CI compile coverage.

## Required Codex review

Verify these paths first:

- `scripts/disdex_v52_execution_safety_patch.py`
- `scripts/disdex_v52_safe_runner.py`
- `scripts/disdex_v52_aster_only_live_engine.py`
- `scripts/disdex_v13d_v11eq_stock_live_engine.py`
- `scripts/disdex-v13d-v11eq-v96-live-runner.ts`
- `scripts/disdex-v13d-v11eq-v96-live-preflight.ts`
- `scripts/disdex-v52-safety-selftest.py`
- `app/api/research-lab/trades/route.ts`
- `app/api/system/trade-history/route.ts`
- `.github/workflows/disdex-v52-v96-safety-ci.yml`
- `package.json`

### Safety checks

1. Confirm every signed Aster GET/POST/DELETE uses the `ASTER_SIGNED` category explicitly.
2. Confirm public/reference cooldowns cannot block cancel, getOrder, openOrders, positions, balances, or reduce-only orders.
3. Confirm transient data failures do not immediately trigger a Kill Switch when no order truth is unknown.
4. Confirm UNKNOWN order/account truth preserves `pendingOrder`, sets manual review, activates the Kill Switch, and sends no blind fallback order.
5. Confirm V11 uses 50 bps and V50 uses 75 bps during every recheck stage.
6. Confirm V50 cost/depth checks use the actual final notional, not `self.v11_notional`.
7. Confirm post-fill Gross checks validate current caps without treating the filled position as another proposed entry.
8. Confirm GTX rejection skips `poll_fill` and uses a new idempotent market-fallback client ID.
9. Confirm partial fills close only remaining or executed quantities as appropriate.
10. Confirm pending state is cleared only after flat position and zero relevant open orders are authenticated.
11. Confirm reduce-only permits below-minNotional but never bypasses minQty, stepSize, maxQty, or current-position quantity.
12. Confirm the Combined state root remains the root, while V96 and V52 use `crypto-v96` and `stock` children.
13. Confirm One-way Mode `positionSide=BOTH` does not automatically mean LONG in trade history.
14. Confirm missing clientOrderId/audit data results in `UNKNOWN` or review-required rather than a fabricated pairing.

### Strategy invariants — must not change

- V96 Entry logic, symbol selection, Strong Boost, PENGU rules, and ETH one-time skip.
- Crypto Gross cap `1.0`.
- V11 Entry basis `50 bps`, New York entry schedule, and Net Edge requirements.
- V50 Entry basis `75 bps`, windows `11:30`, `12:30`, `13:30` New York, maximum three hours, convergence `15 bps`, and basis stop `1.5x`.
- V11 slot cap `1.0`, V50 slot cap `1.0`, Stock cap `1.5`, Portfolio cap `2.5`.
- Same-symbol concurrency prohibition.
- V96 Margin Priority.
- Daily Loss `2%`, Kill Switch, One-way Mode, double LIVE gate, idempotency, pending recovery, and `closeUnmanagedPositions=false`.
- V13D and Hyperliquid remain disabled in the production path.

## Commands to run

```bash
npm ci
npm run typecheck
npm run strategy:disdex-v96:parity
npm run strategy:executor:selftest
npm run strategy:disdex-v35:runner:selftest
npm run strategy:disdex-v46:selftest
npm run strategy:disdex-v52:contract
npm run strategy:disdex-v52:safety:selftest
python3 -m py_compile \
  scripts/disdex_v13d_v11eq_stock_live_engine.py \
  scripts/disdex_v11eq_aster_only_live_engine.py \
  scripts/disdex_v52_aster_only_live_engine.py \
  scripts/disdex_v52_execution_safety_patch.py \
  scripts/disdex_v52_safe_runner.py \
  scripts/disdex-v52-safety-selftest.py
npm run build
```

Add focused tests for any residual issue before changing production code.

## Forbidden operations

- Do not restart or stop the VPS trading daemon or V96 service.
- Do not submit real orders or alter real positions.
- Do not edit runtime state JSON directly.
- Do not clear a Kill Switch.
- Do not commit `.env`, API/private keys, approval files, runtime state, logs, or generated caches.
- Do not run `npm audit fix` or mix dependency-remediation work into this review.
- Do not merge or retarget PR #98 without explicit operator approval.

## Completion report

Report:

1. Remote HEAD at review start.
2. Review findings by severity.
3. Files changed and rationale.
4. New commit SHA and branch.
5. Full test results and GitHub Actions run URL, or the precise reason Actions could not be verified.
6. Proof that the strategy thresholds/invariants above did not change.
7. Confirmation of zero VPS service restarts, zero orders, zero position changes, and zero direct runtime-state edits.
