# BT検証ページ / Portfolio・Gross再生仕様（2026-11-14）

PR #480。ページパス：/bt-verification（既存HPの認証ガード内）。

## UI要件
- Total / Crypto / Stock のGrossを「使用実数 x / 上限 x」を主、使用率%を補助で表示。
- 建玉・予約別のGrossを色分けした積み上げゲージで表示。
- 同時点の保有通貨、LONG/SHORT、ロジック、数量、Entry/Mark、想定元本、Gross x、Gross占有率、含み損益、STOP/TPが見える。
- 発火イベントを選ぶと時刻へジャンプし、Grossの前後値・増減・Total上限に対する割合が見える。複数同時イベントは現状スナップショット全体での合算差分と明示する。
- BTC代表価格・取引イベント・エクイティ・DD・建玉・Grossを同じスナップショット時刻で更新する。
- ブラウザ内保存、JSON / CSV / ZIPエクスポートと再読込を用意。ZIPはevent ledger、position and Gross timeline、logic pins、engine SHAを含む。

## Gross会計
- LONGとSHORTをネットせず、全建玉の絶対元本でGrossを集計する。
- 建玉元本は数量 × 当時点の時価。通貨換算は正規BTエンジン側で口座基準通貨へ正規化する必要がある。
- 建玉Gross x = 当時点の口座基準通貨建て元本 / 当時点Equity。
- Total Gross x = Crypto Gross x + Stock Gross x。
- 使用中比率% = 建玉Gross x / 現在のTotal Gross x × 100。
- 全体上限比率% = 建玉Gross x / そのBT実行時のTotal Gross上限 x × 100。
- Pending注文枠は開いている建玉と重複して計上しない。既約定ポジションと古い予約を二重計上しない。
- 残余枠= max(0,上限-使用)。超過した場合は数値を隠さず警告。
- 3.50 / 3.00 / 1.50 はUIデモ専用初期値。実BTでは台帳保存時のGross上限を採用する。

## 実BTとデモの境界
- UI_DEMOは画面を動かすための架空の売買・価格。利益率・勝率・DDを正式BT結果とみなしてはならない。
- REAL_BTはインポートしたイベント台帳の読取再生。台帳のmode宣言だけでは最新SHA整合性・データ真正性は確定しない。原本照合が終わるまでは未認証として表示する。
- SYNTHETIC_BT（人工相場検証）は正規BTエンジンで処理する。HP独自のロジック判定エンジンは作らない。
- LIVE注文・本番建玉・STOP・Kill Switch・共有Riskを一切変更しない。
- 正規BTC OHLCデータがない場合、架空のローソク足を捏造せず、価格データ不足を示す。
- 25MBより大きい台帳は今後の認証付きサーバ保存／ストリーミング取込の対象。
- ブラウザ保存は補助機能。永続保存には現時点でZIPをダウンロードする。

## 今回の追加ファイル
- app/bt-verification/page.tsx：設定・再生・資産・Gross・ポートフォリオ・保存とエクスポート
- lib/bt-portfolio-replay.ts：入力契約とGross計算
- lib/bt-ui-demo.ts：明示されたUIデモ
- lib/bt-export-package.ts：JSON/CSV/ZIP出力
- tests/bt-portfolio-replay.test.ts と tests/bt-export-package.test.ts
- PC/スマホ共通ナビ、.github/workflows/bt-portfolio-replay-ci.yml

## 正式本番までの未完了項目
1. 最新検証済みロジックのpinを正規BTコアと照合して登録する。仮ロジックや仮SHAを正式扱いしない。
2. 2025-10-01〜2026-10-01の正規BT台帳から、費用・Funding・入口/出口・リスク判定・予約管理まで完全一致する時点スナップショットを出力する。
3. BTC実OHLCによるローソク足、同時刻複数イベントの処理順序、時点前後Grossの完全照合。
4. HPの認証付き永続保存／再読込／DL API、ハッシュと権限検証、GPT・Codexの再利用確認。
5. VPSのディスク（監査時95%使用）、既存HP release、ロールバック、正式owner承認・GitHub Actions切替のゲート照合。
6. LIVEのRunner・注文・STOPを保護したままUI単体を本番反映する。承認なしの直接切替はしない。
