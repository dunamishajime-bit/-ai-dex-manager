# Research Lab Phase 3.1 - USD-M Futures / Attack & Balanced

## 目的

Phase 3のPerpetual EngineはOOS再現性を確認できたが、最高OOS平均月利は2.46%で、Extreme Costでは-0.73%まで低下した。

Phase 3.1では以下を実施する。

1. Spot価格Proxyを廃止する
2. Binance公式USD-M Futures Klinesへ切り替える
3. Binance公式Funding Rate履歴を時系列で反映する
4. BalancedとAttackを別々に進化させる
5. 実効レバレッジ不足と薄いAlpha / Cost比を改善する

## データ

- USD-M Futures 1H Klines
- USD-M Futures Funding Rate
- Source: Binance official public data archive
- Monthly ZIPを取得し、銘柄・期間単位で統合キャッシュする
- 2025年以降のmicrosecond timestampはmillisecondへ正規化する

BTC Funding履歴が取得できない場合、研究を開始しない。

## Funding計算

各Funding時刻について以下を適用する。

- Positive Funding
  - Long: 支払い
  - Short: 受け取り
- Negative Funding
  - Long: 受け取り
  - Short: 支払い

実Fundingに加えて、Execution Stressでは戦略に不利な追加Funding Bufferを課す。

### Base

- Actual Funding
- Additional adverse buffer: 0.5bps / 8h

### Moderate

- Actual Funding
- Additional adverse buffer: 2bps / 8h

### Severe

- Actual Funding
- Additional adverse buffer: 4bps / 8h

### Extreme

- Actual Funding
- Additional adverse buffer: 8bps / 8h

## Edge / Cost Gate

Entry前に予想値幅と想定コストを比較する。

```text
estimated cost = round-trip fee + round-trip slippage + expected adverse funding
```

```text
abs(momentum) >= estimated cost × minimumEdgeToCostRatio
```

この条件を満たさないSignalは、方向が正しくても取引しない。

探索範囲:

- Balanced: 2.5x - 6.0x Cost Ratio中心
- Attack: 1.5x - 4.0x Cost Ratio中心

Attackでも最低1.0x未満にはしない。

## Balanced Profile

目的:

- 安定性を維持しながら収益を引き上げる

探索:

- Requested leverage: 1x - 4x
- Risk per trade: 0.5% - 3.0%
- Margin usage: 30% - 85%
- Timeframe: 2h / 4h / 6h / 8h / 12h
- Target average effective leverage: 0.75x

Discovery Gate:

- Average monthly >= 5%
- MaxDD <= 25%
- Sharpe >= 1.1
- PF >= 1.25
- Trades >= 20
- Average effective leverage >= targetの35%
- Long / Short両方向
- Liquidation = 0

Final Gate:

- OOS average monthly >= 30%
- OOS MaxDD <= 25%
- Extreme Stress average monthly >= 20%
- Liquidation = 0

## Attack Profile

目的:

- 平均月利30%へ到達できる高収益Frontierを探索する

探索:

- Requested leverage: 3x - 5x
- Risk per trade: 2% - 5%
- Margin usage: 65% - 100%
- Timeframe: 2h / 4h / 6h / 8h中心
- Tighter ATR Stop
- Faster rotation
- Neutral regime entryを拡大
- Target average effective leverage: 1.75x

Discovery Gate:

- Average monthly >= 8%
- MaxDD <= 35%
- Sharpe >= 0.8
- PF >= 1.1
- Trades >= 30
- Average effective leverage >= targetの35%
- Long / Short両方向
- Liquidation = 0

Final Gate:

- OOS average monthly >= 30%
- OOS MaxDD <= 35%
- OOS Trades >= 12
- Maximum consecutive losses <= 10
- Walk-forward >= 60%
- Extreme Stress average monthly >= 20%
- Liquidation = 0

## Frontier Elite

単純な総合Score上位だけを親戦略にしない。

各Roundで以下を別々に保存する。

- Best composite score
- Best average monthly return
- Best average effective leverage
- Best Sharpe
- Best Profit Factor
- Best target-month hit rate
- Best per strategy family

これにより低DD・低レバレッジ解だけへの早期収束を防ぐ。

## Score配分

- Average monthly: 36%
- Monthly target hit rate: 7%
- Effective leverage utilization: 13%
- Drawdown: 12%
- Sharpe: 8%
- Profit Factor: 7%
- Trade sample: 7%
- Long / Short balance: 5%
- Consecutive-loss stability: 5%

Liquidationは別枠Hard PenaltyとHard Gate。

## 実行

### Attack

```powershell
$env:PERP_RESEARCH_PROFILE="attack"
$env:PERP_RESEARCH_ROUNDS="30"
$env:PERP_RESEARCH_POPULATION="5"
$env:PERP_RESEARCH_FINALISTS="8"
$env:PERP_RESEARCH_START_DATE="2023-01-01"
$env:PERP_RESEARCH_END_DATE="2026-07-01"
npm run research:perp
```

### Balanced

```powershell
$env:PERP_RESEARCH_PROFILE="balanced"
$env:PERP_RESEARCH_ROUNDS="20"
$env:PERP_RESEARCH_POPULATION="5"
$env:PERP_RESEARCH_FINALISTS="5"
npm run research:perp
```

GitHub Actions:

```text
Research Lab USD-M Futures
```

## Evidence

レポートには以下を保存する。

- Research profile
- Market data source
- Funding coverage per symbol
- Actual total funding cost
- Requested / effective leverage
- Minimum Edge / Cost Ratio
- Train / Validation / OOS metrics
- Walk-forward
- Execution Stress
- Liquidation count
- Final Gate reasons

## 安全性

- 実売買へ接続しない
- AsterDEXへ注文を送信しない
- API Keyを使用しない
- Final CandidateでもForward Paperへ送るだけ
- Liquidationが1件でもあれば却下
- 月利30%未達を理由にDDや清算基準を緩和しない
