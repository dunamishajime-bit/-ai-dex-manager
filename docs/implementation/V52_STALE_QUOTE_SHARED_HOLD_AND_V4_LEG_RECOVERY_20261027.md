# 2026-10-27 V52 株価鮮度障害 / 共有Kill Switch復旧の運用引継ぎ

## 実測結果（JST基準）
- 現Production SHA: `7688ed7c93a1918d8b44837339b7da5584a868f5`; V52 / Q102 / PENGUなど既存Runnerはactive。V4旧RunnerはFAILED、候補C/DのLIVE認証は未了。
- 2026-10-27 00:30 JST: TSLA SHORT 0.3株をAsterで新規約定、395.83 USD、V52 V50_POST_OPEN_BASIS（POST_1130）、要求Gross 2.0x、注文数量100% FILLED、取引所注文ID 338458856。
- 00:42 JST: local stock proxy `http://127.0.0.1:8797/quote?symbol=TSLA` が `stale_quote` HTTP503、ageMs32286 > maximum30000。V52がshared `HOLD_PROTECTED`（recoverable:true）を発動。
- 01:30 JST: V52がTSLAを `BASIS_CONVERGED` で全量決済、EXIT_FILLログ有。**Kill Switch強制決済ではない**。当初約定の再現を理由にTSLA SHORTを再建てしない。
- 既存共有Kill: `/var/lib/disdex/shared/kill-switch.json` はactive=true、operator `disdex-v52-aster-only`、reasonはV52 recoverable tick stale_quote。Q102 heartbeatは`newOrdersAllowed=false`。
- 株価配信が回復したことをread-only HTTPで実測：`/health` freshnessReady=true、connected=true、TSLA quote 1.5秒程度、各銘柄十分fresh。ただし**一回のfresh観測だけでは認証復旧にならない**。
- V52の現在のlocal stateは `status:ready`、`positions:{}`、`pending:None`、`operatorReviewRequired:false`、一方共有Killは依然active。既存の`disdex-v12-kill-switch-auto-repair`は明示的に`HOLD_PROTECTED`を保留する設計で、自動解除はできない。
- V52既存ロジックは`transient_reference_error(error) and not self.positions()`だけローカル保留。保有中に軽度staleが起きると共有Killへエスカレーション。今回の主因。
- ネイティブV52参照feed`disdex-stock-reference-free.service`はactive。freshが継続しているか監視要。

## NEAR/AAVEの実際の建玉元（Q102ではない）
- `/var/lib/disdex/v12-v4/orders.json`: AAVEUSDT SHORT `REC_X06_TIME_12H`, rank28, reqGross 0.18x, 実ENTRY数量0.1, 既存STOP数量0.1。
- 同: NEARUSDT SHORT `REC_X02_TIME_36H`, rank31, reqGross 0.18x, 実ENTRY数量2, 既存STOP数量2。
- 当時の口座資産約61USD、AAVE0.1×134.5≈13.45USD（最低数量/丸めで約0.22x）、NEAR2×4.5105≈9.02USD（丸めで約0.148x）。合計約0.37x。
- いずれもKill発動前のエントリー。Killによる注文サイズ圧縮ではない。**不足ロット補填注文は不要、禁止**。C/D増額変更の既存建玉への遡及適用も禁止。
- `/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl` に古いV12 V4のAAVE/NEARエントリー証跡もあるが、正確な現存ポジションは上記`orders.json`の2レッグ/STOP/intent一致による。

## 修正
- GitHub修正 branch `fix/v52-stale-quote-local-hold-20261027`（PR #261、draft）、Commit `059a2ebb2c9c40487fe63eef897d5012b6bb9708`。
- 短時間のローカル株価503 `stale_quote` は、古い価格で発注せずV52のみ最大15分再試行、既存株建玉や保護管理を改変しない。参照復帰時に経路再開。
- 15分継続＋Stock建玉保有時、venue/Owner/STOP不一致等の別エラーは従来同様のglobal fail-closedへ送る。
- 追加Python unit 4件PASS、構文PASS。**本番未デプロイ**で、完全なvenue統合認証や負荷再現試験は未完了。

## Codex operator action（LIVE切替を担当）
1. PR #261を最新候補SHAに整合させ、full V52/Q102/Peer integration test、stock quote interruption with live-position simulation、Protected STOP/non-quote escalation・再起動試験を実施。CI実行・Pass後に候補SHA再固定。Gross C/D設定や他Runnerに差分を波及させない。
2. 現在の`HOLD_PROTECTED`解除はroot管理下の正式なoperator recovery。手動の`active:false`書き換え・timer解除・ignoreKillSwitch等の迂回は禁止。
3. 認証は証拠付きで最低3回連続: stock quote全監視シンボルfresh、Aster署名付きGETから2つのSHORTと対応するBUY reduce-only STOP_MARKET（数量完全一致）を検証、VENUE OPEN ordersとの整合性、`V52 positions:{}`/pending無し、margin guard HEALTHY、shared risk・daily loss・Kill他理由無し、shared pending exposure未解放0、account lock正常、正式許可SHA一致。ログとdigestを保存。条件が未達ならFail Closed維持。
4. 既存の`disdex-v52-idle-owner-recovery.ts`と`disdex-aster-upstream-live-recovery.ts`は別のKill reason/ポジション形態しか許可せず、**現在のケースに流用しない**。該当reasonで保護付き非flat crypto建玉を厳密に認証する限定のoperator復旧経路がなければ作成・テストし、root配下で正式承認。新旧Crash window競合を防止し、切替を2段階で監査。
5. 正規に解除した後、V52/ Q102 / PENGU / FET / HYPE / SharedRisk / MarginGuard + V4の停止状況を点検。3回以上の新規判定サイクル、他Runnerの新規発注の失敗理由、stock proxy freshness/429、pending journalとSTOP監査、HP heartbeat＆新規発注可否の実態一致を確認。
6. TSLAは既に`BASIS_CONVERGED`で閉鎖。再エントリーは**新しい日時の通常条件**が成立したときだけ、当時のfillを無期限有効な権限として再使用しない。NEAR/AAVEは現在の0.18x既存レッグをtop-upしない。

## Status
`ROOT_CAUSE_IDENTIFIED; PATCH_PUSHED_TESTED_NONPROD; STOCK_QUOTES_RECOVERED; SHARED_HOLD_ACTIVE; OPERATOR_RECOVERY_REQUIRED; TSLA_REENTRY_NOT_AUTHORIZED_BY_CURRENT_SIGNAL; V4_2_LEGS_IDENTIFIED; NO_ORDERS_SENT_OR_MODIFIED`
