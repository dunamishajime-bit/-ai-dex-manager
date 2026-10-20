# Task 9 全8ロジック動的統合BT 実装計画

## Goal

Task 9の固定Accepted台帳Replayを、候補生成・Rejected候補の因果的再評価・Shared Allocator・Gross/Pending予約・Preemption・Dynamic Lot・Exit/STOP・MTM会計まで含む研究専用の動的統合バックテストへ拡張する。

最初にOverlayなしの動的Baselineを再生し、既存Baselineとの差分を最初のイベントまで特定する。その後、V12 SHORT候補A/B/Cを同一エンジンで単独・累積検証し、10bps/30bps、OOS、独立Holdout、累積Gateまでを再現可能な成果物として保存する。Baseline Exact Parityを証明できない場合は、結果を正式Parityとは呼ばず、再構築Baselineとして明確に分離する。

## Architecture

### 研究パイプライン

```text
candidate source / strategy adapters
        -> evidence-aware candidate events
        -> deterministic event ordering
        -> single portfolio reducer
        -> allocator / reservation / ownership / cooldown
        -> preemption and execution lifecycle
        -> dynamic sizing / wallet / MTM
        -> parity, overlay, OOS, holdout evaluators
        -> manifests, ledgers, Japanese report, CI artifacts
```

既存の固定Replayは過去結果の比較基準として保存し、動的Reducerの入力状態を直接固定Accepted結果から作らない。Candidate sourceの不足は推測で埋めず、必須フィールドが欠けるイベントをFail Closedにする。

### モジュール境界

- `lib/backtest/dd-reduction/dynamic-types.ts`: Candidate/Event/State/Ledgerの型契約。
- `lib/backtest/dd-reduction/dynamic-source.ts`: 8ロジックの入力・既存台帳・市場データの証拠区分とCoverage Matrix。
- `lib/backtest/dd-reduction/dynamic-ordering.ts`: event sequence、priority、rank、tie-break、同時刻不確実性。
- `lib/backtest/dd-reduction/dynamic-allocator.ts`: Gross、pending/reserved、ownership、cooldown、margin、minQty/minNotional。
- `lib/backtest/dd-reduction/dynamic-preemption.ts`: 既存PositionのExit、Gross解放、Incoming再Admission。
- `lib/backtest/dd-reduction/dynamic-sizing.ts`: Decision直前のWallet/Equityと制約を用いたLot計算。
- `lib/backtest/dd-reduction/dynamic-replay.ts`: 単一時系列Reducer、Entry/Exit/STOP/partial/unknown、会計、MTM。
- `scripts/dd-reduction/run-dynamic.ts`: CLI入口、ケース選択、成果物出力。
- `scripts/dd-reduction/run-task9-dynamic.ts`: Baseline、A/B/C、累積、OOS/Holdoutのケース定義と比較レポート。

既存の `emulator.ts` / `source.ts` / `types.ts` / `policies.ts` は互換性を壊さず、必要な共通型・会計・MTM処理は再利用または小さく抽出する。Productionコード、VPS用コード、LIVE adapterは変更しない。

## Tech Stack

- TypeScript/tsx: 動的Allocator、Reducer、CLI、決定論的テスト。
- Python: 既存Task 9成果物との比較、10bps/30bpsの既存研究診断、必要なレポート補助。Productionコードには使用しない。
- JSONL/JSON/CSV: Candidate、Decision、State、Reservation、Preemption、Execution、MTM、Manifest。
- SHA256: 入力・設定・Ledger・成果物の再現性固定。
- `npm run dd:reduction:test`, `npx tsc --noEmit`, `python -m unittest discover -s scripts/dd-reduction -p 'test_*.py' -q`。

## Spec

実装の契約は以下を唯一の設計正本とする。

- `docs/superpowers/specs/2026-10-21-task9-dynamic-integrated-bt-design.md`
- 対象期間: 2025-08-10〜2026-08-10 UTC
- 初期資金: ¥10,000、積立なし、複利。
- コスト: 10bps / 30bps。
- 対象ロジック: V12、Q102、PENGU、FET、RESIDUAL、IDLE、V52、HYPE_LONG。
- 固定Baseline期待値は既存成果物に保存された値を比較アンカーとして使う。差分を補正して一致させない。
- Candidate入力は `ORIGINAL_EVIDENCE` / `CAUSALLY_REGENERATED` / `MISSING` / `UNVERIFIABLE` を必ず持つ。
- 欠損必須情報、未来のSTOP、確定していない同時刻順序、未証明Preemptionは正式ParityをFail Closedにする。
- Event orderは Deposit/Funding → Protection STOP → Preemption Exit → Normal Exit → execution reconciliation → reservation release → ownership/cooldown → candidate validation → priority/tie-break → preemption eligibility → sizing → reservation → fill → protection registration → state hash。
- 最終累積Gateは各Phase直前のBaselineではなく、初期Baselineに対して評価する。

## Global Constraints

- 研究専用。Production、VPS、LIVE、HP、Aster実口座、operator artifact、Shared Risk、Margin Guard、Kill Switchを変更しない。
- 実注文、取消、建玉変更、認証更新を行わない。
- main worktreeを触らず、現在の分離worktreeだけで作業する。
- 大容量BT出力はGit worktree内に置かず、`C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\<run-specific-folder>`へ保存する。Gitへはコード、manifest、レポート、テスト用の小さいfixtureだけを追加する。
- 既存の未追跡ファイル、Task 8/9成果物、root-owned `__pycache__`を削除・reset・cleanしない。
- 未来の損益、勝敗、最終取引件数からCandidate条件・Rejected理由・Preemptionを逆算しない。
- 既存固定Replay結果は比較対象として保持し、動的結果と混同しない。
- `PASS`は実行結果で確認できた場合だけ付与し、未実装・未観測・証拠不足を0件や成功として表現しない。

## Review Focus

- Candidate source coverageが8ロジック全てについて項目単位で説明可能か。
- 同一時刻の順序、Rejected候補の再Admission期限、未来STOP/Cooldown逆転がないか。
- Reservationのdouble-use、Gross解放前の再利用、同一symbol ownership、方向競合、partial/unknown executionが安全側か。
- Preemptionの対象Position、Exit、解放量、Cooldown、Incoming再Admissionが1回ずつ記録されるか。
- settlement/JPY/FX/fee/funding/slippage/wallet/equity/MTMを二重計上していないか。
- 固定Baselineとの最初の差分をイベント単位で保存し、数値合わせをしていないか。
- OOS候補選定と独立Holdout評価を分離しているか。累積2 Overlayの30bps OOS PF保全率87.8774% FAILを無断でPASSへ変更しないか。
- 研究結果に `FORMAL_PARITY` / `REBUILT_BASELINE` / `NONCANONICAL` を明示し、Production認証へ流用できないか。

## Implementation Tasks

### Task 1: Candidate source coverage と event schema を実装する

**Files**

- Add `lib/backtest/dd-reduction/dynamic-types.ts`
- Add `lib/backtest/dd-reduction/dynamic-source.ts`
- Add `scripts/dd-reduction/build-candidate-coverage.ts`
- Add `tests/dd-reduction-dynamic-source.test.ts`

**Steps (TDD)**

1. 8ロジック、10bps/30bps、raw candidate-decisionsの証拠区分、必須フィールド、欠損理由を表すfixtureを作る。
2. 失敗するテストを先に追加する: duplicate candidate ID、missing side/price、unsupported evidence、未知strategyをFail Closedにする。
3. `DynamicCandidateEvent`、`CandidateEvidence`、`CoverageEntry`、`CandidateSourceManifest`を定義する。
4. raw台帳・保存市場データ・strategy adapterを区分付きで読み、Candidate Eventへ正規化する。
5. `candidate-source-coverage-matrix.json`とSHA256 indexを生成し、3185行の観測台帳とロジック別件数を報告する。
6. tests、型検査、coverage fixtureを通す。
7. Commit: `feat(research): add evidence-aware dynamic candidate source`

### Task 2: 決定論的event orderingとstate hashを実装する

**Files**

- Add `lib/backtest/dd-reduction/dynamic-ordering.ts`
- Add `lib/backtest/dd-reduction/dynamic-state.ts`
- Add `tests/dd-reduction-dynamic-ordering.test.ts`

**Steps (TDD)**

1. 同時timestampで順序が確定、event_seq欠損、STOP/ENTRY順序不明、candidate ID tie-breakのfixtureを作る。
2. `orderDynamicEvents(events)`、`classifyOrderingEvidence(events)`、`hashAllocatorState(state)`の失敗テストを作る。
3. event sequence、priority、rank、tie-breakを実装し、順序不明を`SAME_TIMESTAMP_ORDER_UNVERIFIABLE`として保持する。
4. Canonical JSON state hashを実装し、同一入力のreplay determinismを固定する。
5. 未来のSTOPが過去EntryのCooldownに影響しないテストを追加する。
6. Commit: `feat(research): make dynamic event ordering deterministic`

### Task 3: Shared Allocator、Reservation、Ownership、Cooldownを実装する

**Files**

- Add `lib/backtest/dd-reduction/dynamic-allocator.ts`
- Add `tests/dd-reduction-dynamic-allocator.test.ts`
- Update `lib/backtest/dd-reduction/dynamic-types.ts` only for required contracts

**Steps (TDD)**

1. Wallet/equity、crypto/total/strategy/symbol Gross、pending/reserved、minQty/minNotional、ownership、direction conflict、cooldownのfixtureを作る。
2. `decideCandidate(state, candidate, policy)`の拒否理由とstate before/afterを検証する失敗テストを作る。
3. `DynamicAllocatorState`、`AllocationDecision`、`ReservationRecord`、`OwnershipRecord`を実装する。
4. 予約作成・期限・release・fill確定・保護登録を単一Reducer経由にする。
5. STOP/Exitで解放したGrossだけを、期限・入力・priorityを再確認したCandidateへ再配分する。
6. Rejected candidateを無条件に再採用しないテスト、reservation double-use防止テスト、same-symbol/sideテストを通す。
7. Commit: `feat(research): implement dynamic gross allocator and ownership`

### Task 4: Preemption、partial exit、dynamic lotを実装する

**Files**

- Add `lib/backtest/dd-reduction/dynamic-preemption.ts`
- Add `lib/backtest/dd-reduction/dynamic-sizing.ts`
- Add `tests/dd-reduction-dynamic-preemption.test.ts`
- Add `tests/dd-reduction-dynamic-sizing.test.ts`

**Steps (TDD)**

1. Preemption whole/partial、protected position、same timestamp、duplicate exit、incoming re-admissionのfixtureを作る。
2. 旧BaselineのPreemption 123/125件を「観測件数」として照合できるテスト契約を作るが、一致しない場合は理由を出してFail Closedにする。
3. `eligiblePreemption`、`applyPreemption`、`releasePreemptionGross`、`sizeDynamicEntry`を実装する。
4. victim Exit → Gross release → cooldown/ownership → incoming re-admissionの順を強制する。
5. wallet/equity、fee/funding/slippage、minQty/minNotional、margin reserveをDecision直前に使う。
6. 未保護中間状態、二重Exit、二重Release、被Preemptionの誤所有権をテストする。
7. Commit: `feat(research): add causal preemption and dynamic sizing`

### Task 5: Execution lifecycle、会計、MTM、Reducerを統合する

**Files**

- Add `lib/backtest/dd-reduction/dynamic-replay.ts`
- Add `tests/dd-reduction-dynamic-replay.test.ts`
- Add `tests/dd-reduction-dynamic-accounting.test.ts`

**Steps (TDD)**

1. Entry/Exit/STOP、partial fill、unknown execution、funding、fee、slippage、FX、H1 mark、OOS boundaryのfixtureを作る。
2. settlement PnLとJPY PnLを混在させる入力がFailするテスト、MTMとrealized DDを混同しないテストを追加する。
3. `replayDynamicPortfolio(events, policy, marketData)`を実装し、全状態更新をsingle reducerに通す。
4. `execution-ledger.jsonl`、`reservation-ledger.jsonl`、`preemption-ledger.jsonl`、`allocator-state-snapshots.jsonl`、`mtm-timeline.jsonl`を出力する。
5. `wallet_after`の独立式、accounting reconciliation、Peak/Trough/Recovery、top-5 DD windowを計算する。
6. STOP price/time、gap、same-bar uncertainty、double charge、unknown execution fail-closedを検証する。
7. Commit: `feat(research): integrate dynamic lifecycle accounting and mtm`

### Task 6: OverlayなしDynamic Baselineと最初の差分を実行する

**Files**

- Add `scripts/dd-reduction/run-dynamic.ts`
- Add `scripts/dd-reduction/compare-dynamic-baseline.ts`
- Add `tests/dd-reduction-dynamic-baseline.test.ts`

**Steps (TDD)**

1. 10bps/30bpsの既存Baseline anchorと小さな決定論fixtureを定義する。
2. Dynamic runnerが同一入力で2回同じledger/hashを出すテストを作る。
3. CLIに `--case baseline --cost-bps 10|30 --output <dir>` を実装する。
4. Candidate source coverageを読み、8ロジック候補を時系列でAllocatorへ投入する。
5. 既存BaselineとのCandidate/Entry/Exit/Wallet/MTM/Reject/Preemption差分を最初のeventで停止せず、差分レポートへ保存する。
6. Exact parityなら`FORMAL_PARITY`、不足・順序不明・preemption不一致なら`REBUILT_BASELINE`または`BLOCKED_*`と明示する。
7. Desktop成果物ルートへ大容量JSONLを保存し、Gitには小さなmanifest/reportのみ入れる。
8. Commit: `feat(research): run causal eight-logic dynamic baseline`

### Task 7: V12 SHORT A/B/C、累積、OOS、Holdoutを実行する

**Files**

- Add `scripts/dd-reduction/run-task9-dynamic.ts`
- Add `scripts/dd-reduction/build-task9-dynamic-report.ts`
- Add `tests/dd-reduction-task9-dynamic-cases.test.ts`
- Add `docs/research/results/dd-reduction-initial-adverse-stop-audit-20261020/task9-dynamic-status.json`

**Steps (TDD)**

1. Candidate A/B/C、A+C、B+C、A+B、best qualified combinationのpolicy fixtureを作る。
2. Overlayの二重適用、STOP発動、元Winner/Loser、Cooldown、Gross再配分、Dynamic Lot、Preemptionのテストを追加する。
3. `run-task9-dynamic.ts`で各ケースを10bps/30bpsに分け、同じAllocatorで再生する。
4. IS/OOS選定と独立Holdoutを分離し、OOS PF/Net PnL、Final Equity、DD、取引数、資金稼働率を計算する。
5. 最終累積構成を初期Baselineへ比較し、30bps OOS PF retentionが90%未満ならFAILのまま保存する。
6. 最大DD期間2025-12-05〜2025-12-10をPosition/Logic/Direction/Gross/MTM単位で分解する。
7. 日本語レポートに`ACCEPTED` / `DD_IMPROVED_RESEARCH_ONLY` / `REJECTED`を付け、固定Replayの旧結果と動的結果を分離する。
8. Commit: `feat(research): revalidate task9 overlays on dynamic replay`

### Task 8: CI、Manifest、SHA index、最終検証を固定する

**Files**

- Add/update `.github/workflows/task9-dynamic-integrated-bt.yml`
- Add `scripts/dd-reduction/verify-task9-dynamic-artifacts.ts`
- Add `tests/dd-reduction-dynamic-artifacts.test.ts`
- Update `docs/research/results/.../manifest.json` only with new run provenance
- Add Japanese final report and small comparison JSON under the research result directory

**Steps (TDD)**

1. Manifest/artifact verificationの失敗テストを作る。SHA不一致、欠落ledger、wrong classification、production mutation markerをFailにする。
2. CLI、TypeScript、Python discovery、既存dd reduction tests、dynamic testsをCIに接続する。
3. `npm run dd:reduction:test`を実行し、skipped/todoを成功扱いしない。
4. `npx tsc --noEmit`、`python -m unittest discover -s scripts/dd-reduction -p 'test_*.py' -q`、`git diff --check`を実行する。
5. 10bps/30bps baseline + A/B/C/cumulative + OOS/Holdoutを独立2回実行し、result hashとledger hash一致を確認する。
6. CI artifactにはmanifest、coverage matrix、baseline parity、overlay comparison、OOS/Holdout、SHA index、status reportを含める。ただし巨大なraw ledgerは外部研究出力ルートの場所をmanifestに記録し、Gitへ無制限にコピーしない。
7. Production/VPS/LIVE/HP/Asterへの差分が0であることを最終監査する。
8. Commit: `ci(research): verify task9 dynamic bt artifacts`

## Verification Commands

実装中は各Taskのテストを先に実行し、最終的に次をすべて実行する。

```powershell
npm run dd:reduction:test
npx tsc --noEmit
python -m unittest discover -s scripts/dd-reduction -p 'test_*.py' -q
npx tsx scripts/dd-reduction/run-dynamic.ts --case baseline --cost-bps 10 --verify-determinism
npx tsx scripts/dd-reduction/run-dynamic.ts --case baseline --cost-bps 30 --verify-determinism
npx tsx scripts/dd-reduction/run-task9-dynamic.ts --all-cases --verify-determinism
git diff --check
git status --short --branch
```

最終成果物は、研究出力ルートの実体とGitHub Actions artifactの両方で、Manifest/SHA256を照合する。`FORMAL_PARITY`、`COMPLETE_VERIFIED`、`ACCEPTED`は、実行証拠が揃った場合のみ使用する。

## Execution Order and Commits

Task 1からTask 8を順番に実施する。各Taskはテスト→実装→回帰検証→小さなCommitの順に進め、次Taskへ進む前に当該Taskの成果物と制約を確認する。実装が大きく分離できる箇所だけ、Subagent-driven executionで5.6 Luna Highへ読み取り専用監査または独立テスト作成を委譲する。共有型・Reducer・Ledgerを同時に複数Agentが編集しない。

## Completion Classification

最終報告は各項目を次で分類する。

- `COMPLETE_VERIFIED`: 再現可能なテスト・manifest・hashが全てPASS。
- `COMPLETE_WITH_LIMITATIONS`: 実装と検証は完了したが、一次ソース不足などの制限を明記。
- `BLOCKED_WITH_EVIDENCE`: 必須証拠不足、順序不明、Parity不一致などを証拠付きで記録。
- `NOT_STARTED`: 依存Taskが未完了で未実施。

本計画の完了は、Production LIVE化を意味しない。研究エンジンの動的再現性と損失削減候補の評価だけを完了条件とし、LIVE採用判断は別タスクで行う。
