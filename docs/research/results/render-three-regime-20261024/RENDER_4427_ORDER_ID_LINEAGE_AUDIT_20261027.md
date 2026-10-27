# RENDER #4427 — protected recovery orderId / order generation identity audit (2026-10-27 JST)

**RESEARCH_ONLY / NEW_FINDING_PROTECTION_ORDER_ID_LINEAGE_UNBOUND / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 未通知の新結論

固定一次 TypeScript の `assertProtectedVenueReadback()` は、STOP/TP の `clientOrderId`、種別、side、reduceOnly、数量、価格、active status を照合する一方、Aster の **venue `orderId` を保存state・receipt・既知の注文世代と結び付けない**。一次 `AsterOrderResponse` には `orderId?: number` があるが、復旧CLIの `getOpenOrders()` adapter はこのフィールドを破棄する。復旧関数の `IdleProtectedVenueOrder` 型にも `orderId` がない。

元の TypeScript を改変せず、実 Windows FS 上で state/backup/rename/readback を行い、venue 応答だけを合成して検証。正常な `clientOrderId` と STOP/TP の他の属性を維持したまま、STOPまたはTPの `orderId` を別IDに置換、両方置換、STOP/TP間で入替、両方同一ID、片方欠落、0、負値、非数値文字列、極大数値にしても、**復旧PASS・manualReview解除**となった。通常のIDのbaselineもPASS。対照としてSTOP価格違い、STOP欠損、pending存在、LONG方向は拒否。

これは既通知の「同じclientOrderIdを持つ余分なactive注文の見落とし」と異なり、**期待STOP/TP各1件だけのときでも、その注文のvenue世代・真正orderIdを認証できない**境界。clientOrderIdが同じであればorderIdが変更されてもこの復旧関数は区別しない。Asterの注文置換・再作成が実際に発生した証拠ではなく、orderId変更が常に異常という意味でもない。安全な照合には署名付き注文/約定receiptと正当な取消・再作成のlineageが必要。

## 一次証拠・独立再現

- GitHub固定一次source commit: `939b59da49ce7960485a2004b0068dc63417ae82`。
- GitHub raw実バイトSHA256 pin: recovery TS `70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09`; state TS `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`; policy TS `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`; Aster client TS `4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf`。
- 元TSを Node `stripTypeScriptTypes` + VM で直接実行。元照合関数の変更なし。state/backup/rename/readbackは実Windows FS、venue行だけ合成。
- 独立Python launcher A（runpy）/ B（別Python subprocess）×通常/`-O`/`-OO`の6子プロセス、各16ケース、**96/96期待結果一致、全6 exit0、canonical SHA256完全一致**。
- canonical SHA256: `b2043c047d825c3d4b4d80b90ec3c4f750643ac848d95c30032535f8f99c26b8`。
- 監査Python実バイトSHA256: `edbf888952a404100cc7317740eae02f8f894424bb80990a7b90956e4f61df46`。
- 所有PCの既存研究報告（直近追加監査も含む）を読み、ユーザー提示の既知32 SHAをGitHub branch HEADで実在照合。既報と同一の結論は除外した。

## 限界と継続ゲート

この結果は合成venueでの**復旧関数のコード境界**のみ。Asterが不正なorderIdを返すこと、実operator callerがorderIdを別途認証しないこと、Production/Native8/13 GateProof/実注文での発生を証明しない。実operator caller、Account Lock、Aster署名付きorderId/receipt、position/orderの一致snapshot・単調sequence・注文残量、Native8 owner/route優先順位、真正inventory/rootと13 GateProofを追跡する。

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`、Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`、Gross=0.25x。**NEED_NATIVE_ALLOCATOR / order_authorized=false**維持。VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、汚れた既存worktreeを変更していない。研究書込は `C:/Users/dis/render4427-research-only/` 内のみ、`C:/tmp` は使用していない。既探索期間はOOSではない。
