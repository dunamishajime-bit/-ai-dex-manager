# HP / Runner Strategy Sync Design

## Goal
DISTerminalのHP・Runner・observabilityを、検証済み構成 `V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_1.0_1SLOT` に一致させる。V12 Top2補助候補ランキングを実Runnerの確定足評価から取得し、取得失敗と自然な候補0件を区別して表示する。

## Safety boundaries
- V12は1建玉最大1.00x、最大2建玉、合計最大1.50x。
- Q102は最大1.00x、最大1スロット。
- Shared Crypto Grossは最大2.00x、Total Grossは最大2.50x。
- Shared Crypto Daily Lossは5%。
- PENGUはDual LS V2 / Short V20を維持し、Recovery V8は通常シグナル不成立時だけ補助Longとして評価する。
- V52 Top2の既存signal/gateは変更しない。
- Fail Closed、Kill Switch、ownership、reconciliation、account lockを緩めない。
- synthetic/test注文、強制flatten、Kill Switch解除は行わない。

## V12 Top2 runtime
過去のTop2実装 `053828ce` と後続安全修正 `c2bb41f6` / `ed243cd7` を参照し、現在lineageへ必要部分だけ移植する。旧ブランチを丸ごとmergeしない。

Runner stateは `activePositions` 最大2件を正本とし、互換用 `active` は先頭要素を示す。既存1-slot stateは安全に読み替え、異常な複数建玉・過剰grossはFail Closedにする。

V12 entryは `buildV12Signals(..., maximumPositions)` でRank1/Rank2を生成し、Rank2は既存V12 grossと共有grossの残余容量だけを使う。各position 1.00xとaggregate 1.50xの両方を強制する。

## Decision snapshot
売買stateとは別にread-only `v12-decision-snapshot/v1` をatomic保存する。保存先は `V12_DECISION_SNAPSHOT_PATH`、production標準は `/var/lib/disdex/v12-x1-all/decision-snapshot.json`。
Snapshotには `referenceTs`、`generatedAt`、`btcRegime`、`selectionConfirmed`、`selectedSymbols`、および全候補の `rank/symbol/side/score/momentum/volumeRatio/volatility/atr` を持たせる。候補が0件でも空配列を正常保存し、ファイル欠落・JSON不正・staleとは区別する。

HPはsnapshotをread-onlyで読むだけで、snapshotを取引判断の入力にしない。Runnerの売買判断と同じ評価結果からsnapshotを生成するため、UIだけの再計算は行わない。

## HP / observability
`DIST_TERMINAL_LIVE_CONFIG.strategyLabel` を正式構成名へ更新し、共通Banner、home、positions、performance、decision-status、runtime cardsで同じ名称・上限を使う。Q102は全表示で `1.00x / 1-slot` とする。

V12候補表示は次の3状態を分ける。
1. snapshot正常・候補あり: Rank順に表示。
2. snapshot正常・候補0件: 「この確定2時間足では候補なし」と表示。
3. snapshot未接続/不正/stale: 「未取得 / 要確認」と表示し、理由を出す。

Runner statusではV12 `activePositions` を最大2件表示し、`active`だけに依存しない。Q102はruntime heartbeat/stateの実測capと設定capが不一致なら要確認にする。

## Full-page audit
対象は `/`、`/decision-status`、`/positions`、`/performance`、`/history`、`/wallets`、`/settings`、`/admin`、認証ページ、および共通layout/sidebar/banner。旧 `Q102 0.5x`、旧PENGU表記、旧1-slot V12説明を静的scanする。

## Deployment wiring
production env/exampleとsystemd/UI serviceに `V12_DECISION_SNAPSHOT_PATH` を追加し、snapshot directoryを既存V12 writable path内に置く。秘密情報はcommitしない。

反映はimmutable SHAで行い、Aster read-only reconciliation、旧daemon重複、ownership、Kill Switch、shared-risk、service stateを確認する。安全Gate不合格なら再起動・LIVE writeを進めない。

## Acceptance
- V12 Top2 runner regressionがmax2 / per-position1.0 / aggregate1.5を証明。
- snapshot testが候補あり/0件/破損を区別。
- Q102 config/observability/UIが1.0x/1-slotで一致。
- PENGU V20+Recovery V8、V52 Top2、shared capsを変更しない。
- 全ページ旧表記scan、targeted tests、typecheck/buildがPASS。
- Push後にremote SHA一致を確認する。