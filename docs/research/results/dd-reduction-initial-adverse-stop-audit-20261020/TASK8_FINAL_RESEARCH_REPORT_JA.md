# Task 8 最終研究検証報告

## 結論

Task 8 の成果物検証、CI 接続、研究専用変更監査を追加した。Task 6/7 の既存結果と固定 replay の成果物は書き換えていない。

動的 baseline と Task 9 の全ケースの最終動的ステータスは、次のとおり維持する。

`BLOCKED_INCOMPLETE_SOURCE_COVERAGE`

10bps/30bps ともに観測 3,185 行、正規化 0 行、fail-closed 3,185 行、replayable 0 行である。欠損している canonical `validity`、`entry_price`、完全な lifecycle/allocator evidence を推測・合成していない。したがって、0 trade の出力は診断値であり、BT の経済指標ではない。

## 分類

### COMPLETE_VERIFIED

- Task 1–5 の engine contract、single reducer、allocator、preemption、execution/accounting/MTM の既存検証。
- Task 6 overlay-free runner、10/30bps deterministic fail-closed hash、manifest/report。
- Task 7 V12 SHORT の BASELINE/A/B/C、累積ケース、OOS/Holdout 契約、16 ケースの fail-closed classification。
- Task 8 artifact verifier、失敗テスト、実行される CI job、研究専用 mutation audit。

### COMPLETE_WITH_LIMITATIONS

- 8 logic の source coverage inventory と 3,185 行の観測件数は manifest で固定した。
- Task 6 の historical scalar anchor comparison と 10/30bps repeat hash の一致を確認した。
- 固定 accepted-ledger replay の既存数値・report・status は比較対象として保持した。ただし、これは dynamic candidate replay ではない。

### BLOCKED_WITH_EVIDENCE

- Dynamic economic baseline、overlay metrics、formal parity は source coverage 不足のため blocked である。
- Task 7 の 16 ケースはすべて `BLOCKED_INCOMPLETE_SOURCE_COVERAGE`、`economic_acceptance_eligible=false` である。
- `FORMAL_PARITY`、`REBUILT_BASELINE`、economic acceptance、Production-equivalent parity は主張しない。

### NOT_STARTED

- Formal overlay acceptance と Production/LIVE 採用は本研究タスクの対象外であり、実施していない。
- Production/VPS/LIVE/HP/Aster/operator/Shared Risk/Margin Guard/Kill Switch の変更は行っていない。

## 成果物と再現性

- compact artifact: `task8-comparison-status.json`、`task8-research-only-audit.json`
- verifier: `scripts/dd-reduction/verify-task9-dynamic-artifacts.ts`
- CI: `.github/workflows/task9-dynamic-integrated-bt.yml`
- raw ledger: `C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\` 配下を参照し、Git へコピーしていない。

最終検証結果は、DD reduction suite 18/18 files pass（failed/skipped/todo は各 0）、TypeScript exit 0、Python discovery 24/24 pass、targeted ESLint exit 0、`git diff --check` exit 0、外部 Task 6 ledger/source SHA verifier PASS である。CI workflow には skip/no-jobs ではない実 job を定義した。

Task 6/7 の source SHA、result hash、ledger hash、classification は既存 manifest/status の値を正本として扱う。結果を通すために raw ledger、fixed replay、dynamic report を改変していない。

## 残る証拠 blocker

完全な causal candidate event stream（Rejected 候補を含む）、timestamp ごとの allocator rejection/rank/tie-break、pending reservation、dynamic lot、preemption、partial/unknown execution、canonical mark/lifecycle source が必要である。これらが揃うまで、dynamic economic acceptance と formal parity は判定不能のままにする。
