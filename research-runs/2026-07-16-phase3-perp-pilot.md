# Phase 3 Perpetual Long / Short Pilot - 2026-07-16

## 結論

Perpetual Long / Short研究レーンは、Phase 2のSpot LongよりOOS再現性が大幅に改善した。

最高戦略はTrain平均月利2.52%、OOS平均月利2.46%、OOS維持率97.7%、Walk-forward通過率66.7%、Long / Short両方向、清算0件だった。

ただし平均月利30%目標には未達。Moderate Costで月利1.72%、Severe Costで0.52%、Extreme Costで-0.73%まで低下したため、Final Candidateは0件とした。

## データ上の注意

この初回PilotはBinance公式Spot 1H OHLCを価格Proxyとして利用し、PerpetualのFee、Slippage、Funding、Maintenance Margin、LiquidationをEngine内でシミュレーションした。

次回からBinance公式USD-M Futures Klinesへ切り替える。Fundingは現段階では常に戦略に不利な固定値であり、実Funding履歴はまだ使用していない。

したがって、このPilotは研究方向の選別には利用できるが、Forward Paperへ進める最終証拠ではない。

## 実行条件

- Period: 2023-01-01 - 2026-07-01
- Price data: Binance official Spot 1H public archive
- Symbols: BTC / ETH / BNB / SOL / XRP / ADA / AVAX / LINK / LTC / ATOM / AAVE / NEAR / INJ
- Discovery: 10 rounds × 5 strategies = 50
- Validation: top 5
- Time split: Train 60% / Validation 20% / OOS 20%
- Walk-forward: 3 folds
- Requested leverage search: 1x - 5x
- Base Fee: 6bps / side
- Base Slippage: 5bps / side
- Adverse Funding: 1bps / 8h
- Liquidation simulation: enabled

## 最高戦略

`p3-0002 / dual_direction`

### Genome

- Markets: ETH / SOL / AVAX / LINK / INJ / NEAR
- Timeframe: 2h
- Requested leverage: 3.04x
- Risk per trade: 1.68%
- Maximum margin usage: 52.8%
- BTC regime SMA: 83 bars
- BTC regime momentum: 33 bars
- Regime threshold: 1.94%
- Asset momentum: 23 bars
- Breakout: 16 bars
- Breakout buffer: 1.02%
- Minimum momentum: 4.75%
- Minimum volume ratio: 1.3078
- ATR: 23 bars
- Stop: 2.9804 ATR
- Take Profit: 4.3889 ATR
- Trailing: 0.5 ATR
- Rebalance: 2 bars
- Cooldown: 4 bars

### Train

- Average monthly: 2.5164%
- CAGR: 35.7006%
- MaxDD: 2.5744%
- Sharpe: 4.4121
- Profit Factor: 2.8560
- Trades: 354
- Long / Short: 228 / 126
- Liquidations: 0
- Average effective leverage: 0.3043x
- Maximum effective leverage: 0.7975x

### Validation

- Average monthly: 1.0826%

### OOS

- Average monthly: 2.4582%
- CAGR: 36.3570%
- MaxDD: 1.7020%
- Trades: 104
- Long / Short: 50 / 54
- Liquidations: 0
- OOS return retention: 97.7%
- Walk-forward pass rate: 66.7%

### Execution Stress

| Scenario | Average Monthly | MaxDD |
| --- | ---: | ---: |
| Moderate | 1.7242% | 2.2754% |
| Severe | 0.5155% | 3.8711% |
| Extreme | -0.7320% | 10.2449% |

## 他のOOS検証戦略

| Strategy | Train Avg Month | OOS Avg Month | OOS CAGR | OOS MaxDD | OOS Trades | Long / Short | Liquidation | WF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p4-0004 | 0.83% | 0.44% | 5.70% | 1.50% | 59 | 28 / 31 | 0 | 0.0% |
| p9-0003 | 0.54% | 0.35% | 4.61% | 1.11% | 32 | 20 / 12 | 0 | 0.0% |
| p5-0001 | 0.94% | 0.58% | 7.69% | 1.06% | 52 | 24 / 28 | 0 | 0.0% |
| p6-0001 | 0.53% | 0.00% | 0.05% | 1.33% | 30 | 17 / 13 | 0 | 0.0% |

## Final Candidate判定

- Final Candidates: 0
- 実売買接続: 禁止
- Forward Paper昇格: なし
- 清算発生: 上位5戦略すべて0件

## 発見した問題

1. Effective leverageが低い
   - Requested leverageは3.04xだが、最高戦略の平均実効レバレッジは0.30x、最大0.80xだった。
   - ATR Stopが広く、Risk Based SizingがNotionalを強く抑えている。

2. Alpha per tradeが薄い
   - Moderate Costではまだプラスだが、Extreme Costで期待値が消える。
   - 取引回数を増やすだけではFeeとFunding負けになる。

3. 一度に1ポジションのみ
   - 独立したLong / Short機会を同時利用できない。
   - Exposureと実効レバレッジが低い原因の一つ。

4. Price dataがSpot Proxy
   - Perpetual basis、mark price、実Funding履歴を反映していない。

## 次の開発: Phase 3.1

### A. USD-M Futuresデータへ変更

- Binance公式USD-M Futures Klines
- Mark Price Klines
- Funding Rate履歴
- Futures銘柄の上場期間Guard

### B. Attack / Balancedの二系統探索

Balanced:

- Effective leverage target: 0.5x - 1.5x
- MaxDD target: 25%
- Liquidation: 0

Attack:

- Effective leverage target: 1.5x - 4x
- MaxDD limit: 35%
- Liquidation: 0
- 月利30%探索を優先

### C. Multi-position Portfolio

- Maximum positions: 1 - 3
- Portfolio risk budget
- Symbol correlation cap
- Long / Short gross exposure cap
- Net exposure cap
- Same-sector concentration cap

### D. Cost-aware Alpha改善

- Minimum expected move after all costs
- Signal strength / cost ratio
- Funding-aware holding
- Trade frequency penalty
- No-trade zone

### E. Evolution改善

- Return frontierとRisk frontierを別々に保存
- Novelty archive
- Low-risk解への早期収束防止
- FamilyごとのElite保持
- Effective leverage utilizationをScoreへ追加

## CIO判断

Phase 3 Engineは採用する。戦略は全却下する。

最高戦略はOOS再現性と清算0件の点で研究用Parentとして保存するが、平均月利30%とCost Stressを満たさないため実運用候補ではない。
