# DISTerminal LIVE observability

## 判定状況スナップショット

`/api/system/decision-status` は、実行系を起動せず、読み取り専用の判定スナップショットだけを読み込みます。既定のファイルは `data/disdex-decision-status.json` です。VPS上のrunnerとWebプロセスが別ディレクトリにある場合は、`DISDEX_DECISION_STATUS_SNAPSHOT_PATH` で共有する読み取り専用ファイルを指定します。

スナップショットは `strategyId: "PENGU_DUAL_LS_V1"`、有効な `checkedAt`、PENGU全対象銘柄、V52全対象銘柄を含む必要があります。`status`、`side`、対象銘柄、時刻、理由のいずれかが不正、または最大鮮度を超えた場合、APIは発火候補を推測せず `取得不能` を返します。現在の上限は `DISDEX_DECISION_STATUS_MAX_AGE_MS`（既定2時間）です。

表示される「発火条件への近さ」はrunnerが出した `score` と `scoreMax` の比率だけで、Web側でシグナルを再計算したものではありません。`distanceToTrigger` がある場合だけ条件との差を表示します。画面から注文・取消・建玉変更は行いません。

## 注文・決済メール

実取引が成功して取引台帳へ保存された後、サーバー側で注文成立または決済成立の通知を送ります。対象は `appendTradeHistory` と `appendVenueTradeHistory` を通る実行経路で、判定確認や画面表示だけでは送信しません。

- 送信先の既定値: `dunamis.hajime@gmail.com`
- 無効化: `TRADE_EVENT_EMAIL_ENABLED=false`
- 送信先を明示する場合: `TRADE_NOTIFICATION_EMAIL`
- Gmail: `GMAIL_USER` と `GMAIL_APP_PASSWORD`
- SendGrid: `SENDGRID_API_KEY`

メール設定が未完了でも、注文・決済処理自体を失敗扱いにせず、通知失敗をサーバーログへ記録します。APIキー、アプリパスワード、秘密情報は画面やメール本文へ出しません。
