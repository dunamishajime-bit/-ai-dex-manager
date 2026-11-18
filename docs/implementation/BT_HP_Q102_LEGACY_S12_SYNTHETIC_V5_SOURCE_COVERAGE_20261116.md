# BT-481-L / Q102 S1・S2旧研究6銘柄 — Synthetic v5ソース照合（2026-11-16）

## 判定

**`LEGACY_SIX_SYNTHETIC_FEATURES_ONLY` — 仮想OHLCV入力・Native特徴量計算の接続はPASS。正式S1/S2所属・180日実市場学習・約定は引き続き未認証。**

直前のBT-481-Kでは、Owner PC内の旧研究 `quality102_s1s2_known_fixture.csv` が18行・6通貨（S1 8 / S2 10）であることと、旧再構築スクリプトに `ORIGINAL_RAW_GENERATOR_PROVEN = False` と明示されていることを確認した。これらの6通貨は、本番/Native30拡張候補の正式シンボル全体を意味しない。

この6通貨のうちTAOUSDTは人工v1に既存だが、ONDOUSDT / SUIUSDT / OPUSDT / SEIUSDT / ARBUSDTは人工v4まで存在しなかった。そのため既存v1～v4へデータを補填するのではなく**新規opt-in人工フィードv5**を作り、架空のOHLCVでNative source-pinned Q102 HIGH_VOL特徴量を実際に評価した。

## 実装したもの

- `lib/bt-verification/synthetic-market.ts` に **v5＝38銘柄（暗号資産30＋株式8）** を追加。既存v1=23、v2=24、v3=26、v4=33の分岐・バージョン指定はそのまま。v5には専用の人工価格・ボラティリティ・人工volumeパラメータがある。**v5と旧バージョンは同一seedでも同価格系列ではない**（symbol追加後のRNG消費が変わる）。
- `lib/bt-verification/synthetic-feed-audit.ts` の銘柄数表示を、バージョン固定値ではなく実際のフィードのシンボル一覧から算出するように変更。
- `lib/bt-verification/q102-legacy-s12-v5-synthetic-audit.ts` に旧研究6銘柄の**確定済みH1のみ**で元の `inspectQ102NativeHighVolFeaturesAt` を呼び出す検証を実装。
- 月次180日Native Rule mapも、上流Stage1/Stage2拡張IDも未入手であり、Native入口・モデルFillへの変換は禁止。実証対象は**Native raw-grid threshold features**のみ。

## 再現結果（人工相場であり市場実績ではない）

固定seed=20261116、scenario=volatile、期間2025-10-01 00:00～2025-10-23 00:00 UTC、確定H1 528本、初期ウォームアップ336H。

| 項目 | 結果 |
| --- | ---: |
| 旧研究6銘柄の人工OHLCV生成 | **6/6** |
| Native特徴量評価できる時点 | **192 H1** |
| 6銘柄×判定時点 | **1,152評価** |
| 重複閾値も含むRaw Grid Matches | **332** |
| 学習済みRule map認証 | **なし** |
| 上流30 expanded IDs / S1・S2所属 | **なし** |
| 認証済みS1/S2エントリー・Fill | **0** |

Raw Match 332は重なり合うhardStop/閾値の組合せ件数で、**332取引や332独立シグナルではない**。現在の価格経路・Volume・FXは人工であり、対象年の既存STABLE4成績、最大DD、勝率へ加算しない。

## 検証／証跡

- `scripts/bt-hp-q102-legacy-s12-v5-synthetic-selftest.ts`：v1～v5の同一seed決定性、旧v4一覧がv5先頭に保存されていること、旧6銘柄のカバー、v5 38シンボル/30 crypto、Nativeコードのoriginal SHA照合、特徴量計算、Native月次Rule無しなら正式入口0を検証：**PASS**。
- 既存 `bt-hp-v3-complete-q102-s34-universe-selftest.ts` **PASS**、`bt-hp-q102-highvol-source-selftest.ts` **PASS**、新規ソースに対する単独TypeScript型検査 **PASS**。
- Owner PC private監査集計：`C:\Users\dis\disdex-bt481-private-evidence-20261116\BT481_Q102_LEGACY_S12_V5_FEATURE_COVERAGE_20261116.json`、SHA256 `F612514035A6E0FAEF02FA01E4FB62BB696048CC06FCFF9B88B246B287E9A056`。個票OHLCVや実口座データはGitHubに保存しない。

## 引き続きBlock中のゲート

元上流の30 Expanded Stage ID／Stage1/2割当、Native Full Universe、全ルール/180d学習済み決済台帳と時系列窓、Native STOP・Funding・手数料、完全な先読み無しの複数月Walk-forward、Q102 One-Slot/Gross/Shared Risk/Portfolioと全Runner統合が未検証。直前のBT-481-J人工180d「モデル27取引」と今回の人工22日「Raw Grid332」は別母集団であり合算できない。

作業は隔離Research worktreeだけ。Codex V4、Production HP/LIVE/STOP/注文/保有建玉/Kill Switchは変更しない。PR #481はDraft維持。
