# Win80 / Ultra90 Main-Lineage Research Policy

- Fixed production main strategy: WIN80_ULTRA90_TOP1_V1
- Main strategy lock: ON
- Automatic promotion to production: OFF
- Research output: Research / Forward Paper only
- Historical reference: 33 trades, win 90.91%, compound monthly 16.81%, MaxDD -9.51%, PF 16.51
- Evidence warning: the historical reference was filtered after loss analysis and is not untouched OOS

## Direction

- Win80厳選Top-1思想を維持したままEntry品質・時間足・Cost耐性を深掘りする
- Ultra90級の強シグナルを別Family・別時間軸で再現できる近縁ロジックを開発する
- 利益中50%分割とUltra90優先70% Rotationに近い低回転・高選別の資金移動条件を研究する

## Non-negotiable guardrails

- 本番メイン戦略WIN80_ULTRA90_TOP1_V1を研究結果で自動置換しない
- 一度の子実験で変更するパラメータは1つだけに限定する
- 同一期間の高成績を完全未使用OOSと表現しない
- 採用された子もForward Paper候補までとし、実売買とメイン昇格は手動承認を必須とする
- 清算発生・OOS悪化・Stress悪化・DD悪化は従来どおり拒否する

# Win80 / Ultra90 Main-Lineage Research Cycle 9

- Fixed production main: WIN80_ULTRA90_TOP1_V1
- Production auto-promotion: disabled
- Profile: attack
- Champions re-evaluated: 3
- Single-parameter experiments: 6
- Accepted improvements: 3
- Parent strategies retained: 0
- Total full validations: 9
- Final candidates: 0
- Best Train average monthly: 1.28%
- Best OOS average monthly: 1.41%
- Best OOS MaxDD: 10.51%
- Worst stress monthly of best OOS: -3.71%

## Parent / Child Decisions

- oos / minimumEdgeToCostRatio 3.8 → 4.37: ACCEPT; OOS +0.00pt, Stress +0.42pt, DD improvement 0.00pt
- oos / rebalanceBars 8 → 10: ACCEPT; OOS +0.82pt, Stress +0.00pt, DD improvement 3.15pt
- stress / minimumEdgeToCostRatio 4.8 → 5.52: REJECT; OOS +0.00pt, Stress -1.50pt, DD improvement 0.00pt
- stress / rebalanceBars 4 → 6: REJECT; OOS -1.66pt, Stress -1.78pt, DD improvement -0.95pt
- stability / minimumEdgeToCostRatio 4.2 → 4.83: ACCEPT; OOS +0.00pt, Stress +0.99pt, DD improvement 0.00pt
- stability / rebalanceBars 6 → 8: REJECT; OOS -1.21pt, Stress -0.43pt, DD improvement -7.64pt

## Next Deep Research Plan

- oos ChampionでminimumEdgeToCostRatio変更を継承し、別の単一変更を追加検証する
- oos ChampionでrebalanceBars変更を継承し、別の単一変更を追加検証する
- stability ChampionでminimumEdgeToCostRatio変更を継承し、別の単一変更を追加検証する
- stress Championは親を維持し、low_return・oos_decayを別仮説で再検証する

## Safety

- Research and Forward Paper candidates only
- Real orders, wallets and API keys remain disconnected
- Any liquidation rejects the child strategy
- A child is inherited only when it improves its own parent
- Inheritance applies to the research lineage only and never replaces the production main strategy

## Deep Discussion Summary

3 Championを親として6件の単一変更を比較し、3件が改善基準を通過、最上位2件を継承。Best OOS月利1.41%、Best Stress月利-3.69%。

**CIO Decision:** 2件の最上位改善子を次Cycleの親として継承し、残りは親ロジックを維持する。

## Tested Logic Deduplication

- Historical fingerprints loaded: 162
- New unique child logic tested this cycle: 6
- Duplicate or near-identical child logic skipped: 0
- Alternative hypotheses considered: 3
- Total unique logic in registry: 168
- Unfilled experiment slots: 0

Parent baselines are deliberately re-evaluated for a fair same-cycle comparison but are not counted as new logic.
