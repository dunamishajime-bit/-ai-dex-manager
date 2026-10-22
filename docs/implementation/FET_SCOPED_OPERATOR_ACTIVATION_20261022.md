# FET BRK48 scoped operator activation

日付: 2026-10-22
対象リポジトリ: `dunamishajime-bit/-ai-dex-manager`
対象ブランチ: `codex/fet-trailing-stop-production-20261022`

## 目的と適用範囲

この変更は、FET BRK48 Residual runnerだけに、研究で選定した
`FET_TRAIL_8P_GIVEBACK_4P` を本番実行可能な形で結び付けるためのものです。
共通の全Runner用operator artifactを更新せず、共通の`current` symlinkも変更しません。

対象runnerは `FET_BRK48_RESIDUAL` のみです。PENGU、Q102、V52、HYPE、Idle、V12、
Shared Risk、Margin Guard、Kill Switch、account lock、pending exposure、Aster共有rate budgetの
経路は既存の共通実装・共通状態を使用し、今回のFET切替で意味を変更しません。

## SHAとrelease

- 既存FET候補release: `26a32d2b4303d0614d665b12efc63294fe5cb2e0`
- 既存共通current/release（切替前の監査対象）: `4cbf51947a3c336df884615f2491a4316a62ba49`
- 今回の最終immutable release SHA: Push後に確定したSHAをdeployment evidenceへ記録する
- rollback: `26a32d2b4303d0614d665b12efc63294fe5cb2e0` または、切替前read-only監査で記録したFET unit SHA

FET unitの実効SHAは共通currentとは独立して、FET scoped runtime scope fileで拘束します。
release marker、systemd WorkingDirectory、FET health/watchdog期待値、FET operator artifactの
SHAが一致しない場合はfail closedにします。

## scoped operator artifact

FET専用artifactの想定パスは次のとおりです。

`/var/lib/disdex/shared/operator-activation/fet-brk48.json`

artifactは既存の`disdex-live-operator-activation/v1`契約に従い、少なくとも次を満たします。

- root:root所有
- mode 0600
- `ordersEnabled: true`
- `approvedSha`はFETのimmutable release SHAと完全一致
- `approvedRunners`は`["FET_BRK48_RESIDUAL"]`のみ
- `target`は対象releaseの`docs/production/current-implementation-readiness.json`のtargetと一致
- operator acknowledgementが存在

現在の対象releaseでのtargetは`DD1296_FINAL_ALLIN_10BPS`です。共通artifact（`current.json`）の
SHAや承認Runner一覧へ、FET切替のための追記は行いません。
FET artifactを別Runnerのunitへ渡しても、runner-scoped gateが拒否することをテストで固定します。

## shared safety paths

FET unitは以下を既存の共有パスのまま使用します。

- `/var/lib/disdex/shared/account-order.lock`
- `/var/lib/disdex/shared/crypto-daily-risk.json`
- shared pending/reservation registry
- Aster shared rate budget / account lock
- Margin Guard / Shared Risk / Kill Switch

scoped artifactはFETのoperator authorizationだけを分離するものであり、これらの安全機構を
独立化・無効化・緩和するものではありません。

## deployment procedure

1. GitHub remote SHA、FET release marker、共通current symlink、既存FET unit、Aster建玉・注文・
   reduce-only保護注文、FET state、shared lock/risk/margin/rate状態をread-onlyで保存する。
2. 新releaseをimmutable pathへstageする。`current` symlinkは変更しない。
3. scoped artifactをroot-owned 0600で作成し、exact-SHA gateを実行する。
4. FET stateがflat/pendingなしであること、または公式migrationが状態を保持することを確認する。
5. 旧FET unitだけを安全にretireし、新FET unitだけを起動する。他Runnerは再起動しない。
6. FETのPID、WorkingDirectory、runtime SHA、NRestarts、operator gate、shared safety、Aster
   read-backを再監査する。
7. 注文・取消・建玉変更カウンタが0であることを確認する。自然シグナル未発生の期間はvenue
   lifecycle未観測として記録し、実約定認証済みとは表現しない。

## rollback

問題が出た場合は、まずAsterの建玉とreduce-only保護注文をread-onlyで再確認します。その後、
FET unitだけを旧immutable releaseへ戻し、FET scoped artifactとscope fileを旧SHAへ戻します。
共通current、共通artifact、他Runnerは変更しません。保護注文を削除したり、既存建玉を手動決済
したりして切替を成立させません。

## evidence status

研究BTの結果は`docs/research/results/fet-trailing-stop-production-20261022/manifest.json`に
保存されています。研究結果は実venue lifecycle認証の代替ではありません。実取引所でFETの
trailing STOP fillが観測されていない場合は、その事実を明示したまま、FET-scoped LIVE activation
とvenue lifecycle certificationを分離して報告します。
