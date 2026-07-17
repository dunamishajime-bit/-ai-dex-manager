# DisdexManager Champion Deep Research Lab

## Purpose

The autonomous research loop now develops a small number of promising USD-M Futures Long / Short strategies instead of treating mass generation as the primary research method.

The target remains an OOS average monthly return above 30% without relaxing liquidation, drawdown, sample-size, Walk-forward or execution-cost gates. The target is a research objective, not a guaranteed return.

## Schedule

GitHub Actions runs six deep cycles per day at minute 17, once every four hours.

Each normal cycle performs:

- 3 parent Champion re-evaluations.
- Up to 2 single-parameter child experiments per Champion.
- Up to 6 new child logics.
- Up to 9 complete Validation, untouched OOS, Walk-forward and Cost Stress evaluations including the parents.

This replaces the previous hourly 25-strategy mass-search schedule. The concurrency group still permits only one active cycle and never cancels an active run.

## Champion selection

The loop preserves three complementary parent strategies:

1. **OOS Champion** — highest untouched OOS average monthly return.
2. **Stress Champion** — highest worst-case execution-cost Stress monthly return.
3. **Stability Champion** — strongest combination of OOS return, low OOS MaxDD and Walk-forward pass rate.

When no Champion state exists, the loop migrates from validated results in `latest-result.json`, then falls back to saved Elite genomes. Fresh random seeds are used only when no usable historical strategy exists.

## Deep research cycle

1. Read autonomous state, Champion state, the previous compact result and the tested-logic registry.
2. Load Binance USD-M Futures one-hour Klines and settled Funding history.
3. Re-evaluate all three parent Champions under the same current configuration.
4. Diagnose each parent separately for low return, OOS decay, cost fragility, drawdown risk, direction bias and low sample size.
5. Propose up to two targeted hypotheses per parent.
6. Change exactly one parameter per child experiment.
7. Skip historically tested or current-cycle duplicate child logic.
8. Run full Train, Validation, untouched OOS, Walk-forward and Fee/Slippage/Funding Stress evaluation for every parent and child.
9. Compare each child only with its own parent.
10. Accept a child only when it produces meaningful improvement without liquidation, material OOS decay, material Stress decay, excessive DD deterioration or insufficient OOS trades.
11. Promote the best accepted child into that Champion slot.
12. Retain the parent unchanged when no child passes.
13. Persist parent-child evidence, hypotheses, decisions and the next deep-research plan.

## Single-change experiments

Examples of approved one-variable experiments include:

- Increase only `minimumEdgeToCostRatio` to remove low-edge entries.
- Increase only `rebalanceBars` to reduce turnover.
- Disable only `allowNeutralRegime` to remove directionless entries.
- Increase only `btcRegimeSmaBars` to reduce regime noise.
- Increase only `takeProfitAtr` to test larger profit capture.
- Increase only `maxHoldBars` to allow winning trades more time.
- Reduce only `leverage` or `riskPerTradePct` when risk is excessive.

Changing several parameters together is prohibited because the improvement source would become unidentifiable.

## Parent-child acceptance

The comparison records:

- OOS average monthly return delta.
- Worst Stress monthly return delta.
- OOS MaxDD improvement or deterioration.
- Walk-forward pass-rate delta.
- OOS trade-count delta.
- A composite improvement score.

A child is rejected when any of the following applies:

- No meaningful improvement relative to its parent.
- Liquidation occurs.
- OOS monthly return falls materially below the parent.
- Cost Stress falls materially below the parent.
- OOS MaxDD exceeds the parent-relative risk limit.
- OOS trade count falls below 12.
- Train improves while OOS and Stress deteriorate.

The absolute Forward Paper gates remain stricter than the parent-child development gate. A child can become the next research parent before reaching 30% only when it demonstrates a safe, reproducible improvement over its parent.

## Tested-logic deduplication

Parent baselines are deliberately re-evaluated every cycle for a fair same-cycle comparison and are not counted as new logic.

Child strategies receive deterministic fingerprints built from family, sorted symbols, timeframe, direction permissions, regime, momentum, breakout, volume, volatility, leverage, risk, allocation, ATR exits, holding, rotation, cooldown and Edge / Cost parameters.

Strategy ID, generation, parent ID, researcher name and thesis text do not create a new logic. A duplicate child is skipped and an alternative single-parameter hypothesis is attempted.

## Evidence and discussions

Every cycle stores a full Champion discussion transcript containing:

- Moderator research constraints.
- Champion-specific root-cause diagnosis.
- Researcher hypotheses.
- Overfit criticism.
- Tail-risk criticism.
- Execution-cost criticism.
- Parent-child metric deltas.
- CIO acceptance or rejection for each Champion.
- Final CIO cycle decision and next plan.

The transcript is deterministic and evidence-based. It is not presented as an external LLM free-form conversation.

## Persistent state

The workflow writes only to the dedicated `research-autonomous-state` branch:

- `.research-state/autonomous-state.json`
- `.research-state/champion-deep-state.json`
- `.research-state/latest-deep-research.json`
- `.research-state/tested-logic-fingerprints.json`
- `.research-state/deduplication-stats.json`
- `.research-state/latest-report.md`
- `.research-state/latest-result.json`
- `.research-state/latest-discussion.json`
- `.research-state/latest-discussion.md`
- `.research-state/discussions/YYYY/MM/DD/*.json`
- `.research-state/discussions/index.json`
- `.research-state/funding-coverage.json`
- `.research-state/forward-paper-candidates.json`
- `.research-state/forward-paper-candidates.md`

Scheduled research never writes generated evidence to `master`.

## Forward Paper promotion policy

A strategy can be written to the Forward Paper candidate file only after passing all configured final gates:

- OOS average monthly return at least 30%.
- OOS maximum drawdown within the active profile limit.
- Minimum OOS trade count.
- Long and Short activity.
- Zero liquidation events.
- Walk-forward pass rate at least 60%.
- Extreme execution-cost average monthly return at least 20%.
- Required OOS and Stress return-retention ratios.

## Safety boundary

The workflow cannot access AsterDEX order execution, wallet signing, trading API keys, real account balances or existing live positions. Automation stops at research evidence and Forward Paper candidate creation. Real trading remains disabled.


## Win80 / Ultra90 Main-Lineage Researchへの方向転換

2026-07-17以降、AI研究ラボの主目的をランダムな上位Champion探索から、既存メイン戦略`WIN80_ULTRA90_TOP1_V1`の深掘りと近縁ロジック開発へ変更する。

### 固定するもの

- 本番メイン戦略は`WIN80_ULTRA90_TOP1_V1`のまま変更しない。
- 研究結果からメイン戦略を自動置換しない。
- 実売買、Wallet、API Key、注文経路へ研究コードを接続しない。
- 同一期間で損失分析後に条件追加した歴史値を、完全未使用OOSと表現しない。

### 新しい3研究系統

1. Win80厳選Top-1: 相対強度、BTCレジーム、Edge/Cost、出来高、時間足の深掘り。
2. Ultra90近縁: 強いBreakoutとVolumeを使い、Score90級の高選別思想を別Familyで再現。
3. Rotation近縁: 利益中50%分割とUltra90優先70%移動の思想を、低回転・高Cost耐性の先物研究Proxyで検証。

旧ChampionがこのLineageに属さない場合は次Cycleの親から外す。以後はLineage内の親と、1パラメータだけ変更した子を比較する。合格した子もForward Paper候補までであり、本番メインへの採用は別途手動承認を必要とする。
