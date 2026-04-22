# Safe 緊急対応 Runbook

## 目的

異常時に、資産流出を止めて安全に復旧するための手順です。

## 発火条件

- bot が意図しない trade を出した
- whitelist に無い出金が疑われる
- Ledger 権限や trader 権限の変更が不審
- 予期しない router / token が使われた
- VPS の侵害が疑われる

## すぐやること

1. `pause` を実行する
2. bot を止める
3. 直近のイベントログを確認する
4. whitelist / router / token / selector の設定を見直す
5. 必要なら `emergencyWithdraw` で whitelist 宛てへ退避する

## 連絡順

1. 管理者へ通知
2. Ledger 所有者へ通知
3. 必要なら利用者へ周知

## 再開条件

- 原因が把握できた
- 必要な allowlist と limit が見直せた
- Ledger で再開を承認できた

## 復旧後の確認

- `withdraw` が whitelist 限定のままか
- `trade` が allowlist のみか
- `pause / unpause` の権限が想定通りか
- `perTradeLimit` と `dailyLimit` が妥当か

## 監視対象

- `WithdrawExecuted`
- `WithdrawalWhitelistScheduled`
- `WithdrawalWhitelistUpdated`
- `TraderUpdated`
- `RouterUpdated`
- `TokenUpdated`
- `SelectorUpdated`
- `PerTradeLimitUpdated`
- `DailyLimitUpdated`
- `Paused`
- `Unpaused`
- `OwnershipTransferred`

## 補足

- VPS は実行だけにして、最終権限は Ledger に置く
- 変更はまとめて行い、再起動を連打しない
- 異常時はまず止める。復旧はその後に行う

