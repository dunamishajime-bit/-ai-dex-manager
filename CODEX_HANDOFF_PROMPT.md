# Codex execution prompt — V52 completion + PENGU_DUAL_LS_V2_FINAL production activation

以下をこのまま実行指示として扱ってください。

---

対象Repositoryは `dunamishajime-bit/-ai-dex-manager` です。

まずGitHubをfetchし、次の2ファイルを**最初から最後まで読んでから**作業してください。

1. `handoff/v52-pengu-v2-live-completion-20260811:ops/CODEX_V52_PENGU_V2_LIVE_COMPLETION_RUNBOOK.md`
2. `handoff/v52-pengu-v2-live-completion-20260811:research/PENGU_DUAL_LS_V2_FINAL_FREEZE.md`

現在の作業Branchは `codex/pengu-runtime-safety-fix` です。ユーザー報告時点のHEADは `a022b68ff4426c59b922fc78cb61e9225e020d7b` (`Fix V52 market-hour worker lifecycle`) です。ただし作業開始時にremote HEADを確認し、これより進んでいる場合は**最新remote HEADから続けてください。a022へresetしないでください。**

この作業は途中からの継続です。ゼロから作り直さず、既存のV52修正・公式installer・preflight・promotion・approval/parity・Aster V3 client・durable state/reconciliation・kill-switchの仕組みを優先して使用してください。

## 現在の正式状態

前回の候補SHA `a022b68ff4426c59b922fc78cb61e9225e020d7b` はVPSにimmutable release作成・公式installer実行・helper/systemd unit SHA一致・Candidate Preflight PASS・Aster認証PASSまで完了しています。Managed Positions=0、Open Orders=0、注文/取消/建玉変更=0件でした。

しかしLIVE activationは `DISDEX_V96_OPERATOR_OVERRIDE_AUDIT_SYNC_FAILED` でFail Closedしました。Crypto durable stateに未解決の `pending=true` が残っており、AsterのOpen Orders=0とローカルstateが不一致だからです。手動編集・推測解除はしていません。

現在はtransaction rollback済みで、`current=280d2c73f484a82d634450d66aca75603f8e77ff`、service=`inactive/dead`、MainPID=0、Kill Switch=active、新SHA未promotion、LIVE restart未実施です。

## 必須作業

Runbookの順番を厳守して、以下を最後まで完了してください。

1. `codex/pengu-runtime-safety-fix` のV52 market-hour worker lifecycle修正を仕上げる。現在残っているV52関連のtest/typecheck/preflight/runtime errorをすべて確認し、問題を除外・無視せず修正する。
2. Crypto durable stateの未解決 `pending=true` の正体を特定する。order ID/client order ID/symbol/side/time/state等を読み取り、Aster V3の正式なread-only外部証跡（open ordersだけでなく、既存clientで利用可能なorder status/history/fills/trades/position evidence）と照合する。
3. `pending=true` をJSON直接編集、削除、強制false化しない。外部証拠がterminal stateを証明した場合のみ、既存の正式reconciliation contractでstateを更新する。正式経路が不足している場合は、外部証拠を必須にする狭いreconciliation機能を実装・testして使う。汎用force-clear機能は禁止。
4. local stateとAster stateが整合した後にだけ、正式なOperator Override Audit Syncを再実行しPASSさせる。Gate自体を無効化・弱体化してはいけない。
5. `PENGU_DUAL_LS_V2_FINAL` を `research/PENGU_DUAL_LS_V2_FINAL_FREEZE.md` の固定条件どおりproduction実装する。パラメータは変更しない。V1の定数だけを書き換えるのではなくV2として明確なstrategy ID/state/lock/env/telemetry/testを持たせる。
6. V1とV2を同時にLIVE注文可能状態にしない。移行時はPENGU managed position/pending/open orderが0であることを正式確認し、V1 executionを停止してからV2 executionを有効化する。V1 stateはrollback/audit用に保持し、V2専用stateへstale signal/pendingを持ち込まない。
7. Runbook記載のSignal/Exit/Sizing/State/Idempotency/Combined runtime testsを追加・実行する。V52の修正testもすべてgreenのままにする。
8. frozen researchとproduction実装のtrade-ledger parityを確認する。差があれば最初に違うtradeを特定して実装を直す。Aggregateを合わせる目的でV2パラメータを変更しない。
9. 全test/parityがPASSしたコードをGitHubへpushし、最終40桁SHAを `FINAL_SHA` として固定する。以後、SHAを変えた場合はSHA依存Gateをすべて新SHAでやり直す。
10. `FINAL_SHA` のimmutable releaseを公式手順でVPSに作成し、公式installer、release marker/tree/helper/systemd unitのSHA一致を確認する。
11. 同一 `FINAL_SHA` でAster read-only auth、pending reconciliation、Operator Override Audit Sync、managed positions/open orders、V2 migration readiness、approval/parity、Candidate PreflightをすべてPASSさせる。
12. すべてPASSした場合のみofficial promotionを実行する。`current`を手動symlink変更しない。
13. promotion後、combined serviceを**1回だけ**正式restart/startする。V1とV2のPENGU live workerを二重起動しない。
14. restart後にsystemd active/running、MainPID非0、runtime SHA=`FINAL_SHA`、V52健康、Crypto/V96健康、PENGU=`PENGU_DUAL_LS_V2_FINAL`、V1 live workerなし、V2専用state/lock、Aster auth、positions/open orders、duplicate orderなし、unexpected mutationなし、logsにcrash loop/SHA mismatch/reconciliation errorなしを確認する。

## 絶対禁止

- `pending=true` の手動削除/false化
- external evidenceなしの推測reconciliation
- Gateをコメントアウト・常時true・catchして無視する修正
- approval/parity/current/kill-switchを手編集してactivation成功扱いにすること
- V2のパラメータ再最適化
- V1/V2の同時LIVE発注
- unmanaged position takeover
- blind retry/restart連打
- Preflight/approvalと異なるSHAのpromotion
- エラーが残ったまま「ほぼ成功」と報告すること

## Fail Closedルール

途中で正式Gateが1つでもFAILしたら、そこで停止してください。最初のブロッカー、証拠、current SHA、service state、MainPID、kill switch、positions/open orders、注文/取消/建玉変更件数を報告してください。次のGateへ無理に進めないでください。

成功時だけ `LIVE_ACTIVATION_SUCCESS` としてください。RunbookのDefinition of DONEを1項目でも満たさない場合は `LIVE_ACTIVATION_FAIL_CLOSED` です。

最終報告はRunbook §11のフォーマットで、Branch、FINAL_SHA、V52、reconciliation、Operator Override、V2 parity、VPS release/current/service/MainPID、Aster positions/open orders、PENGU V2 state、kill switch、unexpected mutationの実数を出してください。

---

このhandoff Branchは要件・安全契約の参照用です。Codexの作業Branchがすでに進んでいる場合、handoff Branchを作業Branchへ強制reset/mergeして既存作業を消さず、必要な文書/仕様を参照またはcherry-pickして最新 `codex/pengu-runtime-safety-fix` の上で作業を継続してください。
