# 全Runner LIVE化を一つの依頼として承認する契約（2026-11-01）

## 原則

本人がHPのメールOTPで承認する対象は **「全Runner LIVE復旧」一件**であり、V52・IDLE・V4・HYPE・Q102・PENGU・FETなどの個別修正ではない。旧方式の `IDLE_FLAT_STALE_REPAIR` 承認を、本人が承認していない他RunnerのLIVE復旧に昇格させることはできない。**初回だけ、新しい全Runner復旧依頼としてHP本人承認が必要**。以降は同一依頼の工程や失敗後の再試行でメール再認証しない。

## 親承認と子工程

- 親操作 `ALL_RUNNERS_LIVE_RESTORE`、Scope `FULL_PROJECT`、ユーザー承認日時から24時間、最多30工程実行。親が期限切れ・完了・停止状態なら新しい子工程を発行しない。
- 親に、承認時に存在する許可工程・各工程のRunner/SHA/注文権限・安全条件を含む固定計画SHA256を結びつける。修復のバグ修正やGitHubの新しいCI成功コミットは、工程と許可権限が変わらなければ同じ親依頼に属する。範囲拡大、戦略ロジックの独立変更、初期計画外の取引/注文/STOP変更は再承認を要する。
- 子工程をGitHub Actionsが起動するたび、保護されたHP Bridgeが `task_id + step + sha + plan + run_id` を照合し、毎回 **別nonce・最大300秒のEd25519署名証明** を発行する。同じ署名証明の無制限リプレイは許可しない。
- HPの台帳で子工程の同時実行を排除。成功・失敗をGitHub Actionsから受け取り、失敗時は親承認が有効なら再試行可能。中断で結果が不明になったら自動再実行せず、取引所・GitHubの証拠を照合してから処理する。
- GitHubの `disdex-production` 保護環境レビューは存続し、既に確認されたオーナーのGitHubアカウントで対応する。メールOTPを各工程で求めないことと、安全ゲートの解除は別。

## 常時守る条件

Aster署名付きGET、既存建玉とreduce-only保護STOP、重複保有禁止、API/Rate予算、Shared Risk、Margin/Gross、正しい実行SHAとRollBack、Runner排他、Kill Switchの理由検証を各工程で実施。**テスト発注、根拠のないSTOP・注文取消、Fail-Closedの強制解除は承認しない。**

## 実装の接続

`/api/system/deploy-approval` に `publish_task`・`claim_task_step`・`finish_task_step` を追加し、HPの本人承認UIへ親依頼を表示する。既存のIDLE修復ActionとIDLE/V52専用HOLD復旧Actionは `task_id` で同じ親に属する。ほかのRunnerのLIVE復旧Actionも、固有の取引所・保護証跡を満たしたうえで、この親タスクの対象ステップに接続していく。未接続の工程を「LIVE済み」と表示しない。

現行HPとRuntimeに自動的に適用されるわけではない。GitHub CI・レビュー・HP正式デプロイ・本番の有効性チェック後に適用する。
