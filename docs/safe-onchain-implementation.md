# Safe / SCW オンチェーン実装メモ

## 目的

disdex では、資産保管先を Safe（既製SCW）に置き、VPS 上の bot には最小権限だけを与えます。

- 資産の最終権限は Ledger に置く
- 出金はホワイトリスト宛てのみ
- bot は売買だけを担当
- pause で即停止できる

## 想定ロール

- Owner: Ledger
- Trader: VPS bot
- Guardian: 任意
- Pauser: 任意

## 実装対象

- `contracts/DisDexSafeModule.sol`
- `scripts/deploy-safe-module.ts`
- `app/scw/page.tsx`
- `app/wallets/page.tsx`

## MVP の最小構成

1. Safe を資産保管先にする
2. Owner を Ledger にする
3. Trader を VPS bot にする
4. 出金先を whitelist に限定する
5. trade は allowlist Router / Token / selector のみ許可する
6. per-trade limit / daily limit を入れる
7. pause / emergencyWithdraw を使えるようにする

## デプロイ手順

1. `.env.local` に以下を設定する
   - `RPC_URL_BSC`
   - `DEPLOYER_PRIVATE_KEY`
   - `SAFE_ADDRESS`
   - `SAFE_OWNER_ADDRESS`
   - `SAFE_TRADER_ADDRESS`
   - `SAFE_GUARDIAN_ADDRESS`（任意）
2. コントラクトをデプロイする

```bash
npm run scw:deploy
```

3. 生成された module アドレスを Safe 側で有効化する
4. Wallets 画面に module 情報を保存する

## コントラクトで守るもの

- 出金先は whitelist のみ
- 出金時は Owner 署名必須
- whitelist 変更は timelock 可能
- Trader は許可済み Router / Token / selector のみ
- 1 回あたり上限と 1 日あたり上限を入れる
- pause 中は trade を止める

## 監査観点

- withdraw の署名検証
- replay 攻撃対策
- whitelist 変更の遅延反映
- approve / permit / setApprovalForAll の抜け道
- execute / delegatecall 相当の危険性
- pause / emergencyWithdraw の権限

## 運用

- deploy / build / restart はまとめて 1 回で行う
- 変更は小さく区切って確認する
- 失敗時は連打せず原因を確認する

