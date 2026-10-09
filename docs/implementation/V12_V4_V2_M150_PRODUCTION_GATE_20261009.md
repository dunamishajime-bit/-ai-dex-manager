# V12 V4 V2_M150_D05_CORE_NATIVE — implementation preparation and Production blocker report
Date: 2026-10-09

## User-selected configuration

The user explicitly chose the **high-profit development variant** rather than the forward-split midpoint case. Do not silently substitute the 158,468,411 JPY forward-scored model.

- Research case: `V2_M150_D05_CORE_NATIVE`.
- Ranking: frozen full-year `docs/implementation/v12-v4-v2-full-year-priority.json`, copied exactly from `docs/research/results/v12-v4-priority-gross-v2-20261009/route-priority-score.json` (original source SHA256 `30F89625860C027C7ECB96DA182263CA9D7C19A91E20504302DEA6048E8BB4D5`).
- 41 routes, first-pass and second-pass repairs, native Core priority and requested gross, D tier fixed 0.05x, otherwise tier-gross times 1.5x capped at 1.0x.
- Recovery cap 2.50x / V12 cap 3.00x / Crypto cap 3.50x / Total cap 4.75x. Gross is not exchange leverage.
- BT 2025-08-10 to 2026-08-10, modeled H1, initial contribution JPY 10,000 once.
- Full integrated 10bps: final equity **JPY 291,326,102.62**, max MTM DD **-20.4200%**, **1,222 total trades / 828 V12 trades**; 605 wins / 223 losses for V12.
- 20bps: JPY 231,193,740.03 / max DD -20.9659% / 1,224 trades.
- 30bps: JPY 174,749,524.32 / max DD -18.3888% / 1,218 trades.

## Completed code changes on this branch

- `lib/v12-v4-v2-shadow.ts` evaluates all 41 frozen V4 routes with the two repair passes, frozen hindsight priority and requested gross, explicitly selects `V2_M150_D05_CORE_NATIVE`, and emits a non-ordering Shadow snapshot.
- `lib/v12-multilogic-v4-shadow.ts` accepts explicit policy caps for simulated admission while preserving original frozen caps by default.
- `scripts/v12-multilogic-v4-shadow-runner.ts` recognizes the V2 policy only when the input policyId is explicitly set to the exact case name; remains read-only, zero real orders.
- Production-UI observability and V12 panel show the selected V2 case, route priority/tier, intended gross, all modeled 10/20/30bps performance and clear research-only warnings. The UI does not misrepresent historical results as live account performance.
- Test files cover route table/caps, repaired inputs, original V4 invariants and lack of real-order calls.

## Current VPS evidence, inspected as root using desktop key

- `/home/deploy/disdex-trading/current` resolves to release `ce1edeead8d0f9e5d88e829d415057117502a335`. It is **not** this Git branch, and the release has no V4 shadow module.
- At inspection, PENGU/Q102/V52/FET/HYPE/IDLE/risk/margin services were active, whereas the V12 X1 ALL service was **failed**.
- V12 journal shows repeated `ACCOUNT_LOCK_BUSY_OR_STALE_REVIEW_REQUIRED`, then V52 stock-reference TSLA `stale_quote` 503, shared Kill Switch `HOLD_PROTECTED`, and V12 exit code 2 on 2026-10-09 07:13 JST.
- `/var/lib/disdex/shared/kill-switch.json`: active=true, action=`HOLD_PROTECTED`, recoverable=true. V52 runner state has **one managed position**; lock file `account-order.lock` has a recently renewed and unexpired lease.
- Do NOT delete live lock files, flip kill switch off, manually restart V12 into an unresolved active kill switch, or force entries/closes. Recover/reconcile under the established operator controls with proof of fresh market data, current exchange positions, pending orders, shared risk and operator activation artifacts.

## Blockers to making V2 real-order LIVE

1. **Causal evidence blocker:** V2 priority ranks use the entire evaluated training year (lookahead/retrospective optimization). This is an intended user selection but not out-of-sample validated. Separate 2026 Aug–Oct Y06 route-only performance was 102 entries, PF ~0.30 at 10bps. No valid whole-portfolio out-of-period reproduction.
2. **DD blocker:** 10bps and 20bps maximum DD exceed the preferred 20% boundary. Cost sensitivity does not certify risk.
3. **Execution parity blocker:** Existing VPS release is X1 ALL, not this V4; current live order adapter, venue minimums, pending/reserved gross, per-route virtual-leg exits, owner reconciliation, 5x Cross readback, and restart persistence are not proved equivalent to the research H1 engine. The TypeScript implementation here is deliberately only a shadow candidate, not an actual integrated live execution adapter.
4. **Runtime health blocker:** V12 runner is failed, shared kill switch active with a protected V52 managed position; these conditions must be reconciled before any change to order authority.
5. **Release/UI parity blocker:** The current production SHA and active HP deploy must be audited before packaging a new release; the original shadow-feature parent branch is not the presently deployed runtime. Do not deploy this worktree wholesale and inadvertently downgrade other October live changes.

## Required next steps before LIVE authorization

- Read-only inventory all exchange positions/orders and runner states, verify current fresh quote status and pending order ownership; resolve protected hold via documented recovery, with operator-approved rollback.
- Backtest exact VPS currently-running **non-V12** runners together with frozen V2 once their Git SHA/flags are ascertained. Existing multi-strategy BT reproduces 12/12 ledger hashes (audit on branch `research/v12-v4-forward-robustness-20261009`, SHA `a835a68b`) but has not yet been compared to current live versions.
- Implement actual 41-route virtual-leg lifecycle with historical-to-live signal parity, explicit risk/margin gates, venue-notional/minQty/precision and order reconciliation. Perform no real-money smoke trade without operator approval.
- Only promote after independent external-period coverage, Global Gross ownership/position safety, account risk, current-release coherence, HP parity and a reversible deploy have passed.
- Keep `orderEnabled=false`, `tradingMutation=0`, and `realOrderEnabledV4=0` in all V2 snapshots until separately authorized and demonstrated.

**Classification: user-selected V2 policy code prepared and tested for Shadow/HP; NO production deployment or LIVE enabling claimed.**

## DD許容値の更新（2026-10-09 21:04:45 JST）

ユーザーの最新指示「20%でも21%にはいっていないので許可します」により、候補V4のDD許容上限を21%へ更新した。新しい判定は10bps -20.420014%・20bps -20.97%をDD理由で拒否しない。元のBT値、41ルート、順位、Gross条件を変更していない。

config/v12V4AdoptionRiskPolicy.tsを単一の基準として、V4採用評価と候補lifecycleのDDガードが参照する。既存VPSの他ロジックのリスク設定は変更していない。21%超で新規を拒否し、既存legの決済は妨げない。

この更新は外部期間PF不合格、先読み順位、取引所Exit保護・全8統合未認証を解除しない。新V4の実売買有効化は未実施。
