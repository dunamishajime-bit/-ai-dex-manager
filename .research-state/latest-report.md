# Main Strategy Research #1：WIN80_ULTRA90_TOP1_V1 / Win80 / Ultra90 Entry品質

- Completed: 2026-07-17T04:44:55.877Z
- Context cycle: 9
- Profile: attack
- Strategy / experiments: WIN80_ULTRA90_TOP1_V1, WIN80_SCORE_82_CHILD_V1, WIN80_TRIGGER_80_CHILD_V1

## Methodology

研究Program win80_ultra90_direct_v2。親はproduction main WIN80_ULTRA90_TOP1_V1だけです。旧Champion Deep Stateは読み込まず、実コード定数、歴史参考値、Critic反論、実パラメータ変更案から議論を生成します。再現可能なリプレイ結果がない案はREPLAY_REQUIREDとし、OOSや月利を捏造しません。

## Summary

旧Championを継承せず、現行WIN80_ULTRA90_TOP1_V1本体を親として「Win80 / Ultra90 Entry品質」を議論。2件を提案し、最優先はWIN80_SCORE_82_CHILD_V1。汎用Perpetual GenomeのOOS数値は使用していません。

## CIO Decision

WIN80_ULTRA90_TOP1_V1はメインのまま固定します。旧deep-c* Championは主研究へ継承しません。今回の最優先実験はWIN80_SCORE_82_CHILD_V1で、Win80 minimum scoreだけを変更した親子リプレイを作成します。WIN80_TRIGGER_80_CHILD_V1は第2候補です。再現BTまたはForward Paper結果が出るまで採用・改善成功とは判定しません。

## Full Transcript

### 1. Research Moderator (moderator)

- Time: 2026-07-17T04:44:46.877Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: context

Main Strategy Research #1を開始します。親は実運用コードのWIN80_ULTRA90_TOP1_V1だけです。旧Champion Deepのdeep-c*、Momentum、ATR、汎用Perpetual Genomeは継承せず、今回の焦点は「Win80 / Ultra90 Entry品質」です。メインは固定し、改善案と近縁ロジックは別IDで検証します。

Evidence:
- 固定親: WIN80_ULTRA90_TOP1_V1 [positive]
- 旧Champion継承: NO [positive]
- 研究Program: win80_ultra90_direct_v2 [positive]
- 今回の焦点: Win80 / Ultra90 Entry品質 [neutral]

### 2. Main Strategy Researcher (researcher)

- Time: 2026-07-17T04:44:47.877Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: support

現行メインはWin80: Score80 / Confidence80.00% / Trigger76.00% / RR1.18 / Volume0.72、Ultra90: Score90 / Confidence90.00% / Trigger88.00% / RR1.45 / Volume0.90です。Top-1へ初回100.00%、含み益Win80は50.00%分割、Ultra90は70.00%移動です。

Evidence:
- 歴史複利月利: 16.81% [positive]
- 歴史取引数: 33 [negative]
- 歴史MaxDD: -9.51% [positive]
- 完全未使用OOS: NO [negative]

### 3. Hypothesis Researcher (researcher)

- Time: 2026-07-17T04:44:48.877Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: proposal

1. WIN80_SCORE_82_CHILD_V1: Win80 minimum scoreを「80」から「82」へ変更。Score 80直上の弱いEntryを削り、勝率とコスト耐性が改善するかを切り分ける。 期待効果: 取引数は減るが平均利益とStress耐性が改善する可能性。
2. WIN80_TRIGGER_80_CHILD_V1: Win80 trigger progressを「76.00%」から「80.00%」へ変更。発火途中のEntryを減らし、騙しBreakoutを抑制できるかを確認する。 期待効果: 損失回数低下とEntry遅延のトレードオフ。

Evidence:
- WIN80_SCORE_82_CHILD_V1: REPLAY_REQUIRED [neutral]
- WIN80_TRIGGER_80_CHILD_V1: REPLAY_REQUIRED [neutral]

### 4. AI反対派 / Overfit (overfit_critic)

- Time: 2026-07-17T04:44:49.877Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: challenge

歴史月利16.81%は有望ですが、損失分析後の同一期間調整値であり、完全未使用OOSではありません。改善案を同じ期間の利益だけで選ぶと再び過学習します。各案は固定したDevelopment、Validation、凍結Holdout、Forward Paperの順で評価し、結果がない段階では「改善済み」と表現しません。

Evidence:
- 同一期間調整: YES [negative]
- 完全未使用OOS: NO [negative]
- 現在の改善案: REPLAY_REQUIRED [neutral]

### 5. AI反対派 / Tail Risk (tail_risk_critic)

- Time: 2026-07-17T04:44:50.877Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: challenge

初回100%とUltra90の70%移動は収益力の源泉になり得ますが、Gap、Slippage、連続シグナル、損失確定直後の再Entryを悪化させる可能性があります。子案は月利だけでなくMaxDD、最大連敗、1日損失、急変Stressで親と比較し、親の安全性を悪化させる案は却下します。

Evidence:
- 初回Notional: 100.00% [negative]
- Ultra90移動: 70.00% [negative]
- 実売買: DISABLED [positive]

### 6. AI反対派 / Execution (execution_critic)

- Time: 2026-07-17T04:44:51.877Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: challenge

今回の案は現行メインの実パラメータに直接紐づいています。ただし現時点のRepositoryには月利16.81%を再計算する完全な取引ログと固定リプレイ入力が保存されていません。よって汎用Perpetual GenomeのOOS数値を代用せず、StrategyEngineInputの時系列Snapshotまたは再現可能なBT Artifactを作ることが先です。

Evidence:
- 汎用Genome代用: 禁止 [positive]
- 再現BT Artifact: 未確認 [negative]
- 実コード親: WIN80_ULTRA90_TOP1_V1 [positive]

### 7. Research CIO (cio)

- Time: 2026-07-17T04:44:52.877Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: decision

WIN80_ULTRA90_TOP1_V1はメインのまま固定します。旧deep-c* Championは主研究へ継承しません。今回の最優先実験はWIN80_SCORE_82_CHILD_V1で、Win80 minimum scoreだけを変更した親子リプレイを作成します。WIN80_TRIGGER_80_CHILD_V1は第2候補です。再現BTまたはForward Paper結果が出るまで採用・改善成功とは判定しません。

Evidence:
- メイン維持: WIN80_ULTRA90_TOP1_V1 [positive]
- 最優先実験: WIN80_SCORE_82_CHILD_V1 [neutral]
- 旧Champion継承: NO [positive]
- 自動メイン変更: 禁止 [positive]
