# RENDER #4427 — PENDING_NEW保護注文の復旧承認境界（2026-10-27）

**RESEARCH_ONLY / NEW_FINDING_PENDING_NEW_PROTECTION_ACK_NOT_REQUIRED / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 新結論

固定した一次TypeScriptの `ACTIVE_ORDER_STATUSES` は `NEW`・`PARTIALLY_FILLED` に加え `PENDING_NEW` をactive扱いする。 `assertProtectedVenueReadback()` は注文のstatusが `PENDING_NEW` でもSTOP/TPのtype、side、reduceOnly、origQty、stopPrice、clientOrderIdが期待どおりなら通過する。合成venue readbackでSTOPのみ、TPのみ、STOP/TP両方が `PENDING_NEW` の場合に、元 `recoverIdleProtectedRateBudgetState()` はPASSし `manualReview` を解除した。

**未確定の注文状態を、別途のvenue受理・有効化receipt確認なしで保護済みとして承認できるコード境界**が新規に確認された。注文が実際に有効化されていないこと、Asterがこのstatusを返すこと、実建玉が無保護であることは未証明。従来の数量誤差・部分約定残量・重複注文・古いsnapshotの問題とは別のstatus遷移と認証の境界。

## 一次証拠と再現

- 固定source commit: `939b59da49ce7960485a2004b0068dc63417ae82`。
- GitHub `gh api` raw実バイトを所有PCに再取得し、一次TS/PythonのSHA256 pinを検証。一次4ファイルの実バイトSHA256は付属JSON `sourceRawSha256` に収録。
- 元TypeScriptをNode `stripTypeScriptTypes` + VMで直接実行。保存stateとbackupは実Windows FS上、venue応答は合成。
- 独立Python launcher2本×通常/-O/-OO、6子プロセス、各17ケース、**102/102期待結果一致・6 exit0・canonical SHA256全一致**。
- canonical SHA256: `ff228d9546ee9885d51014bd61040f2f6f79dbe7b5a2c4f3756a1ce881e1002f`。
- 対照: `NEW`正常PASS、`PENDING_CANCEL`、`CANCELED`、`EXPIRED`、`FILLED`、STOP価格不一致、STOP欠損、pending存在、LONG方向、余分なactive注文は拒否。
- `PARTIALLY_FILLED` 受理はstatus集合の既存動作確認であり、新結論ではない。

## 証拠限界と次の検証

合成venueの制御注入であり、Asterの真正status履歴、受理receipt、約定、Production、Native8、13 GateProofの証明ではない。真正Asterで `PENDING_NEW` がopenOrdersに出現するか、status遷移の意味、保護注文有効化の判定方法を実operator caller・API adapter・真正一次証拠で追跡する。自己申告receiptや合成rootは真正証拠にしない。

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`、Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`、Gross=0.25x。Native8 allocator未認証のため `NEED_NATIVE_ALLOCATOR/order_authorized=false` を維持。同一symbol建玉、12h cooldown、Shared Risk、Gross、Margin Guard、Kill Switch、Pending、account lock、dedupの迂回は行わない。既探索期間をOOS扱いしない。

VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、既存worktreeは未変更。PC研究書込は `C:/Users/dis/render4427-research-only/` のみ、`C:/tmp` は使用しない。
