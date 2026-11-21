# PRISM VII P15 — 2025年7月 source-native SHORT V20追加カレンダー結果

**元SOURCE fixed `1657e173d250ad58f53e62f7bb0a3428fb405496` による追加自然SHORT 1件、model hard STOP、30bps −8.300%。** 2025年7月26日〜31日の6日間は不足が大きく、PENGU 80%目標・OOS検証の根拠として使用しない。

## 何を確認したか
最初に SOURCE `aster-public-v3-h1-early/PENGUUSDT-1h-20250301-20250924.jsonl.gz`（PENGU source raw gzipのSHA `1b7f8467db39df935c14c8a1ada1e9d72040cac2efc7b9a7ecd39437ac21adc4`）をread-onlyで点検。ファイル名に3月開始とあっても、**PENGUの最初のH1は2025-07-18T12:00Z**、2025-09-23T23:00Zまで1620本、348本がvolume0。BTC同範囲ファイルは3月1日から4968本で異なる。PENGUデータがなくても3月以降「存在した取引」として生成することは厳禁。

研究固定期間：PENGU/BTC H1を7月18日12:00〜8月08日00:00まで同時刻に整列しウォームアップ。ENTRY窓 **2025-07-26 00:00Z〜2025-08-01 00:00Z**、出口観測は8月08日00:00Zまで。原SOURCE native ENTRY `buildPenguDualLsV2EvaluationSeries` と source pure STOP `replayPinnedShortExit`で経済関数を変更せず全自然候補を生成した。

最初の全アーカイブ品質検査で、対象外の2025-09-13T13:00Z BTC H1 `open=115941.8 > high=115916.1` の不正バーを検出し、**結果算出前に Fail Closed**。結果を見ずに文書 `PRISM7_P15A_SOURCE_CANDLE_QUALITY_FROZEN_AMENDMENT_20261122.md` をGitHubに先にPushし、EXIT観測終端を8月08日に限定。該当不正BTC H1は観測窓外として件数1をsummaryに残し、観測期間内BTC/PENGU H1不正0と検証した。入力価格自体の改竄やSOURCE経済パラメータ変更は一切なし。

## 追加PENGU H1の成果

| 指標 | 2025年7/26〜7/31追加 calendar source native |
| --- | ---: |
| 自然発火 SHORT | **1** |
| 元pure native EXIT完了 | **1** |
| 打切り | **0** |
| 10bps / 30bps 勝ち | 0 / 0 |
| 出口理由 | `SHORT_HARD_STOP` |
| 10bpsモデル損益 | −8.1% |
| 30bpsモデル損益 | **−8.3%** |

SOURCEポジションのSTOP到達についてM5取引データが本研究PCにないため、native H1高値での価格モデルであり、自botのsigned fillやM5実約定再現ではない。標本はn=1であり、実運用期待勝率の信頼区間推定には使用しない。

## 結論

SOURCE PREのAug〜Sep53件・SOURCE BASE/POSTは従前から閲覧済み。今回のJuly新カレンダーはPRISM VIIでは追加だが、過去の別研究で同アーカイブを利用した可能性があり、完全なblind OOSと宣言しない。早期から独立に検証できるsource市場の長さが不足している。新SOURCEの第1件は元のSHORTの8%ハードストップであったため、勝率目標を楽観視できない。

固定ロジックと検証コード `scripts/research/prism7_p15_additional_july_native_h1_cohort.mjs`、SOURCE銘柄別H1 file SHA/新候補・EXIT個票、`scripts/research/test_prism7_p15_july2025_native_h1_source_contract_20261122.py` **3/3 PASS**。完全再実行JSON2ファイルSHA256一致：
- summary `c2d5557af4c602b8c1a5425cb649bd4db97129eef927d63ac3d530c7728a5939`
- ケース `c74157e168a11906119369844131c0c5b097e9e657a00fbfa8a1220fdfd1fdb4`

本番VPS/Runner/実注文/建玉/STOP/HYPE/Kill Switch/master変更なし、PR #595 Draft研究Pushのみ。勝率80%・PORTFOLIO DD20%の実証は未達。
