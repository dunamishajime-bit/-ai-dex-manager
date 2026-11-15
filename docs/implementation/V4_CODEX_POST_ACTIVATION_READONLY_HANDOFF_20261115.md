# V4 Codex切替後 — 本番Runner稼働の未確認点・研究BTの新pinへの接続条件（2026-11-15）

## 証拠を混同しない

2026-11-15の読み取り専用のVPS検証で、`/etc/disdex/runner-pins.json` の `V12_V4` が**`e788abc82e80f9fc7ab0e1ba83fdb8be267eb513`**であることを観測。これはユーザー申告のV4切替後のpin登録を裏付ける。

一方、`systemctl list-units --all`の観測では、このSHAに対応する **`disdex-v4-rate-budget-broker@e788...service` はactive/running**だが、当該SHAの**`disdex-v12-v4@e788...service` 本体のactive/runningは見つからなかった**。本体が別名に統合された可能性などは未確認なので、ここから`V4_STOPPED`とも`V4_LIVE`とも断定しない。表示中の過去SHAのmask/failed unitを最新V4の状態と混同しない。

同じ観測で `disdex-runner-watchdog.service` と `disdex-seven-runner-readonly-audit.service` がfailed、対応timerはactive/waitingだった。原因・最新の成否・本番監視影響は未確認で、勝手にrestart/kill/symlink変更をしない。

## Codex／Operatorが追加で確定すべき読み取り専用の証拠

1. pin manifestの `serviceUnit` と `releaseRoot` に対応する**実際の systemd unit、MainPID、ExecStart runtime SHA、プロセス起動時刻**。Brokerや旧monitor PIDだけではV4 main LIVE証明にならない。
2. V4本体のheartbeatの更新時刻・runner health snapshotと新SHA、Owner認証済み読取専用exchange statusの位置・保護STOP実在・建玉残高／リスク計算。注文／取消／建玉変更は実行しない。
3. 旧releaseのbroker/watchdogの状態と最新releaseに紐づくbrokerの所有権。多数の旧unitやサービス起動の履歴を、現在のAPI競合・注文権限の証明と混同しない。
4. V4新SHA `e788...` のrelease由来の**immutable runtime source/entry/exit/risk manifest**（テスト可能な読み取り専用sanitized copy、SHA256を添付）。GitHub commit APIは同SHAをGit commitとしては認識しなかったため、SHAはrelease identityでありgit commitとは独立の可能性が高い。
5. 対象年（2025-10-01〜2026-10-01）での入口候補・保護STOP・出口を新実装に忠実に再生して、30bps/10bps個別複利、Shared Risk7.5% / Crypto3.0x / Stock1.5x / Total3.5xと照合する。移行完了前に旧V4 sourceモデルの勝率・DDを新V4の実績とみなさない。

## 今回の作業権限と保留

Codexの本番切替完了申告を尊重し、本PR #481研究ブランチからV4 unitのstop/start/restart/mask、GitHub merge、HP deploy、取引所注文・STOP取消・新規注文等を実行しない。追加の特権診断は安全確認により一部ブロックされたため、そのGateを迂回して検査・修正しない。

新V4のsource parityが成立するまでは研究BTの新V4認証ステータスは`BLOCKED_REPLAY_REQUIRED`。作成済みのHYPE native/no-HYPE private replaysもこの制約を引き継ぎ、正式LIVE一致とは表示しない。