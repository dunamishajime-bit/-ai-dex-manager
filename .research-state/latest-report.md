# Champion Deep Research Cycle 8

- Profile: attack
- Champions re-evaluated: 3
- Single-parameter experiments: 6
- Accepted improvements: 3
- Parent strategies retained: 0
- Total full validations: 9
- Final candidates: 0
- Best Train average monthly: 3.52%
- Best OOS average monthly: 2.85%
- Best OOS MaxDD: 2.44%
- Worst stress monthly of best OOS: 0.23%

## Parent / Child Decisions

- oos / cooldownBars 6 → 7: REJECT; OOS -0.73pt, Stress -0.56pt, DD improvement -0.22pt
- oos / btcRegimeSmaBars 29 → 33: ACCEPT; OOS +0.88pt, Stress +0.15pt, DD improvement 0.00pt
- stress / cooldownBars 3 → 4: ACCEPT; OOS +0.11pt, Stress -0.16pt, DD improvement 1.64pt
- stress / btcRegimeSmaBars 29 → 33: REJECT; OOS -0.24pt, Stress -0.23pt, DD improvement 0.00pt
- stability / minimumEdgeToCostRatio 6.56 → 7.54: ACCEPT; OOS +0.00pt, Stress +0.81pt, DD improvement 0.00pt
- stability / rebalanceBars 22 → 24: REJECT; OOS +0.00pt, Stress +0.00pt, DD improvement 0.00pt

## Next Deep Research Plan

- oos ChampionでbtcRegimeSmaBars変更を継承し、別の単一変更を追加検証する
- stress ChampionでcooldownBars変更を継承し、別の単一変更を追加検証する
- stability ChampionでminimumEdgeToCostRatio変更を継承し、別の単一変更を追加検証する

## Safety

- Research and Forward Paper candidates only
- Real orders, wallets and API keys remain disconnected
- Any liquidation rejects the child strategy
- A child is inherited only when it improves its own parent

## Deep Discussion Summary

3 Championを親として6件の単一変更を比較し、3件が改善基準を通過、最上位3件を継承。Best OOS月利2.85%、Best Stress月利0.23%。

**CIO Decision:** 3件の最上位改善子を次Cycleの親として継承し、残りは親ロジックを維持する。

## Tested Logic Deduplication

- Historical fingerprints loaded: 156
- New unique child logic tested this cycle: 6
- Duplicate or near-identical child logic skipped: 4
- Alternative hypotheses considered: 3
- Total unique logic in registry: 162
- Unfilled experiment slots: 0

Parent baselines are deliberately re-evaluated for a fair same-cycle comparison but are not counted as new logic.
