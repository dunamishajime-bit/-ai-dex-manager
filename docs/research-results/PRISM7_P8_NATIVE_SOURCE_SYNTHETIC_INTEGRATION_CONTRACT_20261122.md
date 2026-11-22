# PRISM VII P8 — 元pinned PENGU入口・出口の人工相場接続：事前計画（実行前固定）

**研究限定。Production非変更、実注文禁止、既存owner approval/Shared Risk/HYPE/STOP非変更。**

P7は価格M5生成+人工短期方向ラベルのみで、実際のPENGU入口/STOPを試していない。P8では固定runtime `1657e173d250ad58f53e62f7bb0a3428fb405496` の **元ソースと同じ信号・出口純関数**を実行し、元53自然SHORT候補に対する一致を必須条件にする。

## 不変の先行条件

1. 既存PCのGitオブジェクトDBから**固定commitのみ**を読み、`lib/pengu-dual-ls-v2.ts`, `lib/pengu-short-v20.ts`, `lib/pengu-recovery-v8.ts`, `config/penguDualLsV2Runtime.ts`, `config/penguRecoveryV8.ts`と、純関数の必要依存ファイルを隔離した研究フォルダへ抽出する。元の実行経済ロジックは改変しない。Node 24のTypeScript loader用にimport aliasを相対パスへ置換する場合は、**許可変更はmodule path/JSON import assertionのみ**で、元SHA256／アダプタSHA256／差分監査台帳を残す。必要なsourceを見つけられない・厳密な変換ができない場合はFail Closed。
2. 最初は既存native real H1全3期間で **6+40+7の53 SHORT候補**一致（period/route/entryTs/price/元のnative出口reason, exitTs, priceの一致）を検査する。既存fixed sourceと差が出た場合、人工P8の経済結果を信頼しない。
3. Native entry/exit純関数を実行できても**取引所のresident STOP実約定と同じではない**。SHORT hard/trailは元固定pure sourceのSTOP価格モデル、非resident exitは元sourceの時間順の次H1 openモデルとし、entry時の元ATR/position state/ requested grossを整合させる。実需給に応じたgap/slippage、funding、共通Gross/他Runner占有/DDは次段階と明記。

## 人工価格/流動性ソースの設計

- P7で固定した4つの実PENGU M5 `印字有無`マスク、8つの人工価格レジーム、12 seedを継続し、**同じ総数384 path**。元72HではEMA168などのwarmupがないため、**最低264Hのsource warmup+72Hのevaluation=336H** を新たに生成する。native入口はevaluationの最後72Hに発火したものに限定。データ不足を勝ち・負けに変換しない。
- PENGU/BTC人工価格は独立の価格乱数、PENGUのzero volumeは前印字closeへ据え置くが潜在値は動く。取引のない時間足を架空の約定としない。H1はM5からOHLCVを検証して再集計し、必要なvolume/range/sequenceを維持する。
- Native入口が全く出ない場合は明確に `NO_NATURAL_SIGNALS` と記録して停止。signal count, completed native EXIT, unresolved, fee 10bps/30bps, outcome and shorts by regime/print cohortを分ける。発火機会を失って見かけ勝率だけ改善した案は採用禁止。
- 各seedの少なくとも1サンプルで将来足の切断/追加によってnative入口が過去に移動しないことを検査。future labelは入力禁止。Period内の途中で元native exitが観測窓を超える場合 `RIGHT_CENSORED` として分母と区別し、成績へ0%を入れない。
- 源流は**既見**期間であり、4つのmask profileは外部未見市場ではない。人工価格も同一generator familyによるストレス。参照結果は**人工での価格モデル**であって実取引可能な実績ではない。

P8完成判定は元sourceのreal parity、十分なwarmup、ルート/出口のモデル接続、人工ストレスの全ケース保存、全コード+SHA/定量レポート+検証testsのGitHub研究ブランチPush。**PENGU80%・DD20%・Production変更許可を意味しない。**
