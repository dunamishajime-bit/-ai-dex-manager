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
- 動的allocator契約の `VALID`、usable provenance、candidate ID一意性、LONG/SHORT、有限正数ドメイン、decision/strategy全件検証を満たさない場合はfail-closedにする。
- `replayReady` は行単位のフィールドだけでなく、全8戦略・許可decision・重複IDなしの台帳検証も満たす場合だけ真になる。
- `formalParity=false`、`economicBacktest=false`、実台帳の `replayReady=0` は維持する。

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

## Hashの定義

- `canonicalOutputSha256`: 表示用の絶対 `sourcePath` を除外した再構成台帳の論理出力SHA。別パスの同一bytesで一致する。
- `displayOutputSha256`: `sourcePath`を含む表示用JSONLのSHA。表示用パスが違えば変わり得る。
- `reportPayloadHash`: `sourcePath`と表示用出力SHAを除外し、キー順を正規化したレポートpayloadのSHA。
- `manifestFileSha256`: 実際に書き出した `source-recovery-manifest.json` のファイルSHA。自己参照を避けるため `source-recovery-integrity.json` とレポートへ記録する。

実測hash（2026-10-21再実行）:

| Scenario | Canonical output | Report payload | Manifest file |
| --- | --- | --- | --- |
| 10bps | `b3e1a7d349689e0482e729da770c997e9545d8b908921894b84b7add0c8657a0` | `695af7f4efe8c70e246e67fd721b49105be0bdd93bce862f5cb8565d14e91592` | `bebb5b6e17d61686cd540277d49a2d491364168585dc43dca2b0357545bfb3fb` |
| 30bps | `889aaff709c502539808ef445dc78b3554e2d774ae81d1c27184ade50d5909ae` | `bde8205cb85f7b580f55f170810960606c3873a226151efb88fcd859ec30f275` | `0c8c502c1850e46be761783d056d3e8d012d45a0dff59b1df26edcb6680bfe57` |

同一bytesを別の絶対パスから処理しても、canonical output/report payloadは一致し、表示用JSONL SHAだけが表示パスの差で変わることを回帰テストで確認する。

## 残るBLOCKED理由

`BLOCKED_INCOMPLETE_SOURCE_COVERAGE`: 既存候補台帳からは、dynamic allocatorの有効期限・priority/tie-break・asset classと、Rejected候補のdynamic sizing入力を因果的に復元できない。これを補うには当時のcandidate生成イベント、allocator state/event ledger、policy/config、lot/min-notional、market-data manifestが必要であり、結果からの逆算は禁止する。
