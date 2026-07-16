# Champion Deep Research Cycle 7

- Profile: attack
- Champions re-evaluated: 3
- Single-parameter experiments: 6
- Accepted improvements: 1
- Parent strategies retained: 2
- Total full validations: 9
- Final candidates: 0
- Best Train average monthly: 3.29%
- Best OOS average monthly: 1.97%
- Best OOS MaxDD: 2.44%
- Worst stress monthly of best OOS: 0.16%

## Parent / Child Decisions

- oos / minimumEdgeToCostRatio 5.7 → 6.56: REJECT; OOS +0.00pt, Stress +0.08pt, DD improvement 0.00pt
- oos / rebalanceBars 22 → 24: REJECT; OOS +0.00pt, Stress +0.00pt, DD improvement 0.00pt
- stress / minimumEdgeToCostRatio 7.47 → 8.59: REJECT; OOS +0.00pt, Stress +0.18pt, DD improvement 0.00pt
- stress / rebalanceBars 30 → 32: REJECT; OOS +0.00pt, Stress +0.00pt, DD improvement 0.00pt
- stability / minimumEdgeToCostRatio 5.7 → 6.56: ACCEPT; OOS +0.00pt, Stress +0.26pt, DD improvement 0.00pt
- stability / rebalanceBars 22 → 24: REJECT; OOS +0.00pt, Stress +0.00pt, DD improvement 0.00pt

## Next Deep Research Plan

- stability ChampionでminimumEdgeToCostRatio変更を継承し、別の単一変更を追加検証する
- oos Championは親を維持し、low_return・stable_but_low_returnを別仮説で再検証する
- stress Championは親を維持し、low_return・stable_but_low_returnを別仮説で再検証する

## Safety

- Research and Forward Paper candidates only
- Real orders, wallets and API keys remain disconnected
- Any liquidation rejects the child strategy
- A child is inherited only when it improves its own parent

## Deep Discussion Summary

3 Championを親として6件の単一変更を比較し、1件が改善基準を通過、最上位1件を継承。Best OOS月利1.97%、Best Stress月利0.18%。

**CIO Decision:** 1件の最上位改善子を次Cycleの親として継承し、残りは親ロジックを維持する。

## Tested Logic Deduplication

- Historical fingerprints loaded: 150
- New unique child logic tested this cycle: 6
- Duplicate or near-identical child logic skipped: 0
- Alternative hypotheses considered: 3
- Total unique logic in registry: 156
- Unfilled experiment slots: 0

Parent baselines are deliberately re-evaluated for a fair same-cycle comparison but are not counted as new logic.
