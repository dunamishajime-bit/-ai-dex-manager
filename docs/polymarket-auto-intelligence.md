# PolyMarket Auto Intelligence Router v1

GoldCatSystemへの新規追加ロジックです。既存のWeather Router、Cryptoロジック、既存バックテスト表示は削除・停止せず、別枠で追加しています。

## 目的

PolyMarket市場を対象に、JSON snapshotを入力として以下を行います。

- 市場ごとのルールベーススコアリング
- Entry / Watch / Reject 判定
- 判断困難市場のみAI Escalation対象化
- Entry市場の想定トレード生成
- Resolution / Take Profit / Stop Loss の想定Exit
- ROI、PnL、Win Rate、Max Drawdown等の集計
- 7日 / 14日 の期間別想定バックテスト
- HP上での確認

## 重要方針

- Election threshold Yes 80-95c ex margin は停止済み前提です。この新機能では触りません。
- 既存ロジックは削除しません。
- BTC地合いフィルターは使いません。
- Cryptoロジックとは混ぜません。
- GPT APIは常時使用せず、境界スコア・複雑ルール・矛盾ソースなどの判断困難ケースだけに限定します。
- 現時点のAI reviewはmockです。Telegram GPT-5.4/OpenAI/他モデル接続は aiEscalation.ts のadapter差し替えで行います。

## 追加モジュール

- lib/goldcat/polymarket/types.ts
- lib/goldcat/polymarket/config.ts
- lib/goldcat/polymarket/scoreMarket.ts
- lib/goldcat/polymarket/aiEscalation.ts
- lib/goldcat/polymarket/simulatedBacktest.ts
- lib/goldcat/polymarket/sampleData.ts
- lib/goldcat/polymarket/index.ts
- components/features/polymarket/PolymarketBacktestPanel.tsx

## 7日 / 14日 想定バックテスト

`getSamplePolymarketBacktestWindows()` で以下を返します。

- `d7`: 最新snapshotから過去7日分
- `d14`: 最新snapshotから過去14日分

HPの `PolyMarket Simulated Backtest` パネルでは、7日と14日の想定成績を並べて表示します。

現在はサンプルsnapshotが1日分だけなので、7日/14日の表示値は同じになります。Telegram GPT-5.4やPolyMarket APIから7日以上のsnapshotが保存されれば、期間別に正しく差が出ます。

## 入力データ

サンプルJSON:

- data/polymarket-auto/config.json
- data/polymarket-auto/snapshots/2026-06-28.json

今の画面表示はsampleData.tsを使っています。将来的にはsnapshot loaderを追加し、Telegram GPT-5.4やPolyMarket APIから保存したsnapshotを読み込ませてください。

## 未来情報禁止

Entry判定にはsnapshotIso時点の情報だけを使う前提です。実際の決着結果や後続価格はExit計算にのみ使います。

## 次の接続ポイント

1. Telegram GPT-5.4分析結果をsnapshot JSONとして保存
2. PolyMarket APIから市場価格・流動性・決着結果を保存
3. aiEscalation.ts の runAIReviewMock を実API adapterに差し替え
4. sampleData.ts ではなくdata/polymarket-auto/snapshotsを読み込むloaderに切替
5. 実売買前にpaper tradingとして一定期間検証
