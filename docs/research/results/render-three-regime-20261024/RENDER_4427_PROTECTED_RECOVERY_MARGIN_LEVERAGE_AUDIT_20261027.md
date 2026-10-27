# RENDER #4427 — protected recovery のmarginType / leverage照合欠落監査（2026-10-27）

**RESEARCH_ONLY / NEW_FINDING_PROTECTED_RECOVERY_MARGIN_LEVERAGE_UNVERIFIED / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 未通知の新結論

固定一次TypeScript recoverIdleProtectedRateBudgetState() の assertProtectedVenueReadback() は建玉数量・方向とSTOP/TPの一部属性を照合する一方、**Asterの建玉marginTypeとleverageを照合しない**。一次 lib/aster-v3-client.ts の AsterPositionRiskRow には両フィールドが定義され、一次 config/idlePriorityShortPolicy.ts は **cross / 5x** を指定する。しかし実CLIの getPositions adapter は両フィールドを破棄し、元の復旧関数はその不一致を検知できない。

合成venueでRENDERUSDT SHORT数量と保護STOP/TPを正常に保ち、建玉だけを isolated / 50x、isolated / 20x、cross / 50x、cross / 20x に変えた場合でも、**元TypeScriptは復旧PASS・manualReview解除**となった。marginType・leverageが欠落または不正値でも同様。一方、STOP価格違い・STOP欠損・pending存在・LONG方向の対照は拒否した。

これは保護注文のtrigger/hedge-side、注文残量、数量許容誤差、時刻鮮度、post-readback競合の既報とは異なる**建玉のmargin/leverage契約照合境界**。ただし、他の独立Margin Guardが同じ異常を拒否する可能性を否定するものではなく、実注文権限が付与された証拠ではない。

## 一次証拠と独立再現

- 固定source commit: 939b59da49ce7960485a2004b0068dc63417ae82。一次TS4ファイルのGitHub raw実バイトSHA256を所有PCで照合し、各pinは証拠JSONに記録。
- 元TypeScriptはNode stripTypeScriptTypes + VMで直接実行。state/backup/rename/readbackは実Windows FS、venue応答のみ合成。元の照合アルゴリズムは変更なし。
- 独立Python launcher A（runpy）/ B（別子プロセス実行）×通常・-O・-OO、全6子プロセス、各17ケース、**102/102期待結果一致・6 exit0・canonical SHA256全一致**。
- canonical SHA256: 373151e21d129a8d42d5bd04b7279ad978e0eee179ae6428bac3d9ff260b7dfc。
- 正常拒否4ケースと、margin/leverage不一致・欠落の受理12ケースを含む。

## 証拠限界・次の認証

Aster実venueのmarginType/leverage不一致発生、実operator callerの認証、Native8 preallocation/owner-priority、13 GateProof、真正receipt、Productionの自然発生は未証明。今後は実operatorでのmargin/leverage・Account Lock・Margin Guard照合とsource identityを追跡する。自己申告rootや合成receiptを真正証拠扱いしない。

Owner=IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH、Route=IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT、Gross=0.25x。**NEED_NATIVE_ALLOCATOR / order_authorized=false**を維持。既存8ロジック、旧IDLE Core _overlay_block、VPS/LIVE/Production/HP/実注文、既存worktreeを変更しない。研究書込は所有PC許可領域のみで、C:/tmp未使用。既探索期間はOOSではない。
