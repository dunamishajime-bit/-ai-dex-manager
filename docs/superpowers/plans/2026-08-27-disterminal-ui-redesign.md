# DisDex Terminal UI/UX再設計 実装計画

## 目的

V12・PENGU Dual LS V2 / Short V20・V52 Top2の既存判定データを、HOME・Dashboard（`/positions`）・判定状況で直感的に確認できるUIへ再構成する。取引ロジック、Runner、Gate、リスク、注文経路、VPSトレード処理は変更しない。

## データ境界

- `/api/system/decision-status` の `runtime`、`v12Observability`、`penguRuntime`、`v52Top2Observability`を判定表示の正本とする。
- `/api/system/live-portfolio` を口座残高・建玉・未決済注文の正本とする。
- `/api/system/trade-history` は実現損益・直近約定の表示にのみ使い、取得不能時は未取得と表示する。
- UIは閾値判定やシグナル再計算を行わず、既存レスポンスを表示用に集約するだけにする。

## UI構成

1. 共通の表示モデルと状態バッジ、段階インジケータ、Compact候補行を作る。
2. HOMEを全体ステータス、3ロジックの稼働状態、実データに基づく注目候補最大3件に整理する。
3. `/positions`をTrading Cockpitとして残高・利用可能残高・未実現/実現損益・建玉・注文・ロジック別概要に整理する。
4. 判定状況をALL/V12/PENGU V2/V52のタブ構成にし、Compact行から詳細を展開できるようにする。
5. PENGU Long/Shortを分離し、V52にSTOCK/EQUITY区分を表示する。
6. Final Gateはレスポンスに存在する実際のGateだけを表示し、専用フィールドがない場合は未取得と明示する。
7. 既存の30秒ポートフォリオ更新、3時間ごとの判定更新、手動再確認を維持する。

## 安全条件

- UI、表示用テスト、読み取り専用の型/集約処理以外を変更しない。
- `tradingMutation=0`を維持する。
- Vercelへデプロイしない。完了後はXServer VPSのUIデプロイ経路だけを使用する。
- 実注文、取消、決済、テスト注文、Runner再起動を実行しない。

## 検証

- 表示モデルの状態集約・Long/Short分離・V52市場区分・データ未取得の失敗テストを先に失敗させる。
- TypeScript、lint、Next build、既存のread-only surface self-testを実行する。
- 差分にトレードロジック、Runner、Gate、注文処理、Kill Switch、Fail Closedの変更がないことを確認する。
- Gitへコミット後、VPS UIのみ更新し、HTTP表示と`tradingMutation=0`を確認する。
