# RENDER #4427 — 同一 clientOrderId の複数active保護注文に関する研究監査（2026-10-27）

## 新規結論と範囲

**RESEARCH_ONLY / NEW_FINDING_DUPLICATE_ACTIVE_CLIENT_ORDER_ID_NOT_REJECTED / NEED_NATIVE_ALLOCATOR / order_authorized=false**

一次TypeScriptの assertProtectedVenueReadback() は、保護STOPとTPをそれぞれ activeOrders.find(row => row.clientOrderId === expected...Id) により最初の一致行だけで検証する。残りのactive注文に対する未管理注文検査は expectedOrderIds.has(row.clientOrderId) のみで、同じclientOrderIdを持つ別のorderIdの行を拒否しない。

その結果、合成venue readbackに有効なSTOP/TPに加え、同一clientOrderIdかつ異なるorderIdの別active注文が含まれていても、先に正しい注文が並んでいれば recoverIdleProtectedRateBudgetState() はPASSし、manualReviewを解除する。重複行の注文タイプ、売買方向、数量、reduceOnly、STOP/TP価格が不正でも同様。**逆順にして不正行が最初に現れると拒否**されるため、配列順序依存の認証漏れを実証した。

これは同一symbolの追加LONG/SHORT建玉の見落とし、PARTIALLY_FILLED残量不足、workingType/positionSide欠落、更新時刻無検証とは異なる **active保護注文の識別子一意性・注文全件照合** の欠落である。

## 一次コードと実バイトSHA256固定

GitHubのcommit 939b59da49ce7960485a2004b0068dc63417ae82 から所有PCの gh api でraw bytesを直接取得して検証した。

- scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts: 70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09
- lib/idle-priority-short-state.ts: 4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07
- config/idlePriorityShortPolicy.ts: 6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8
- lib/aster-v3-client.ts: 4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf

一次AsterOrderResponse型にはorderIdが存在するが、保護復旧CLIのgetOpenOrders adapterはorderIdを渡していない。実取引所が同一clientOrderIdのactive注文を複数返し得るかは未証明。

## 再現と対照

所有Windows PCの実ファイルシステム上に合成persisted stateを作成し、Node stripTypeScriptTypes + VMで固定された元のTypeScriptメソッドを実行した。元コード自体の修正はしていない。合成venueの注文にはorderIdを付与し、重複注文のclientOrderIdを一致させた。

- 正常STOP（orderId=1001）と正常TP（1002）の後に、STOPと同一clientOrderIdの別注文（2001、type=LIMIT、side=SELL、quantity=0.01、reduceOnly=falseなど）を追加：**PASS、manualReview解除**。
- TPの同一clientOrderIdを持つ別注文（2002、type=LIMITまたは誤ったstopPrice）を追加：**PASS、manualReview解除**。
- STOPとTPの両方に不正な重複行を追加：**PASS、manualReview解除**。
- 不正な同一clientOrderId行を先頭に置いた対照：**拒否**。
- 異なるclientOrderIdの余分なactive注文、STOP欠損、STOP価格不一致、pending存在、非active STOPの対照：**拒否**。

独立Python launcher 2プロセスずつを通常・-O・-OOで実行し、各16ケース、合計 **96/96** が期待結果と一致。6子プロセスの終了コードは全て0。全6実行のcanonical JSON SHA256は **56ba93c3d95575d1515d5ff680b85546215ca9137201b3bb1aeba3d23f517b81** で一致。Python assertによる判定は使用せず、条件不一致で明示的に例外を投げる。

## 証拠の限界と採用条件

**この証拠は合成venue配列の制御注入によるコード境界の再現であり、Asterが重複したactive clientOrderIdを返すこと、自然な重複注文の発生、実venue receipt、Production、Native8、実注文の証拠ではない。** orderIdの違いも合成値である。実AsterのclientOrderId一意性仕様・返却配列の完全性・重複と再送の取扱い・signed inventoryと一致snapshotの真正証拠を確認するまで経済BT・発注承認に使わない。

修正研究では、同一clientOrderIdのactive注文重複をFail Closedで拒否し、各注文のorderId/owner/route/side/数量/保護属性を全件検証し、Pending、Account Lock、Shared Risk、Gross、Margin Guard、Kill Switch、12h cooldown、Native8 allocationとの照合を維持する。真正なOwner/Route、13 GateProof、source identity、as-of/freshness、operator trust rootが揃うまで NEED_NATIVE_ALLOCATOR / order_authorized=false。

Owner: IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH。Route: IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT。Gross: 0.25x。

VPS/LIVE/Production/HP/実注文/現行8ロジック/旧IDLE Core _overlay_block/汚れた既存worktreeは未変更。所有PCの研究書込は C:/Users/dis/render4427-research-only/ のみ、C:/tmp 未アクセス。既探索期間を未使用OOSとは呼ばない。
