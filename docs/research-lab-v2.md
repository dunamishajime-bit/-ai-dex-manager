# DisdexManager V2 - AI Hedge Fund Research Lab

## 目的

DisdexManager V2を単一の自動売買Botではなく、戦略の考案・検証・反証・改善を自動反復する研究基盤へ拡張する。

研究所は以下を自動化する。

1. 専門分野の異なる10人の研究員が戦略候補を生成する
2. 既存のHybrid Backtest Engineで検証する
3. CAGR、MaxDD、Sharpe、Sortino、PF、取引数、月次安定性を計算する
4. 3人の反対派が過学習、テールリスク、約定コストの欠点を探す
5. CIO Gateが却下・候補・最終候補を判定する
6. 上位戦略を交配・突然変異させ、次ラウンドへ進める
7. JSONとMarkdownで研究レポートを保存する

## 現在の実装範囲（Phase 1）

- 10 Researcher profiles
- 3 Critic profiles
- Strategy Genome
- 決定論的な乱数Seed
- 初期戦略生成
- 上位戦略の交配
- Researcherごとの重点突然変異
- 既存 `runHybridBacktest()` への接続
- 月次リターンからSharpe / Sortinoを算出
- CIO ScoreとHard Gate
- 複数ラウンドOrchestrator
- 同時実行数制御
- 失敗戦略の自動却下
- JSON / Markdownレポート
- Research Lab画面

## 安全方針

Research Labは実売買から完全に分離する。

- ウォレットへ接続しない
- 注文を作成しない
- 自動売買を開始しない
- 既存の運用戦略を自動置換しない
- 単発バックテスト合格は `candidate` に留める
- `final_candidate` は独立期間検証とストレス検証を通過した場合だけ許可する

Phase 1のBacktest Adapterは `single_pass` であるため、基準を満たしても最終候補には昇格しない。

## 実行方法

### 小規模スモーク検証

```bash
npm run research:lab
```

既定値:

- 2 rounds
- 3 strategies / round
- 6 evaluations
- concurrency 1

### 100ラウンド本番研究

```bash
RESEARCH_PROFILE=production npm run research:lab
```

Windows PowerShell:

```powershell
$env:RESEARCH_PROFILE="production"
npm run research:lab
```

既定値:

- 100 rounds
- 5 strategies / round
- 500 evaluations
- elite 2
- concurrency 1

### 任意設定

```bash
RESEARCH_ROUNDS=20 \
RESEARCH_POPULATION=10 \
RESEARCH_ELITES=3 \
RESEARCH_CONCURRENCY=1 \
RESEARCH_START_DATE=2023-01-01 \
RESEARCH_END_DATE=2026-01-01 \
npm run research:lab
```

利用可能な環境変数:

- `RESEARCH_PROFILE`
- `RESEARCH_ROUNDS`
- `RESEARCH_POPULATION`
- `RESEARCH_ELITES`
- `RESEARCH_CONCURRENCY`
- `RESEARCH_SEED`
- `RESEARCH_START_DATE`
- `RESEARCH_END_DATE`

## レポート保存先

```text
reports/research-lab/<started-at>/result.json
reports/research-lab/<started-at>/report.md
```

## CIO候補基準（初期値）

- CAGR >= 40%
- MaxDD <= 25%
- Sharpe >= 1.3
- Sortino >= 1.5
- Profit Factor >= 1.35
- Trades >= 30
- Positive Months >= 55%
- Temporal Stability >= 0.55
- Recent Period Score >= 0.45

単一指標だけで採用せず、全Hard Gateを満たす必要がある。

## 次の実装（Phase 2）

1. Backtest Dataを1回だけロードし、500候補で共有する
2. Train / Validation / Out-of-Sampleの時系列分割
3. Walk-forward validation
4. 手数料2倍・3倍ストレス
5. Slippage stress
6. 銘柄除外テスト
7. 年別・相場レジーム別安定性
8. Parameter sensitivity heatmap
9. Deflated Sharpe Ratio / Probability of Backtest Overfitting
10. Candidate Databaseと重複戦略排除

## Phase 3

- LLM Idea Providerを接続
- 研究員が前ラウンドの失敗理由を読んで次戦略を提案
- 反対派が自然言語で反証
- CIOが統計結果と反証を統合
- 毎晩VPS cron / PM2で実行
- Telegramへ研究サマリー送信

## 重要な制約

現在の `runHybridBacktest()` は候補ごとにデータ読込・指標構築を行う。Binanceデータはファイルキャッシュされるが、500評価はCPU負荷が高い。

本番100ラウンドを常用する前に、Phase 2の共有データセット・共有Indicator Cacheを実装する。現時点では小規模スモーク検証から開始する。
