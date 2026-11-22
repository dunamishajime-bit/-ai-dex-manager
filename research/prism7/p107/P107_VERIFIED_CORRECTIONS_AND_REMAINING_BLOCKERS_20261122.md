# P107 現行STABLE4完全一致BT — 修正・検証・最終判定（2026-11-22）

**最終判定: BLOCKED_NOT_FULL_PARITY（完全一致未達）**。本番と同一の通算利益、最大DD、勝率を算出したと主張しない。既存のSTABLE4研究BT結果を正式PASSに転用しない。

## 今回追加実施した再現・修正

1. VPSの実固定SHAとGitHubのリリースソース17ファイルは、LF/CRLF差正規化後17/17同じ内容。
2. 2026-11-11の旧BTは20ファイルが完全にSHA256一致（旧PINに限る再現性）。
3. 旧監査はStock1.5／Total3.5を本番基準と誤認していた。実PINの統合sourceはCrypto3.0、Stock4.0、Total4.25を記載。比較条件の1.5／3.5は別シナリオに分離、回帰テストPASS。
4. Q102のsystemd envに MAX_GROSS 0.50 を読み取り専用で確認し、旧ソースの研究感応度を10/30bps両方再実行、実際のモデル約定Grossは0.50以下。だが旧V4/Q102/HYPE/V52ピンとH1近似出口なので**完全一致ではない**。
5. **現行HYPE固定SHA e0e4f1d8... の元TypeScriptソース**をそのまま実行。ASTER HYPE/BTC H1の2025-10-01〜2026-10-01で6hグリッド1460点のうち現行入口候補35、48時間出口境界価格35/35取得。未来値・H1欠損・不正OHLC・時刻ずれ・古い境界価格は拒否テストPASS。旧HYPE台帳78候補（うち6hグリッド8候補）と入口時刻は一致0件。**旧研究台帳は新HYPEに代用不可**。35件は候補であり、35実約定ではない。
6. **現行Q102固定SHA c7310d34...** をASTER 181日履歴で実行。AVAX/BTC限定2日サンプルで2025-10-01はQUALITY102_INVALID_CANDLE、2026-08-03は正常なNO_SIGNAL。0.50のsource runtime capを同時確認。
7. 現行Q102 S34モデルの**対象11銘柄**に必要な181日prewarmを照合。**FET、LDO、RENDERの3銘柄**は2025-10-01の冒頭で履歴が足りない。保存ASTER H1はFET/LDOが2026-01-09、RENDERが2026-01-06から。ASTER公式の公開v3 kline APIで2025-04-01と2025-10-01の各時間足も6/6件HTTP200かつ履歴0件を確認した。理由（未上場・公開制限等）は断定しない。Binanceデータで置換してASTERソース完全一致と称することは不可。
8. Q102 11銘柄＋BTCのASTER H1全期間検査で**BTCのOHLC不整合1本**（2025-09-13 13:00 UTC、open 115941.8 / high 115916.1）。ASTER公式公開kline API v1とv3の生応答は同じ不整合・同一SHA256（e5d84f66...）である。保存ファイルだけの破損ではない。無根拠にhighをopenまで引き上げる等の書換え禁止。Source-nativeの検証でその異常を含む候補はFail Closedとなる。
9. 保存済み5研究ケース×10/30bpsの全10台帳で約定件数・モデルDD21 HOLD件数は一致。しかし旧SHA4系統＋H1近似価格・signed実約定0であり、口座単位の正しい本番採用成績とは確定できない。

## 経済動作の未解決要素

- V4全候補の現行 e788... 発火式と約定入口、出口、M5 STOP/TP/Partial/Reduce-only/H48(非HYPE) 個別タイミングのフルリプレイ。
- PENGU1657...、Q102 c731...、FET/IDLE7688...、HYPE e0e...、V52 c731... 全Runnerの同時刻発火のorder slot/優先順位/反対建玉、Shared Risk7.5%、HOLD/再許可・Gross・MTM/手数料・Fundingを一体で再計算。
- V52は過去研究でH1価格basis proxy・V11 microstructure未再現、過去注文簿／シグナルの完全source-native証拠なし。
- Q102公式H1の欠損と無効OHLCを「取引可能」として扱わない。必要なら非公式・別会場市場は個別**比較研究**として明示し、ASTER完全一致の証拠に用いない。
- 10bpsと30bpsで独立モデルの全候補・全約定を再計算し、信頼できる市場データSHA・時間順取引・STOP/Fundingの証拠保存後にのみDD20%／勝率70%判定を行う。

## 証拠

- HYPE current-pin source scan, 35-entry evidence, tests: [hype_exact/README.md](./hype_exact/README.md).
- Q102 venue H1 availability, invalid native OHLC, exact TS sample tests: [q102_native/README.md](./q102_native/README.md).
- Previous full-parity exclusion: [P107_STABLE4_FULL_PARITY_VERDICT_20261122.md](./P107_STABLE4_FULL_PARITY_VERDICT_20261122.md).
- Q102 0.50x old-model sensitivity: [P107_RUNTIME_CAP_CORRECTION_CHECKPOINT_20261122.md](./P107_RUNTIME_CAP_CORRECTION_CHECKPOINT_20261122.md).

**LIVE操作 0 / テスト注文 0 / RunnerやSTOP設定変更 0 / GLOBAL HOLD解除 0**。

P107を偽のPASSで終えるより、検証可能部分をコードと台帳で固定し、根拠の無い部分をFAIL CLOSEDにする。P108→P109→P110の確定評価はP107の本番一致が実証された後に実施する。
