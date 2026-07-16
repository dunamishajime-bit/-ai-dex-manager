# DisdexManager V2 - AI Hedge Fund Research Lab

## 目的

DisdexManager V2を単一の自動売買Botではなく、戦略の考案・検証・反証・改善を自動反復する研究基盤へ拡張する。

研究目標は**平均月利30%超のロジック発見**とする。ただし月利30%は保証値ではなく、Train期間だけの高収益や過大なレバレッジによる見せかけの収益は採用しない。

## 自動研究フロー

1. 専門分野の異なる10人の研究員が戦略候補を生成する
2. Train期間で既存Hybrid Backtest Engineを実行する
3. CAGR、平均月利、中央値月利、MaxDD、Sharpe、Sortino、PF、月次安定性を計算する
4. 3人の反対派が過学習、テールリスク、約定コストの欠点を探す
5. 上位戦略を交配・突然変異させ、次ラウンドへ進める
6. 探索終了後、上位候補だけValidation期間へ進める
7. 完全未使用Out-of-Sample期間で再検証する
8. Expanding Window方式のWalk-forward検証を行う
9. OOS結果へ20bps、50bps、100bpsの追加往復コストを適用する
10. CIO Gateが却下・候補・最終候補を判定する
11. JSONとMarkdownで全根拠を保存する

## Phase 2実装範囲

- Strategy Genomeと進化探索
- 100 rounds × 5 strategies = 500 discovery evaluations
- Train 60% / Validation 20% / OOS 20%の時系列分割
- 上位候補のみ最終検証するStaged Validation
- Expanding Walk-forward validation
- 20〜100bpsの追加往復コストストレス
- 平均月利・中央値月利
- 月利30%到達月の割合
- 3か月ローリング月利30%相当の到達率
- OOS収益維持率
- ストレス後収益維持率
- Backtest Resultの重複実行キャッシュ
- Final Candidate Hard Gate
- JSON / Markdown証拠レポート
- Research Lab画面

## 時系列分割

設定期間を未来方向へ並べ、以下の順番で固定する。

- Train: 最初の60%
- Validation: 次の20%
- OOS: 最後の20%

データをランダムにシャッフルしない。OOSは戦略探索とパラメータ選択に利用しない。

Walk-forwardはTrain開始点を固定し、Test期間を未来へ順番に移動するExpanding Window方式とする。

## 月利30%の扱い

平均月利30%は非常に高い目標であり、単純年率換算では約2,230%に相当する。したがって以下を区別する。

### Discovery Candidate

探索を継続する最低条件。

- CAGR >= 40%
- 平均月利 >= 3%
- 中央値月利 >= 1%
- MaxDD <= 25%
- Sharpe >= 1.3
- Sortino >= 1.5
- Profit Factor >= 1.35
- Trades >= 30
- Positive Months >= 55%

### Final Candidate

実運用候補ではなく、Forward Paperへ進めるための最終研究候補。

- OOS平均月利 >= 30%
- OOS中央値月利 >= 1%
- OOS MaxDD <= 30%
- 月利30%到達月 >= 20%
- TrainからOOSへの平均月利維持率 >= 50%
- Walk-forward通過率 >= 60%
- 最大100bpsの追加コストストレスを実施
- ストレス後平均月利 >= 20%
- OOSからストレス後への収益維持率 >= 50%
- すべてのFinal Gate Reasonが空

Final Candidateでも実売買には接続しない。次にForward Paper、Shadow、極小額Pilotという別工程が必要。

## 安全方針

Research Labは実売買から完全に分離する。

- ウォレットへ接続しない
- 注文を作成しない
- 自動売買を開始しない
- 既存の運用戦略を自動置換しない
- Train合格は `candidate` に留める
- OOSとストレスを通過した場合だけ `final_candidate` を許可する
- 高収益でもDD、サンプル数、期間安定性が不足すれば却下する

## 実行方法

### 小規模スモーク検証

```bash
npm run research:lab
```

既定値:

- 2 rounds
- 3 strategies / round
- 2 finalists
- 2 walk-forward folds
- 20bps / 50bps stress

### 100ラウンド本番研究

Linux / macOS:

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
- 500 discovery evaluations
- elite 2
- final validation上位10戦略
- 3 walk-forward folds
- 20bps / 50bps / 100bps stress
- concurrency 1

## 環境変数

```powershell
$env:RESEARCH_PROFILE="production"
$env:RESEARCH_ROUNDS="100"
$env:RESEARCH_POPULATION="5"
$env:RESEARCH_ELITES="2"
$env:RESEARCH_FINALISTS="10"
$env:RESEARCH_WALK_FORWARD_FOLDS="3"
$env:RESEARCH_STRESS_COST_BPS="20,50,100"
$env:RESEARCH_TARGET_MONTHLY_PCT="30"
$env:RESEARCH_FINAL_OOS_MONTHLY_PCT="30"
$env:RESEARCH_FINAL_STRESS_MONTHLY_PCT="20"
$env:RESEARCH_START_DATE="2023-01-01"
$env:RESEARCH_END_DATE="2026-07-01"
npm run research:lab
```

利用可能な主な環境変数:

- `RESEARCH_PROFILE`
- `RESEARCH_ROUNDS`
- `RESEARCH_POPULATION`
- `RESEARCH_ELITES`
- `RESEARCH_FINALISTS`
- `RESEARCH_CONCURRENCY`
- `RESEARCH_SEED`
- `RESEARCH_WALK_FORWARD_FOLDS`
- `RESEARCH_STRESS_COST_BPS`
- `RESEARCH_TARGET_MONTHLY_PCT`
- `RESEARCH_FINAL_OOS_MONTHLY_PCT`
- `RESEARCH_FINAL_STRESS_MONTHLY_PCT`
- `RESEARCH_START_DATE`
- `RESEARCH_END_DATE`

## レポート保存先

```text
reports/research-lab/<started-at>/result.json
reports/research-lab/<started-at>/report.md
```

レポートには以下を必ず含める。

- Discovery指標
- Validation平均月利
- OOS平均月利・中央値月利・MaxDD
- 月利30%到達率
- Walk-forward通過率
- 各コストストレス後の平均月利
- OOS維持率とストレス維持率
- Final Gateの未通過理由
- Strategy Genomeと親戦略ID

## 計算負荷

全500候補はTrainだけで探索し、上位候補だけValidation、OOS、Walk-forward、Stressへ進める。これにより全候補を毎回3分割以上で再計算する構成を避ける。

同一Genome・同一期間のBacktest Resultは実行中メモリへキャッシュする。価格データとIndicatorの完全共有は、次の高速化段階でHybrid Engine側へ追加する。

## 次の研究強化

1. Hybrid Engineの共有Raw Data / Indicator Cache
2. 銘柄除外テスト
3. 年別・Bull / Bear / Range別安定性
4. Parameter Sensitivity Heatmap
5. Deflated Sharpe Ratio
6. Probability of Backtest Overfitting
7. Strategy Fingerprintによる重複排除
8. Portfolio of Strategiesによる相関分散
9. Forward Paper Evidence
10. LLM研究員が失敗理由を読んで次ラウンドを設計する仕組み
