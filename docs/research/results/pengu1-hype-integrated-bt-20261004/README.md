# 最新BT：PENGU全注文1.0固定＋HYPE追加比較

**研究用の価格モデルBT。LIVE認証結果ではありません。**

既存BTのPENGU発火・決済候補を維持し、全エントリーのGrossを1.0へ固定。HYPE専用H1 Trend LONGを新たに評価し、同一口座のGross・所有権・優先順位・費用・Funding・複利を含めて再計算しました。PENGUの全時間足からのCOMBINED_FILTERED候補再生成は今回行っていません。

期間：2025-08-10〜2026-08-10（2026-08-11 00:00 UTCを除外）。初期1万円＋毎月1万円×12回、総拠出13万円。費用8/10/20/30bps。元の最新BT SHA：`123df49950e3d5aba61e2d50e9ee1a37fae620d7`。

## Core＋Idle＋DOGE＋AVAX・10bps

| 条件 | 最終資産（円） | PF | 最大MTM DD | 決済件数 |
|---|---:|---:|---:|---:|
| 変更前 | 1,584,517,987.21 | 2.494582 | -22.7126% | 1309 |
| PENGU全注文1.0のみ | 2,163,524,074.55 | 2.429158 | -22.7126% | 1303 |
| 旧PENGU配分＋HYPE | 1,839,730,000.77 | 2.426127 | -24.0916% | 1335 |
| PENGU全注文1.0＋HYPE | 2,844,717,990.11 | 2.414713 | -23.5709% | 1328 |

両方追加の最終資産は変更前比 **+79.53%**。最大DDの絶対値は **0.8583ポイント拡大**。PFは低下しており、利益とリスクの両方が増加しています。

## 5構成・10bps

| 構成 | 変更前（円） | PENGU1.0＋HYPE（円） | PF | DD | 件数 |
|---|---:|---:|---:|---:|---:|
| CORE | 924,164,577.38 | 1,501,344,786.21 | 2.372743 | -23.5709% | 1285 |
| CORE_IDLE | 1,537,800,452.77 | 2,830,119,955.51 | 2.419860 | -23.5709% | 1317 |
| CORE_IDLE_DOGE | 1,562,061,878.12 | 2,805,576,781.00 | 2.408494 | -23.5709% | 1321 |
| CORE_IDLE_AVAX | 1,535,339,098.07 | 2,717,898,230.82 | 2.407550 | -23.5709% | 1326 |
| CORE_IDLE_DOGE_AVAX | 1,584,517,987.21 | 2,844,717,990.11 | 2.414713 | -23.5709% | 1328 |

## 両方追加・全構成のコスト感応度

| 往復費用 | 最終資産（円） | PF | DD | 件数 |
|---|---:|---:|---:|---:|
| PRICE_MODEL_8BPS | 3,624,557,700.98 | 2.466424 | -23.3750% | 1328 |
| PRICE_MODEL_10BPS | 2,844,717,990.11 | 2.414713 | -23.5709% | 1328 |
| PRICE_MODEL_20BPS | 854,375,527.30 | 2.169878 | -24.6329% | 1326 |
| PRICE_MODEL_30BPS | 258,928,007.93 | 1.951433 | -25.6873% | 1326 |

## 全構成10bps・ロジック別

| ロジック | 件数 | 勝ち | 負け | 勝率 |
|---|---:|---:|---:|---:|
| V12 | 967 | 606 | 361 | 62.67% |
| PENGU | 60 | 44 | 16 | 73.33% |
| Q102 | 127 | 81 | 46 | 63.78% |
| FET | 12 | 8 | 4 | 66.67% |
| V52 | 84 | 68 | 16 | 80.95% |
| HYPE_LONG | 30 | 18 | 12 | 60.00% |
| IDLE | 37 | 30 | 7 | 81.08% |
| RESIDUAL | 11 | 6 | 5 | 54.55% |

PENGUは60件すべてエントリーGross1.0。HYPEは30件、18勝12敗・60.0%。HYPEの部分縮小は11イベントで、Coreの容量要求に応じ1回あたり保有数量の最大50%まで縮小。縮小・Funding・手数料は台帳へ反映。

## HYPE条件・実装整合

- HYPEUSDTのみ、H1確定足、LIVE取得窓と同じ最大360本。EMA12/48/240、24h slope≥25bps、24h breakout≥30bps、EMA48乖離≤900bps。
- ATR14。リスク予算5%、Gross上限1.5、元runnerのサイズ計算用バッファ30bps。5x Crossは証拠金設定でありPnLを5倍にはしない。
- ソースrunnerはSTOP=2.5ATR、固定TP=3ATR、最大168h。moving trailingではない。次のH1始値にエントリーを置きSTOP/TPを再基準化。両方接触のH1はSTOP優先、既知の始値ギャップは始値で処理。
- 1枠、候補要求量を満たせなければ新規拒否。HYPEは低優先。既存HYPE保有時はIdle/residualの新規をsidecar exposureとして拒否。

## データと検証

- 元の市場archiveはSHA256一致で取得し、変更前10bpsの5構成は最終資産まで一致。
- HYPEのAster公開GETデータは2025-09-22 13:00 UTC〜2026-08-10 23:00 UTCの7,739本。H1 gap0・ゼロ/負出来高0。Funding1,933件。2025年8月が取得不能だったことは照会結果であり、上場不存在の証明ではない。
- HYPEは実データとウォームアップが揃った時間のみ評価。新規採用可能シグナル82件。取得前・不完全な時間は取引を作らない。
- 変更前5＋両方追加20＋PENGUのみ5＋HYPEのみ5＝35ケースの会計照合PASS・所有権重複0。
- ローカルに取り込んだ対象回帰テストは28実行PASS（継承/再発見分の重複を含む）。リポジトリ全体のテストを実行したという主張ではない。

## 残る限界

この金額は元の最新BTを拡張した診断値です。元BTの不完全なOverlay年間ソース、全時間足のCore eligible/no-signal証拠不足、pending/非同期約定、過去の利用可能証拠金・venue数量条件が未証明である制約を引き継ぎます。HYPEは公開市場データとソース判定で追加しましたが、実機operator-enabledな容量縮小、intrabar STOP/TP順序や約定までの一致を認証していません。

PENGUは元BTの113件の候補ストリームを維持するサイズ比較です。新しいCOMBINED_FILTERED候補を全時間足から再生成した検証として扱わないでください。Production更新・operator認証・実注文はこの作業に含みません。

## 再実行

原本releaseを取得しSHA256確認・展開後、candidate-inputs.zipを展開。追加HYPEソースとコードは証拠ZIPに同梱。

```text
node --import tsx scripts/research/formal_overlay_feature_stream.ts <MARKET_ROOT> features.jsonl
node --import tsx scripts/research/hype_h1_feature_stream.ts <MARKET_ROOT> hype-features.jsonl
python -B -m scripts.research.run_pengu1_hype_comparison --baseline-root <BASELINE_ROOT> --candidate-root <GATED_CANDIDATES> --features features.jsonl --hype-features hype-features.jsonl --output comparison --variants PENGU1_HYPE --costs 8 10 20 30
```
