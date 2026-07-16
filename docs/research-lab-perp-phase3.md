# Research Lab Phase 3 - Perpetual Long / Short

## 背景

Phase 2のSpot Long研究では、Train期間にCAGR 76.69%・平均月利5.60%の戦略が見つかったが、取引5回のみでValidationとOOSに再現しなかった。取引数とのバランスが比較的良い戦略も、Train平均月利4.29%に対しOOS平均月利-1.66%だった。

この結果から、Spot Longのパラメータ調整だけでは平均月利30%目標へ到達できないと判断した。Phase 3では、上昇相場と下落相場を別々の収益源として扱うPerpetual Long / Short研究レーンを追加する。

## 研究対象

- BTC、ETH、BNB、SOL、XRP、ADA、AVAX、LINK、LTC、ATOM、AAVE、NEAR、INJ
- 2h / 4h / 6h / 8h / 12h
- Long / Short
- 1x - 5x leverage
- BTC regime filter
- Relative momentum
- High / Low breakout
- Volume confirmation
- Volatility-adjusted ranking
- ATR position sizing
- Stop Loss / Take Profit / Trailing Stop
- Position rotation
- Cooldown

## 約定・リスクモデル

Base条件:

- Fee: 6bps / side
- Slippage: 5bps / side
- Adverse funding: 1bps / 8h
- Maintenance margin: 0.5%

Stress条件:

1. Moderate: Fee 10bps、Slippage 10bps、Funding 2bps / 8h
2. Severe: Fee 15bps、Slippage 20bps、Funding 4bps / 8h
3. Extreme: Fee 20bps、Slippage 30bps、Funding 8bps / 8h、Maintenance margin 0.75%

Fundingは常に戦略に不利な方向へ計上する。LongでもShortでもFunding収益を前提にしない。

## 清算モデル

実効レバレッジとMaintenance Marginから清算価格を計算する。バー内のHigh / Lowが清算価格へ到達した場合、清算として記録する。

**Final CandidateはLiquidation 0件を絶対条件とする。**

高い収益が出ても清算が1回でもあれば却下する。

## 探索パラメータ

- Leverage: 1x - 5x
- Risk per trade: 0.25% - 5%
- Maximum margin usage: 20% - 100%
- BTC regime SMA: 10 - 160 bars
- BTC momentum: 2 - 60 bars
- Asset momentum: 2 - 100 bars
- Breakout: 2 - 80 bars
- ATR: 3 - 60 bars
- Stop: 0.5 - 6 ATR
- Take Profit: 1 - 15 ATR
- Trailing: 0.5 - 8 ATR
- Maximum hold: 2 - 160 bars
- Rebalance: 1 - 40 bars
- Cooldown: 0 - 30 bars

## Discovery Gate

- 平均月利 >= 5%
- MaxDD <= 35%
- Sharpe >= 1.0
- Profit Factor >= 1.2
- Trades >= 20
- Liquidation = 0
- Long / Shortの両方向に取引がある

Discovery Gateは最終採用基準ではなく、進化探索を継続する最低条件。

## Final Candidate Gate

- OOS平均月利 >= 30%
- OOS MaxDD <= 35%
- OOS Trades >= 12
- OOS Long / Shortの両方向に取引がある
- OOS Liquidation = 0
- 最大連敗 <= 8
- TrainからOOSへの収益維持率 >= 50%
- Walk-forward通過率 >= 60%
- Extreme Cost Stress後の平均月利 >= 20%
- OOSからStress後への収益維持率 >= 50%
- Validation Liquidation = 0

Final Candidateは実売買候補ではない。次にForward Paper、Shadow、極小額Pilotを行う。

## 時系列検証

- Train: 60%
- Validation: 20%
- OOS: 20%
- Expanding Walk-forward: 3 folds

OOSはパラメータ生成・交配・突然変異に利用しない。

## 実行

### 自己テスト

```bash
npm run research:perp:selftest
```

合成相場で以下を検証する。

- Long取引が生成される
- Short取引が生成される
- Fee / Slippage / Fundingが計上される
- Effective leverageが設定上限を超えない
- Net PnLが有限値である
- Equityが負値にならない
- 進化探索と最終検証が完走する

### 実データ研究

```powershell
$env:BINANCE_PUBLIC_ARCHIVE_ONLY="true"
$env:PERP_RESEARCH_ROUNDS="20"
$env:PERP_RESEARCH_POPULATION="5"
$env:PERP_RESEARCH_FINALISTS="5"
$env:PERP_RESEARCH_START_DATE="2023-01-01"
$env:PERP_RESEARCH_END_DATE="2026-07-01"
npm run research:perp
```

GitHub Actionsでは `Research Lab Perpetual Pilot` を手動実行する。

## レポート

```text
reports/research-lab-perp/<started-at>/result.json
reports/research-lab-perp/<started-at>/report.md
```

必須記録:

- Train / Validation / OOS平均月利
- CAGR / MaxDD / Sharpe / PF
- Long trades / Short trades
- Liquidation count
- Average / Maximum effective leverage
- Maximum consecutive losses
- Walk-forward通過率
- 各Stress条件の平均月利
- OOS / Stress収益維持率
- Final Gate失敗理由
- Strategy Genomeと親戦略ID

## 安全分離

- 実売買へ接続しない
- AsterDEXやウォレットへ注文を送らない
- API Keyを使用しない
- 現在のSpot運用ロジックを置換しない
- Final Candidateが出ても自動昇格しない
- 清算0件でもForward Paperを必須とする
