# STABLE4 6 Runner 一括 Owner 承認設計

## Intent

V12、PENGU、Q102、V52、FET、IDLEの6 Runnerについて、Ownerが同一の本番切替承認を6回繰り返さずに済むよう、現在の6つの固定SHA・plan・scopeを1つの署名対象マニフェストへ束ねる。HYPEはH48_TIME_ONLYという別ポリシーのため、現行のHYPE専用承認・証明書・permit経路を維持する。

## Goals

- Owner承認とGitHub Environment承認を、6 Runnerにつき1回にする。
- 一括承認の中身を不変マニフェスト（Runner、source SHA、plan SHA、scope、operation、systemd unit）へ固定する。
- Rootでマニフェストを再計算・再照合し、各Runnerには従来どおりRunner固有permitを1件ずつ発行する。
- 1 RunnerでもSHA、plan、署名、GLOBAL HOLD、Shared Risk、Margin、flat-account、heartbeat/systemd、immutable releaseの検査に失敗したら全体をfail-closedし、すでに作成したpermit/drop-inは検証済みrollbackで除去する。
- GLOBAL HOLD、Shared Risk 7.5%、Gross、Margin Guard、保護STOP、Kill Switch、重複注文防止を変更・解除しない。

## Non-goals / Anti-goals

- HYPEを束ね承認へ含めない。
- `FULL_PROJECT` の広域承認をそのまま注文許可として再利用しない。
- GLOBAL HOLDの手動編集・clear、署名検証の迂回、テスト注文・取消・強制決済を行わない。
- 売買ロジック、候補SHA、Runnerの経済設定を変更しない。

## Constraints

- 新しい承認 operation は `STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE`、scope は `STABLE4_SCOPED_RUNNERS` とする。
- 承認レコードの `targetSha` は一括経路を実装したimmutable master commitへ固定し、`planSha256` は正規化された6 Runnerマニフェスト全体のSHA-256とする。
- HPの正式承認、メールOTP、署名済みtoken、GitHub Actionsの `disdex-production` Environmentレビューを必須とする。
- 一括Root処理は共有の排他ロック下で行い、全Runnerをpreflightしてから変更を開始する。変更後もGLOBAL HOLDのbytes/digestが変わっていないことを確認する。

## Approaches considered

1. **6 Runner束ね承認＋6個の個別permit（採用）**：利便性と既存のRunner境界を両立する。承認は1回だが、実行時はRunnerごとに固定SHA・plan・scope・unitを検査する。
2. 既存 `ALL_RUNNERS_ORDER_ENABLE` (`FULL_PROJECT`) を流用：実装は短いが、HYPEや将来Runnerを含み得るため、今回の6 Runner限定条件を承認レベルで表現できない。
3. HPで6件を一括表示し、6件の承認を自動発行：画面操作は減るが、Owner承認が6件残り、要求を満たさない。

## Design

### Shared bundle identity

`STABLE4_RUNNER_BUNDLE_MANIFEST_V1` を正規化JSONとして定義し、6 Runnerを辞書順で収録する。各entryは `runner`、`sourceSha`、`planSha256`、`scope`、`operation`、`unitTemplate` を持つ。正規化JSONのSHA-256をOwner approvalの `planSha256` として使用し、HP issue-comment要求は `STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE SHA=<bundle-source-sha> PLAN=<manifest-sha256>` の1行とする。

### HP and approval contract

`lib/deploy-approval-token.ts` にoperation/scope/policyを追加し、通常の `publish` / `redeem` の署名・OTP・期限・同一identity再利用ルールをそのまま使用する。HP画面は一括operationのラベル、bundle source SHA、manifest SHA、注文有効を表示する。HYPEのoperation/policyは変更しない。

### GitHub Actions

HP request workflowはbundle要求の文法を受理し、source SHAとmanifest SHAを検証して一つのpending approvalを発行する。新しいbundle切替workflowはmaster限定・Owner限定・`disdex-production` Environment必須とし、承認tokenを一度redeemしてRootへ渡す。Root実行後は6件のreceipt、各RunnerのPID/SHA、GLOBAL HOLD active、全mutation counter 0を確認する。

### Root transaction

Root bundle helperは、(1)署名・approval record・bundle manifestの一致、(2)6 Runner全件のimmutable release/service/health/venue read-only preflight、(3)全件成功後の個別permit/drop-in導入、(4)各Runner再起動とoverlay hash確認、(5)HOLD digest不変確認を行う。途中失敗時は同一transactionで作成したものだけをrollbackし、既存Runner/HYPEのファイルを触らない。

### Tests and evidence

- bundle manifestの順序・SHA計算・Runner集合・HYPE除外をユニットテストする。
- bundle approvalのoperation/scope/ordersEnabled/target/plan固定をテストする。
- workflow contractでmaster/Owner/Environment、署名redeem、6 Runner全件、`TRADING_MUTATIONS=0`、GLOBAL HOLD維持を検査する。
- Root bundle transactionの全件成功、1件失敗時rollback、別Runner非干渉、HYPE拒否、GLOBAL HOLD変更拒否を非本番で検証する。
- 実本番では、承認前後の署名付きGET、PID/systemd/SHA、permit/receipt、GLOBAL HOLD、Shared Risk、Margin、注文・取消・建玉0件を証跡化する。
