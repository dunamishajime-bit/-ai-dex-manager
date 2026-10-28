# DisDex 全Runner リスク管理・API競合・STOP・優先順位 最終引継ぎ 2026-10-28

## 境界

コードは候補ソースおよび非LIVE隔離環境だけを変更し、実注文、STOP取消、建玉決済、Kill Switch、Daily Risk 7.5%、Production systemd、HPは一切操作していない。LIVE反映のみCodexが実施する。

GitHub候補ブランチ: fix/full-risk-api-priority-release-prep-20261028
親コード: fix/v4-shared-stop-owner-multisha-20261028 (SHA 2565d7f1)
取り込み済み: AVAX / HYPE / PENGU 監査修正 (commit 72384128)

## タスク別受け渡し

1. **共通STOP V4の別SHA証明 — ソース完成**
   V4 53a0be39... の release marker、台帳、独立HEALTHY heartbeat、STOP quantity/side/orderId/reduceOnly、venue open-order照合を必須とする。旧共有監視のDOGE SHORT 226件数誤分類を修正。未証明注文はUNVERIFIEDのまま。既存29回帰テストを保持。

2. **Q102 Causal V4別SHAのSTOP証明 — ソース完成**
   Q102 ef1ab178... のmarker / state / heartbeat / stopLedger / 独立venue readbackを照合。Position中のSTOPは厳格に証明し、欠落/STALE/約定不一致はUNVERIFIED。16件の正負テスト。旧Q102との二重起動は禁止。

3. **共有リスクwriter更新による旧peer STOP喪失防止 — ソース完成**
   新writerのruntimeSHAが変わっても既存PENGU/FET/HYPE/IDLE/RESIDUALの旧共通SHA 7688ed7c...を必ず個別照合して既知注文を継続保護。Q102は個別独立証明のみ。将来個別peerを昇格する時だけ、root-only環境変数 DISDEX_SHARED_STOP_PENGU_OWNER_SHA 等を正規の新SHAに設定。未知SHAの自動信用禁止。

4. **共有Aster API競合 — コード完成**
   GlobalRateBudgetのrisk refreshが混雑した時は指数backoff/jitter、待ち時間尊重、60s上限。通常ネットワークエラーは従来retry。read失敗時の古いShared Risk snapshotを偽装更新せず、120s freshness ruleによるfail closedを維持。Rate Budgetファイルの削除、429/418無視、テスト注文禁止。

5. **PENGU/HYPEのV4 STOP誤認 — コード完成**
   V4の厳密な管理済みSTOPのみUnknownOpenOrderから除外。PENGUの3h -2.5% / 8h -4%早期損切判定がV4の保護注文で無関係に止まる不具合を解消。真の未知注文は変わらずBLOCKし他RunnerのSTOPをcancelしない。

6. **V4 STOP数量の1%許容誤判定 — コード完成**
   V4専用matcherで225/226の不足STOPを全量保護扱いしない。正しい226/226のみ管理済み。既存他Runnerの許容値は変更なし。

7. **AVAX LONG一度-3.5%から2h監視 — コード完成**
   一旦損失-3.5%到達したら2時間の監視開始は途中の一時回復で解除されない。最初の期限でなお-3.5%以下ならExit、期限時回復していれば解除。既存-5%硬STOP、6h exit、+3%到達後1.5pp retraceは維持。経済利益/DDへの影響は正式10/30bps統合BT未証明のため、自動LIVE昇格禁止。

8. **HYPE ENTRY/EXIT採用条件の分岐 — 診断テスト完成・経済承認保留**
   LIVE独立HYPE TRENDはEMA12/48 + 240 + breakout入口であり、以前採用したBTC3h<=+0.6%とHYPE3h-BTC>=+2%は実行経路に存在しない。+3%後+1.5%保護・entry1h初期損失exitも一致しない。テストでBTC3h +3%でも現行TRENDがacceptedとなる事実を再現。ただしEMA TRENDは別の固定Aster ledger正本を持つ。勝手に旧設定を混ぜず正本特定と再BT後に切替。

9. **V12 V4 41ルート・全体優先順位 — 既存ロジック単体検証完了**
   41 route ID/順位ユニーク。6 suite 33件PASS。正式発注・保護/利確・RANKING動作を全41ルート個別に実venue証明したことにはならない。Gross normal crypto3 / total4.25、共通Daily7.5、日次損失、reservation stateを最後に照合する。

10. **V52/FET/8ロジック経済BT・監視 — 残余認証**
    FET readinessとV52市場外DEFERRED処理、HP source/statusは監査対象。exact 8ロジック年間10/30bps BTは早期181日Aster-native 1hヒストリー不足により認証未成立。docs/research/Q102_EXACT_SHA_FULL_YEAR_NATIVE_COVERAGE_BLOCKER_20261028.jsonを参照。外部/BinanceデータでAster署名付き一次データを偽装しない。動的Gross配分は不採用のまま。

## エビデンス

隔離VPS: /home/deploy/disdex-trading/staging/full-risk-api-priority-20261028
ソース検証: 98 unit/integration contract tests PASS / FAIL 0
従来V12 V4の6suite: 33 tests PASS / FAIL 0
TypeScript全体: tsc --noEmit -p tsconfig.json --pretty false --incremental false PASS
Root Python読み取り専用preflight self-test: PASS
GitHub CI: .github/workflows/disdex-multisha-risk-api-release-cert-20261028.yml
ローカル検証とGitHub CI成功は別物。実GitHub CIのSUCCESSを最終確認すること。

### ライブAPI保護観測
2026-10-28: systemd V4/Q102/PENGU/V52/FET/HYPE/IDLE/RISK active; Shared Risk 0% / daily cap7.5%・sourceComplete true。
旧共通 STOP observerがV4 DOGE SHORT 226をUNVERIFIEDと誤分類。V4 companionは独立readが成立するとHEALTHY/effectiveUnprotectedCount0だが、Shared Aster API競合による一時的な VENUE_OBSERVATION_INCOMPLETE を観測した。正式切替はこの状態をPASSにしてはならず、署名付き読取が回復した時のみ続ける。

## Codex最後の実装反映手順（プログラム修正は原則不要）

1. 対象branchのHEAD/remote/CI/sha256/source tree、immutable release形式、root-only operator承認、VPSの正規release markerとsystemd drop-in完全一致を先に確認する。
2. Codexの安全境界内でAsterの署名付き読み取り専用snapshotによる全ポジション・全STOP/TP・open order・reserved gross・Risk7.5を照合。script scripts/ops/root/disdex-risk-api-final-preflight-20261028.py を実行する。このscriptはソースread-only gateであり、正式venue認証の代わりではない。
3. Risk Writerだけを先に単独切替する。旧Writer 7688ed7c... と新Writerの二重稼働は禁止。V4 53a0... /Q102 ef1.../PENGU/FET/HYPE/IDLE/V52を動かさず、新WriterのShared Risk sourceComplete、same-day tripped latch、STOP observation 全保護及び旧誤分類の解消をsigned venue読取で再確認。Failなら旧状態の安全なrollback。
4. 他Runnerのコード修正は個別切替対象。新しいsourceSHA用のDISDEX_SHARED_STOP_<PEER>_OWNER_SHAのroot-only operator pinをセットし、旧/新サービス同時発火を禁止。現建玉・STOPのownershipが継承されたことを確認できない場合は旧を保護してSTOP/positionsを保持する。
5. AVAX/HYPE発火・出口の経済的振舞いを変える変更は正本8ロジック統合BTと承認完了までLIVEにしない。あくまでもCodexは切替作業のみ、研究や閾値変更で条件を捏造しない。
6. 全体API queue cooldown / private HP判定状況 / Risk writer status / V4-Q102保護 / OpenOrders / pending / source hash / Gross planner / restart recoveryを切替後に照合し、100%一致の根拠を証明する。いかなる未成立GateでもBLOCKEDで現行LIVEを維持。

STATUS: SOURCE_IMPLEMENTED_AND_TESTED / LIVE_SIGNED_PRECONDITIONS_AND_EXACT_NATIVE_ECONOMIC_CERTS_NOT_PROVEN / CODEX_CUTOVER_ONLY

## 追加のCI回復診断 (ソースのみ)
旧Margin CIに残る V52 stock1.5/total2.5、root release-readiness のtotal2.5 は現在の正式VPSリスク設定 stock4.0/total4.25 と不一致の歴史的テスト期待値だった。現在のLIVE設定に合わせたCIとreadiness側の文字列契約だけを更新し、実トレード閾値は変更していない。

旧PENGU独立Bitget Parityではtrade9のSHORTが参照側1時間早く成立。Frozen reference SHORTに現ProductionのBTC EMA168連動2% limited structural re-breakが欠落していたため、reference側に独立armedLowと該当Gateを追加。Productionシグナルを参照の代用にせず、全量/parity assertionと差分診断を維持。GitHub CI全てSUCCESSとなるまでProduction認証は宣言しない。

## PENGU外部独立BT参照 — 最新2%Gate込みの再計算値
GitHubの実行済み2026-10-28 Final CI（Bitgetの2025-08-10〜2026-08-10外部データ、独立参照とProduction実装の全件トレード一致を厳密assert）から、33件、return+215.94065339210525%、PF2.945893501109601、最大DD-15.179442895906892%と確認。旧参照のreturn224.02%、PF2.990は旧SHORT 2%限定re-breakを反映しない古い期待値であり更新した。**条件や本番入口そのものは一切変更せず、実際の独立計算と一致したリファレンス結果にテスト期待値を更新した。** 統合8ロジックBTの代替ではない。
