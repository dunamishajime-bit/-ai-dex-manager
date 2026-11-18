# BT PR #481 — Source-exact V52 V50 candidate method, standalone offline dual-source tests

Date 2026-11-15 JST. Source reference checkout `9118eeaa6c209dc6e37887cf5be139b3baaa005d`. Worktree changes restricted to BT development branch.

## Source fidelity

The upstream V52 legacy source is `scripts/disdex_v52_aster_only_legacy_engine.py`, raw SHA256 `5f7b5299b50ac2b85bfab6cef1dd746d7e114ce70c442f5f6fcadbe47dc78762`. The full **85-line original** `V52AsterOnlyEngine.v50_candidate` method body was copied without rewriting comparisons, branch order, rejection strings, numerical thresholds, or ranking logic to `lib/bt-verification/pinned-native-v52/v50_candidate_original_method.py` inside a new `V52NativeCandidateOfflineShell` class. The SHA256 of that original method under normalized LF is `4d14659a7da1cd006f673834087940ad4640f82905506f2d9cd1426c744e5478`. `v50-source-manifest.json` pins this and the upstream runtime configuration hash/policy ID.

There is NO import of the LIVE V52 engine, no venue client, HTTP, actual account or order method. The method expects `self` and `base` hooks; the regression test supplies only in-memory fake state, book quotes, external reference quotes, cost and depth observations, limited risk snapshot and deterministic fixed now/time. Its `self.save()`, `self.log()`, and `append_v52_diagnostic()` calls are replaced at the object level by in-memory test stubs only — the original method body is still unaltered.

## Proof from two *independent* modeled quote sources

`scripts/bt-hp-v52-native-v50-candidate-selftest.py` passes paired artificial Aster-order-book and independent stock-reference quote inputs through the exact original candidate evaluator (different `mid`, `reference.price`, timestamps, spread, depth and signal snapshot). It validates:

- Basis greater than 60bps with prior signal of matching direction; Long and Short and `POST_1130` route.
- Entry under 60bps rejected; signal sign flips and >10bps adverse basis movement rejected.
- Cost >60bps, net edge below 7.5bps, spread >20bps, insufficient exit depth (<2x notional) rejected.
- Stale quote, source clock mismatch and same-symbol existing position rejected.
- The additional pure original AMZN SHORT Yahoo source gate rejects >+1.0% previous-session reference jump and missing data, allows exactly +1.0%, and never applies on AMZN Long.
- Highest absolute basis wins between two otherwise eligible stock symbols.
- Telemetry, gross requested and rejection reasons are internally consistent.
- **Real orders, STOP modifications and actual transactions: 0**.

The paired quotes in these tests are fabricated, explicitly independent, and are **not sourced from observed Yahoo/Aster markets or a calibrated synthetic basis model**. Accordingly this is a functional regression of the *entry-decision code*, NOT an economic backtest, no production source parity, no quantity/slot reservation approval, no signal profitability, no real return/alpha estimate.

## Remaining source and system dependencies

Full V52 runs alongside V11, owns NY session window schedules, captures signal basis from earlier quote times, considers trading-calendar/AMZN Yahoo reference when eligible, makes V11/V50 slots interact with other crypto runners, and includes exit, pending order, gross and guard/kill-switch behavior. The next isolated BT engineering step is a 2-source synthetic time path with source timestamps, sessions, bid/ask, depth and reference bar availability; it must be labeled simulated and independently causal. Full portfolio trades cannot be certified without the original exit and execution/portfolio code. LIVE and Codex-owned worktree remain unchanged.
