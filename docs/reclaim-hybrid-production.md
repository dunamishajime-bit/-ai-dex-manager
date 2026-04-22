# reclaim_plus_avax_sol_aux_alloc040_relaxed_baseline

## 採用方針
- 本番採用ロジック: `reclaim_plus_avax_sol_aux_alloc040_relaxed_baseline`
- `A_ATTACK` / `A_BALANCE` は UI 上の表示名として残しつつ、内部では同一ロジックを参照します
- 実行チェーン: `BNB Chain`

## ロジック概要
- 参考指標: `BTC`
- 待機資産: `USDT`
- ガス確保: `BNB`
- 主レンジ: `ETH reclaim`
- 補助レンジ: `AVAX + SOL atr_snapback`
- 補助レンジの稼働年想定: `2024 / 2025`

## バックテスト結果
- End Equity: `116,398.82`
- CAGR: `134.62%`
- MaxDD: `-34.08%`
- PF: `2.131`
- Trades: `56`

## 実運用リスク設定
- 最大同時保有数: `1`
- 1回あたり最大使用率: `40%`
- USDT待機比率: `5%`
- BNBガス確保: `1.2 USD`
- 日次損失上限: `2.5%`
- ハードストップ: `-8%`
- Trend trailing stop: `1.85%`
- Range trailing stop: `1.2%`

## 価格取得フォールバック
1. CoinGecko
2. CoinCap
3. Binance
4. ローカルキャッシュ

## Quote フォールバック
1. ParaSwap
2. OpenOcean

## 監視対象トークン
- `BNB`
- `USDT`
- `ETH`
- `SOL`
- `AVAX`
- `LINK`

## 実装メモ
- `LINK` は監視対象と参考レート対象に含めていますが、現行ロジックの売買対象は `ETH / SOL / AVAX` です
- `A_ATTACK / A_BALANCE` は切替表示だけを残し、内部では共通の本番ロジックを使います
- API 制限時も価格取得が止まらないよう、価格取得元と quote 取得元を多重化しています
