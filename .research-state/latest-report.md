# Main Strategy Research #216：WIN80_ULTRA90_TOP1_V1 / Win80 / Ultra90 Entry品質

- Completed: 2026-08-21T20:42:12.772Z
- Main research iteration: 216
- Profile: attack
- Strategy / experiments: WIN80_ULTRA90_TOP1_V1, WIN80_SCORE_82_CHILD_V1, WIN80_TRIGGER_80_CHILD_V1
- BT Snapshot evidence: READY

## BT Snapshot Replay

- Dataset: WIN80_USDM_1H_REFERENCE_2025H2_2026Q1_V1
- Source: binance-usdm-futures
- Period: 2025-07-01T00:00:00.000Z - 2026-04-07T00:00:00.000Z
- Symbols: ETH, BNB, SOL, AVAX, LINK
- Snapshot interval: 6h
- Snapshot / selected signal: 1084 / 86
- Forward 24h win / avg: 44.19% / -0.14%
- Forward 72h win / avg / PF: 46.51% / -0.84% / 0.74
- Forward 168h win / avg: 47.67% / -0.55%
- Stress 72h avg / event sequence DD: -1.00% / -81.51%
- Fingerprint: 251058c8a001971f985f20b71d51154fee32ea07eebf3f6113378f8e15765f2d

### Recent snapshot events

| Snapshot | Symbol | Tier | Score | Trigger | 24h | 72h | 168h | Stress72h |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2025-07-03T18:59:59.999Z | ETH | WIN80 | 82.00 | 80.00% | -4.10% | -2.29% | 8.43% | -2.46% |
| 2025-07-10T12:59:59.999Z | ETH | WIN80 | 84.00 | 80.00% | 7.27% | 7.22% | 23.01% | 7.06% |
| 2025-07-15T00:59:59.999Z | ETH | WIN80 | 81.00 | 80.00% | 4.80% | 17.95% | 24.65% | 17.79% |
| 2025-07-19T00:59:59.999Z | ETH | WIN80 | 80.00 | 80.00% | 1.72% | 5.95% | 5.36% | 5.79% |
| 2025-07-21T00:59:59.999Z | ETH | WIN80 | 80.00 | 80.00% | -0.36% | -2.99% | 2.64% | -3.15% |
| 2025-07-22T06:59:59.999Z | SOL | WIN80 | 88.00 | 80.00% | 0.58% | -10.84% | -7.59% | -11.00% |
| 2025-07-25T06:59:59.999Z | ETH | WIN80 | 84.00 | 80.00% | 2.76% | 7.48% | 0.50% | 7.32% |
| 2025-07-26T12:59:59.999Z | SOL | WIN80 | 88.00 | 80.00% | -1.02% | -2.42% | -12.83% | -2.58% |
| 2025-08-05T06:59:59.999Z | SOL | WIN80 | 85.00 | 80.00% | -2.44% | 4.20% | 3.84% | 4.04% |
| 2025-08-08T12:59:59.999Z | SOL | WIN80 | 84.00 | 80.00% | 3.04% | 1.06% | 9.26% | 0.90% |
| 2025-08-10T18:59:59.999Z | SOL | WIN80 | 82.00 | 80.00% | -2.69% | 8.95% | 4.80% | 8.79% |
| 2025-08-11T18:59:59.999Z | ETH | WIN80 | 88.00 | 80.00% | 4.33% | 5.39% | 1.33% | 5.23% |

### Limitations

- Binance USD-M 1h OHLCV/FundingをStrategyEngineInputへ変換した再現Snapshotであり、Asterの過去Order Bookそのものではありません。
- EntryはSnapshot確定後の次1時間足始値。24h/72h/168hは固定Forward Outcomeで、現行runnerの全決済ライフサイクル月利ではありません。
- Historical spreadは保存されていないため、fee/slippageは固定仮定を使用します。
- 同一期間は既に分析済みであり、完全未使用OOSではありません。

## Methodology

研究Program win80_ultra90_direct_v2。親はproduction main WIN80_ULTRA90_TOP1_V1だけです。旧Champion Deep Stateは読み込まず、実コード定数、歴史参考値、Critic反論、実パラメータ変更案から議論を生成します。再現可能なリプレイ結果がない案はREPLAY_REQUIREDとし、OOSや月利を捏造しません。 追加Evidence: binance-usdm-futuresの1h OHLCV/FundingキャッシュからStrategyEngineInputを6時間ごとに再構築し、次1h足始値Entry・固定24h/72h/168h Outcome・Fee/Slippage/Funding控除で検証。Artifact fingerprint=251058c8a001971f985f20b71d51154fee32ea07eebf3f6113378f8e15765f2d。

## Summary

旧Championを継承せず、現行WIN80_ULTRA90_TOP1_V1本体を親として「Win80 / Ultra90 Entry品質」を議論。2件を提案し、最優先はWIN80_SCORE_82_CHILD_V1。汎用Perpetual GenomeのOOS数値は使用していません。 保存済みBT元データから1084件のStrategyEngineInput Snapshotを復元し、86件の選定Signalに24h/72h/168h実績を付与しました。

## CIO Decision

WIN80_ULTRA90_TOP1_V1はメインのまま固定します。旧deep-c* Championは主研究へ継承しません。今回の最優先実験はWIN80_SCORE_82_CHILD_V1で、Win80 minimum scoreだけを変更した親子リプレイを作成します。WIN80_TRIGGER_80_CHILD_V1は第2候補です。再現BTまたはForward Paper結果が出るまで採用・改善成功とは判定しません。 現行親のSnapshot証拠はREADY。子案は同一Snapshot親子比較完了までREPLAY_REQUIREDです。

## Full Transcript

### 1. Research Moderator (moderator)

- Time: 2026-08-21T20:42:03.772Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: context

Main Strategy Research #216を開始します。親は実運用コードのWIN80_ULTRA90_TOP1_V1だけです。旧Champion Deepのdeep-c*、Momentum、ATR、汎用Perpetual Genomeは継承せず、今回の焦点は「Win80 / Ultra90 Entry品質」です。メインは固定し、改善案と近縁ロジックは別IDで検証します。

Evidence:
- 固定親: WIN80_ULTRA90_TOP1_V1 [positive]
- 旧Champion継承: NO [positive]
- 研究Program: win80_ultra90_direct_v2 [positive]
- 今回の焦点: Win80 / Ultra90 Entry品質 [neutral]

### 2. Main Strategy Researcher (researcher)

- Time: 2026-08-21T20:42:04.772Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: support

現行メインはWin80: Score80 / Confidence80.00% / Trigger76.00% / RR1.18 / Volume0.72、Ultra90: Score90 / Confidence90.00% / Trigger88.00% / RR1.45 / Volume0.90です。Top-1へ初回100.00%、含み益Win80は50.00%分割、Ultra90は70.00%移動です。

保存済みBT元データからStrategyEngineInputを時系列復元しました。2025-07-01〜2026-04-07 / 5銘柄 / 6時間間隔。EntryはSnapshot確定後の次1時間足始値で、24h・72h・7日後を固定評価しています。1084 Snapshot、86 Signal、72h勝率46.51%、72h平均-0.84%、PF0.74。

Evidence:
- 歴史複利月利: 16.81% [positive]
- 歴史取引数: 33 [negative]
- 歴史MaxDD: -9.51% [positive]
- 完全未使用OOS: NO [negative]
- Snapshotデータ: WIN80_USDM_1H_REFERENCE_2025H2_2026Q1_V1 [positive]
- Snapshot数: 1084 [positive]
- 選定Signal: 86 [positive]
- 72h勝率: 46.51% [negative]
- 72h平均: -0.84% [negative]

### 3. Hypothesis Researcher (researcher)

- Time: 2026-08-21T20:42:05.772Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: proposal

1. WIN80_SCORE_82_CHILD_V1: Win80 minimum scoreを「80」から「82」へ変更。Score 80直上の弱いEntryを削り、勝率とコスト耐性が改善するかを切り分ける。 期待効果: 取引数は減るが平均利益とStress耐性が改善する可能性。
2. WIN80_TRIGGER_80_CHILD_V1: Win80 trigger progressを「76.00%」から「80.00%」へ変更。発火途中のEntryを減らし、騙しBreakoutを抑制できるかを確認する。 期待効果: 損失回数低下とEntry遅延のトレードオフ。

Evidence:
- WIN80_SCORE_82_CHILD_V1: REPLAY_REQUIRED [neutral]
- WIN80_TRIGGER_80_CHILD_V1: REPLAY_REQUIRED [neutral]

### 4. AI反対派 / Overfit (overfit_critic)

- Time: 2026-08-21T20:42:06.772Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: challenge

歴史月利16.81%は有望ですが、損失分析後の同一期間調整値であり、完全未使用OOSではありません。改善案を同じ期間の利益だけで選ぶと再び過学習します。各案は固定したDevelopment、Validation、凍結Holdout、Forward Paperの順で評価し、結果がない段階では「改善済み」と表現しません。

Evidence:
- 同一期間調整: YES [negative]
- 完全未使用OOS: NO [negative]
- 現在の改善案: REPLAY_REQUIRED [neutral]

### 5. AI反対派 / Tail Risk (tail_risk_critic)

- Time: 2026-08-21T20:42:07.772Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: challenge

初回100%とUltra90の70%移動は収益力の源泉になり得ますが、Gap、Slippage、連続シグナル、損失確定直後の再Entryを悪化させる可能性があります。子案は月利だけでなくMaxDD、最大連敗、1日損失、急変Stressで親と比較し、親の安全性を悪化させる案は却下します。

Evidence:
- 初回Notional: 100.00% [negative]
- Ultra90移動: 70.00% [negative]
- 実売買: DISABLED [positive]

### 6. AI反対派 / Execution (execution_critic)

- Time: 2026-08-21T20:42:08.772Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: challenge

再現可能なBT Snapshot Artifactを確認しました。2025-07-01〜2026-04-07 / 5銘柄 / 6時間間隔、Fingerprint 251058c8a001971f…。1084 Snapshot、86 Signal、72h勝率46.51%、72h平均-0.84%、PF0.74、Stress 72h平均-1.00%、Event列DD-81.51%、72h最悪-21.27%です。これで現行ロジックの過去時点における選定理由とForward Outcomeを議論できます。ただしAster過去Order BookではなくBinance USD-M 1h OHLCV/Fundingを変換した証拠であり、固定72h Outcomeは現行runnerの全決済ライフサイクル月利ではありません。子案の採否には同一Snapshot上の親子比較とForward Paperが必要です。

Evidence:
- 再現BT Artifact: LOADED [positive]
- Fingerprint: 251058c8a001971f985f [positive]
- 72h Stress平均: -1.00% [negative]
- Aster過去Order Book: 未収録 [negative]
- 全決済Portfolio BT: 別途必要 [neutral]

### 7. Research CIO (cio)

- Time: 2026-08-21T20:42:09.772Z
- Strategy: WIN80_ULTRA90_TOP1_V1
- Stance: decision

WIN80_ULTRA90_TOP1_V1はメインのまま固定します。旧deep-c* Championは主研究へ継承しません。今回の最優先実験はWIN80_SCORE_82_CHILD_V1で、Win80 minimum scoreだけを変更した親子リプレイを作成します。WIN80_TRIGGER_80_CHILD_V1は第2候補です。再現BTまたはForward Paper結果が出るまで採用・改善成功とは判定しません。

現行親ロジックのSnapshot Replayは保存済みです。今後の議論はReference値だけでなく、各SnapshotのScore・Trigger・RR・Volumeと24h/72h/168h実績を必須証拠にします。ただし子案を改善済みとはまだ判定せず、同一Snapshotで親子比較が完了するまでREPLAY_REQUIREDを維持します。

Evidence:
- メイン維持: WIN80_ULTRA90_TOP1_V1 [positive]
- 最優先実験: WIN80_SCORE_82_CHILD_V1 [neutral]
- 旧Champion継承: NO [positive]
- 自動メイン変更: 禁止 [positive]
- 親Snapshot Replay: READY [positive]
- 子案親子比較: REPLAY_REQUIRED [neutral]
- 実売買自動反映: 禁止 [positive]
