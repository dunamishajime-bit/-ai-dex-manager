# Phase 2 Spot Research Pilot - 2026-07-16

## 結論

現行のSpot Long中心Hybrid探索では、Train期間に高い成績を出す戦略は発見できたが、Validation / OOSで再現しなかった。

平均月利30%超の目標へ進むには、既存Long戦略のパラメータ最適化だけでは不十分。次の研究レーンは、下落相場でも利益を狙えるPerpetual Long / Short、複数戦略ポートフォリオ、レバレッジと清算を含む厳格なリスクシミュレーションとする。

## 実行条件

- Data: Binance公式Spot 1H public archive
- Period: 2023-01-01 - 2026-07-01
- Discovery: 10 rounds × 5 strategies = 50
- Final diagnostic validation: top 5
- Split: Train 60% / Validation 20% / OOS 20%
- Walk-forward: 3 folds
- Execution stress: extra round-trip cost 20 / 50 / 100 bps
- Research target: average monthly return 30%+

## Discovery結果

### 最高Train成績

`g2-0003 / volatility`

- Markets: ETH / SOL / AVAX
- CAGR: 76.69%
- Average monthly return: 5.60%
- MaxDD: 13.73%
- Sharpe: 1.45
- Profit Factor: 73.39
- Trades: 5
- Positive months: 22.7%

高CAGRだが、取引5回に依存しており再現性不足。Validation平均月利は-3.84%、OOSは取引0回だった。

### 取引数とのバランスが最も良かった戦略

`g7-0005 / volatility`

- Markets: ETH / BNB / SOL
- Train CAGR: 57.48%
- Train average monthly: 4.29%
- Train MaxDD: 17.42%
- Sharpe: 1.37
- Trades: 27
- Validation average monthly: 2.01%
- OOS average monthly: -1.66%
- OOS CAGR: -19.16%
- OOS MaxDD: 12.71%
- OOS trades: 4
- Walk-forward pass rate: 0%
- 100bps stress average monthly: -2.16%

## OOSへ送った5戦略

| Strategy | Family | Train Avg Month | Validation Avg Month | OOS Avg Month | OOS CAGR | OOS MaxDD | OOS Trades | Walk-forward |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| g7-0005 | volatility | 4.29% | 2.01% | -1.66% | -19.16% | 12.71% | 4 | 0.0% |
| g2-0003 | volatility | 5.60% | -3.84% | 0.00% | 0.00% | 0.00% | 0 | 0.0% |
| g8-0002 | volatility | 4.89% | 5.43% | -2.07% | -22.96% | 18.68% | 4 | 33.3% |
| g1-0003 | volatility | 4.32% | 2.73% | -1.02% | -12.30% | 8.08% | 2 | 33.3% |
| g6-0001 | breakout | 4.61% | -0.55% | -1.93% | -21.99% | 15.11% | 3 | 0.0% |

Final Candidate: 0

## 失敗原因

1. Long中心のため、弱い相場・下落相場で収益源がない。
2. 月次中央値が0%で、現金待機月が多い。
3. 高CAGR戦略ほど少数トレードへ依存している。
4. Trainで有効だったVolatility breakoutがOOSで逆機能した。
5. 既存の最大1ポジション構造では、独立した収益機会を同時に利用できない。
6. レバレッジを掛けても、OOS期待値がマイナスなら損失だけが拡大する。

## 採用判断

- 現行50戦略: 全却下
- Spot Long系の単純パラメータ増加: 優先度を下げる
- 上位戦略の実売買接続: 禁止
- Forward Paper昇格: なし

## 次の開発

### Phase 3 - Perpetual Long / Short Research Lane

- Long / Shortの両方向
- BTC regimeによる方向制御
- Relative momentumによる銘柄選択
- ATR risk sizing
- 1x - 5x leverage探索
- Stop / Take Profit / Trailing Stop
- Funding / fee / slippage
- Liquidation simulation
- 最大損失・連敗・日次損失Gate
- 複数戦略ポートフォリオ
- Train / Validation / OOS / Walk-forward
- Final CandidateはLiquidation 0件を必須とする

## データ取得改善

GitHub RunnerではBinance Spot APIの全公式APIエンドポイントがHTTP 451となったため、Binance公式 `data.binance.vision` の月次1時間足ZIPへ自動フォールバックする方式へ変更した。

Research workflowでは公式public archiveを直接利用し、`.cache/hybrid-retq22` と `.cache/hybrid-universe` をGitHub Actions cacheへ保存する。
