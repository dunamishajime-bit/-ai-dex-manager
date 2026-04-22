# Safe 前提の SCW MVP 計画

## 目的

- 資産は既製 SCW の Safe で保管する
- 最上位権限は Ledger で管理する
- VPS bot には売買に必要な最小権限だけを与える
- 出金と重要設定変更は Ledger 署名必須にする

## 最初にやること

1. Owner / Trader の役割を確定する
2. 出金ルールを確定する
3. whitelist の方針を確定する
4. Router / Token / selector の allowlist を確定する
5. 取引上限と日次上限を確定する
6. pause / unpause を用意する

## MVP で必要なもの

- Safe の採用方針
- Ledger を Owner にする
- VPS bot を Trader にする
- ホワイトアドレス以外へ出金しない
- 出金時は Owner 署名を必須にする
- Trader は売買以外を触れない
- 異常時は pause で止める

## 次に足すもの

- whitelist 変更のタイムロック
- approve 系の抜け道対策
- 監視イベントと Telegram 通知

## 後から検討するもの

- Guardian / Upgrader の分離
- Account Abstraction / session key
- 署名セッションの細分化

## 安全の原則

- VPS にマスター秘密鍵を置かない
- Trader に汎用 execute を与えない
- Router / Token / selector は allowlist に限定する
- 出金と重要変更は Ledger 署名なしでは通らない

## 進め方

1. Safe を選定する
2. Ledger / Trader の責務を固定する
3. whitelist と出金ルールを決める
4. allowlist と上限を決める
5. pause を実装する
6. 監視と通知を整える
