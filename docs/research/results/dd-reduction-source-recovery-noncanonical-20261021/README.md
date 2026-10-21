# Task 9 source recovery adapter（非canonical）

この成果物は、Task 9 の `BLOCKED_INCOMPLETE_SOURCE_COVERAGE` に対し、保存済みの正式研究 `candidate-decisions.jsonl` から安全に読み取れる事実を再整理したものです。これは経済的な動的BT、正式parity、Production認証ではありません。

## 結論

- 10bps / 30bps ともに観測行は 3,185 行。
- 10bps は `ACCEPTED_MODELED_ENTRY=1,310`、`REJECTED_PORTFOLIO=1,859`、`EXCLUDED_PREALLOCATION=16`。
- 30bps は `ACCEPTED_MODELED_ENTRY=1,307`、`REJECTED_PORTFOLIO=1,862`、`EXCLUDED_PREALLOCATION=16`。
- 8ロジックの候補行は存在し、strategyラベルの一次証拠は得られる。
- しかし、全行で allocator の `entry_valid_until`、`priority/tie-break`、`asset_class` が保存されていない。
- Rejected行では、dynamic lotに必要な数量・entry equity・lot/min-notional入力も保存されていない。
- したがって replay-ready 行は 0、fail-closed 行は 3,185。`formalParity=false`、`economicBacktest=false` を維持する。

## 実装

- Adapter: `scripts/dd-reduction/rebuild-noncanonical-baseline.ts`
- Tests: `tests/dd-reduction-source-recovery.test.ts`
- 各行の各フィールドを `ORIGINAL_EVIDENCE` / `CAUSALLY_REGENERATED` / `MISSING` / `UNVERIFIABLE` に分類する。
- 不足値を gross/price/timestamp/rank/結果から推定しない。
- 動的allocatorや経済BTへ渡す前に、必須フィールド不足をfail-closedにする。

## 外部再現出力

巨大な再構成JSONLはGit worktreeへ入れず、次の保存先に生成した。

`C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-21_task9_source_recovery_noncanonical\`

- `10bps/source-recovery-report.json`
- `10bps/source-recovery-manifest.json`
- `10bps/reconstructed-candidate-ledger.jsonl`
- `30bps/source-recovery-report.json`
- `30bps/source-recovery-manifest.json`
- `30bps/reconstructed-candidate-ledger.jsonl`

## 入力SHA256

| Scenario | Candidate ledger SHA256 | Bytes | Rows | Replay-ready |
| --- | --- | ---: | ---: | ---: |
| 10bps | `eac68287e6f4e644c588b8689ce1dc67226abccea21bea09e29c0aeda0c1a3e2` | 2,572,924 | 3,185 | 0 |
| 30bps | `77087b72c7e9279d001b58e351d7e932a9b3dabcb58d9ccbf7f1a0fd28a7c5d1` | 2,571,687 | 3,185 | 0 |

Adapter manifest hash:

- 10bps: `1c3fc802cf2f2a8bc4f7b620a0bf229b4d0b22fa3633584278bde11e5569261b`
- 30bps: `3abe3e54cd180b4ead336c203569f4d4526b9837155e57809136735a05a73462`

## 残るBLOCKED理由

`BLOCKED_INCOMPLETE_SOURCE_COVERAGE`: 既存候補台帳からは、dynamic allocatorの有効期限・priority/tie-break・asset classと、Rejected候補のdynamic sizing入力を因果的に復元できない。これを補うには当時のcandidate生成イベント、allocator state/event ledger、policy/config、lot/min-notional、market-data manifestが必要であり、結果からの逆算は禁止する。
