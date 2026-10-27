# RENDER #4427 — protected recovery 建玉方向と数量符号の整合性監査（2026-10-27）

**RESEARCH_ONLY / NEW_FINDING_POSITION_SIDE_SIGN_INCONSISTENCY / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 未通知の新結論

固定一次TypeScriptの isShort(position) は positionSide=SHORT なら position.quantity の正負を見ずにSHORTと判定し、assertVenuePosition() は数量を Math.abs() して期待state数量と比較する。そのため、**positionSide=SHORT と正の positionAmt=+1 を組み合わせた合成建玉行**が、保存stateのSHORT数量1と保護STOP/TPが一致する場合、元の recoverIdleProtectedRateBudgetState() でPASSし manualReview が解除される。負のSHORT数量-1もPASSする。

同じ正数量+1で positionSide=BOTH にすると拒否され、負数量-1の BOTH は受理される。positionSide=LONG、建玉0、方向欠落、STOP価格違い、STOP欠損、pending存在は拒否される。数量が文字列"1"でも Math.abs() により数値化され受理される。

これは既報の「同一symbol追加建玉」「数量±1%許容」「注文positionSide未検証」とは異なる、**単一建玉行内部の positionSide と positionAmt の符号整合性が認証されない境界**である。

## 一次証拠・再現

- 固定一次GitHub source: 939b59da49ce7960485a2004b0068dc63417ae82。
- 一次TS4ファイルのGitHub raw実バイトを所有PCで再取得してSHA256 pin照合。値はJSON sourceRawSha256。
- 元TypeScriptはNode stripTypeScriptTypes + VMで直接実行。state/backup/rename/readbackは実Windows FS、venue行だけ合成。元の判定関数を修正していない。
- 独立Python launcher2本×通常/-O/-OOの全6子プロセス、各16ケース、**96/96期待結果一致・6 exit0・canonical SHA256全一致**。
- canonical SHA256: bfaddcef0959b8fd6a72a6322611870b2c1cc82ab8c8f7f7a7bb57e47114dbe8。
- 監査script raw SHA256: 501a610416951bcc9b8dc4dc8899397c3b909dc7858c91684cb66cb40df91514。
- 検証対象はreadbackの符号とsideの一貫性であり、Aster真正position mode・符号仕様や実際の矛盾行の発生を実証していない。

## 証拠限界・次の認証

合成venue応答であり、Aster実venueが SHORT と正数量を返す証拠、実注文、Production、Native8、13 GateProofの証拠ではない。Asterのposition modeとpositionAmt符号仕様、signed GETの真正row、order/position snapshot identity、operator callerのAccount Lock・lease・receiptを一次コードおよび独立真正証拠で確認する。矛盾時は保護確認済みとせずFail Closedが妥当。

Owner=IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH、Route=IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT、Gross=0.25x。**NEED_NATIVE_ALLOCATOR / order_authorized=false**維持。VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core _overlay_block、汚れた既存worktreeは変更なし。研究書込は C:/Users/dis/render4427-research-only/ のみ、C:/tmp 未使用。既探索期間をOOSと呼ばない。
