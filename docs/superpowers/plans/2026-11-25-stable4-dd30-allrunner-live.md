# STABLE4 DD30 全7 Runner LIVE切替計画

## 目的

現行のSTABLE4 DD30 monitor-onlyリリースを、7 Runner・HYPE H48専用ゲート・既存GLOBAL HOLD/STOP/Shared Riskを維持したまま、正式な注文許可へ段階的に移行する。monitor-only承認を注文権限へ流用しない。

## 現状の判定

- 本番の7 Runnerは候補SHA `8c0b83d6654dff45a5e221c06dc67281714cdd60` でactive/running、再起動0回。
- GLOBAL HOLDは `HOLD_PROTECTED / GLOBAL / active:true` のまま維持する。
- 現行のeffective GrossはStock 4.0x、Total 4.25xで、DD30計画の3.0x/1.5x/3.5xと不一致。
- 候補SHA用のHYPE H48証明書・発行receipt・order-enable permitが未配置。
- したがって現時点はFail Closedで、LIVE注文許可は未成立。

## 実装

1. exact plan `config/disdex-stable4-dd30-allrunner-live-order-enable-plan.json` を固定する。
2. Rootで読み取り専用の7 Runner preflightを実施し、SHA/pin、systemd、effective caps、Shared Risk、Margin Guard、pending exposure、GLOBAL HOLD、署名付きGET 3回、HYPE H48 artifactsを検証する。
3. Gross設定はRootの保護された切替経路でのみ3.0/1.5/3.5へ更新する。個別envの手編集やrunner単位の再起動は行わない。
4. HYPEはH48専用のsource/plan/certificate/permitを別に固定し、他Runnerの承認と混同しない。
5. 6 Runner bundleとHYPE H48のOwner承認を、それぞれ exact SHA/plan/scope/ordersEnabled=true で取得する。
6. GitHub Environment `disdex-production` の承認後、Root executorをpreflight→executeの順に実行する。executeは全postconditionが成立しない限り失敗し、GLOBAL HOLDは解除しない。
7. 切替後に3周期のheartbeat、SHA、restart、STOP所有権、Shared Risk、Margin Guard、Gross、HOLD digest、signed GETを再監査する。

## 安全条件

- テスト注文、取消、強制決済、STOP撤去、Kill Switch/HOLD手動編集は禁止。
- 既存建玉の出口保護を入口許可から独立して維持する。
- 旧Runner/Writerとの二重稼働を検出した場合はFail Closed。
- HYPE permitまたはGross capが欠ける場合は全体を注文無効のまま維持する。
- monitor-only承認・旧DD21承認・旧SHA/planは再利用しない。

## 完了条件

正式Production SHA、7 Runnerの実効状態、ordersEnabled=trueの署名付き承認、Root preflight/execute Run、3周期監査、Issue #633の証跡を確認できた場合のみLIVE完了とする。
