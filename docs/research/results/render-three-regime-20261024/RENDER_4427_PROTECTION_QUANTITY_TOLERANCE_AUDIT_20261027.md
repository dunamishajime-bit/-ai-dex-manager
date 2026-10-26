# RENDER #4427 — 保護注文数量の独立1%許容が複合して未保護残量を見逃す監査 (2026-10-27)

**RESEARCH_ONLY / NEW_FINDING_COMPOUNDED_QUANTITY_TOLERANCE / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 新結論

元TS `assertProtectedVenueReadback()` の `sameQuantity()` は、保存stateの期待数量に対して建玉・STOP・TPを**別々に±1%**まで許容する。合成venueで保存期待数量1.0、実SHORT建玉1.0099、STOP/TP各0.9901（すべてstatus=NEW、executedQuantity=0相当）とすると、**未保護差分0.0198（実建玉の約1.9606%）**が残る構成でも復旧PASS・manualReview解除。片方だけの小差分と異なり、建玉の+0.99%と保護注文の−0.99%が合成される。

この現象は既報のPARTIALLY_FILLED executedQuantity未照合とは独立。今回のSTOP/TPは未約定のNEWであり、`origQty` 自体が実建玉に対して不足する。許容範囲外の建玉数量、STOP/TP数量、STOP価格不一致、STOP欠損、Pending存在、LONG方向は正常拒否。

## 一次コードと実証

- 固定source commit: `939b59da49ce7960485a2004b0068dc63417ae82`
- GitHub raw実バイトSHA256 pin（4ファイル）: 証拠JSON参照
- 監査script raw SHA256: `bdf10e6c7477de60b263c33431e5e1a222d9dd0493f69e70c91673524b59a4e5`
- 元TSをNode `stripTypeScriptTypes` + VMで実行し、実Windows FS上でstate・backupを作成。取引所readbackは合成。
- 独立Python launcher2本×通常/-O/-OO=6子プロセス、各16ケース、**96/96 PASS・6 exit0・canonical SHA256一致**。
- canonical SHA256: `f79e311b017328ba4aecca265f794bbcddda6c278cd406b61289f7fd5515501a`

## 判定と限界

実Asterの注文残量、真正receipt、Native8/13 GateProof、Productionでの自然発生は未認証。数量丸め・lot stepを含む実取引所挙動の証明ではない。実注文の認証やNative8採用は認めず、`NEED_NATIVE_ALLOCATOR/order_authorized=false`を維持。

同一symbol建玉、12h cooldown、Shared Risk、Gross、Margin Guard、Kill Switch、Pending、account lock、dedupの迂回は一切なし。既探索期間はOOSではない。VPS/LIVE/Production/HP/現行8ロジック/旧IDLE Core _overlay_block/汚れたworktree変更なし。PC研究書込は許可領域のみ、C:/tmp未使用。
