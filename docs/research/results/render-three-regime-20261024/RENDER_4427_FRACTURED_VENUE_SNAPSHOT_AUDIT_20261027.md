# RENDER #4427 — 建玉／保護注文の非同時点snapshot監査（2026-10-27 JST）

**RESEARCH_ONLY / NEW_FINDING_CROSS_ENDPOINT_FRACTURED_VENUE_SNAPSHOT / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 未通知の新結論

固定一次TypeScript `recoverIdleProtectedRateBudgetState()` の `assertProtectedVenueReadback()` は、同一symbolの `venue.getPositions()` と `venue.getOpenOrders()` を `Promise.all()` で並列取得するが、**両応答が同一のvenue状態・同一as-of・同一単調sequenceに属することを検証しない**。各GETが個別には正しいsnapshotを返していても、両者を組み合わせて実際には一度も存在しなかった「SHORT建玉＋保護STOP/TPが同時存在」の状態を認証し得る。

元TypeScriptの照合アルゴリズムを変更せず、合成venue adapterに原子的な状態遷移を注入して検証した。

- **建玉先行**：時点AはSHORT建玉のみでSTOP/TPなし。建玉GETが時点Aを取得した直後、時点Bへ遷移し、建玉は0、STOP/TPのみ存在。注文GETが時点Bを取得。復旧はPASSしmanualReview解除。
- **注文先行**：時点AはSTOP/TPのみで建玉0。注文GETが時点Aを取得した直後、時点Bへ遷移し、STOP/TPは消えSHORT建玉のみ存在。建玉GETが時点Bを取得。復旧はPASSしmanualReview解除。
- 上記両方向で、合成rowに `updateTime`、`orderId`、`entryPrice`、`workingType`、`positionSide`、`marginType`、`leverage` を追加してもPASS。これらのフィールドを付与しただけでは、同一snapshot性を検証したことにはならない。
- 合成venueの物理状態タイムラインは各ケースとも「建玉とSTOP/TPが同時に存在する時点なし」。それにもかかわらず、各GETからの個別応答は期待する建玉1件、保護注文2件を返し、state backup/rename/readbackを経て復旧PASSした。

対照の建玉欠損、STOP/TP欠損、STOP/TP価格不一致、未管理active注文、pending、LONG方向、注文取消状態、STOP side違いは正常拒否した。baselineの同時存在snapshotは正常PASSした。

**既報との違い**：venue timestampの古さ・未来時刻受理や、全GET完了後からstate commitまでのvenue変動ではない。今回の境界は**独立GETの取得期間そのものにまたがる非原子的・非同時点snapshotの合成**である。stateの別writer競合も注入していない。

## 一次sourceと独立再現

- 固定一次GitHub commit: `939b59da49ce7960485a2004b0068dc63417ae82`。所有PCからGitHub raw実バイトを再取得し、以下のSHA256を検証：
  - `scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts`: `70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09`
  - `lib/idle-priority-short-state.ts`: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
  - `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`
  - `lib/aster-v3-client.ts`: `4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf`
- Node `stripTypeScriptTypes` + VMで元TypeScriptを実行。state/backup/rename/readbackは所有PCの実Windows FS。venue応答・時点遷移のみ合成。
- 独立Python launcher A（runpy）とB（subprocess）×通常／`-O`／`-OO`、全6子プロセス、各16ケース、**96/96期待結果一致・全6 exit0**。
- 16ケース中5件PASS（baseline＋非同時点4件）、11件は意図どおり拒否。全6子プロセスのcanonical SHA256一致：`358f1d8f91481c37cfc2594e38bb9d28c30d4a6d133f428302736cb3ff370084`。
- 既存研究報告を確認し、ユーザー既知33 SHAのGitHub remote HEAD存在照合は33/33。既知監査の結論・数値は新規通知に再掲しない。

## 証拠の限界・次の認証

これは合成venueによる**独立した復旧関数のコード境界の再現**であり、Asterが現実にこの順序のGETを返したこと、実operator callerが別途同一snapshot/Account Lockを確認しないこと、Production障害・実注文・Native8・13 GateProofの証拠ではない。合成rowの`updateTime`は真正venue receiptではない。

次は実operator callerと署名付きAster adapterの同一snapshot性、単調sequence、as-of/freshness、orderId/receipt、建玉／注文全配列と残量、Account Lock／lease／pendingの排他範囲を一次コードで追跡する。真正root/13 GateProof、Native8 preallocationとowner-priority、実消費bytes、共通予約・dedupが認証されるまで注文を許可しない。

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`、Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`、Gross=`0.25x`。**NEED_NATIVE_ALLOCATOR / order_authorized=false**維持。VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、汚れた既存worktreeは変更しない。研究書込は `C:/Users/dis/render4427-research-only/` のみ、`C:/tmp` 未使用。既探索期間を未使用OOSと呼ばない。
