# RENDER #4427 — 保護注文readback後・state commit前のvenue変動監査（2026-10-27）

**RESEARCH_ONLY / NEW_FINDING_VENUE_POST_READBACK_COMMIT_WINDOW / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 未通知の新結論

固定一次TypeScript `recoverIdleProtectedRateBudgetState()` は `assertProtectedVenueReadback()` で建玉・STOP・TPを照合した後、backup `copyFile()` とstateのrename/readbackを実行するが、**state commit時点のvenue再照合やsnapshot/receipt fencingを行わない**。

元TypeScriptをNode `stripTypeScriptTypes` + VMで直接実行し、実Windows FS上のbackup `copyFile()` 境界で**合成venue adapterの状態だけ**を制御変更すると、STOP/TP取消、STOP消失、建玉消失、STOP数量/価格変更、foreign active注文追加、SHORTからLONGへの方向変更後でも、復旧関数はPASSし `manualReview` を解除した。

同じ取消・欠損を初回readback前に発生させた対照では正常拒否。従来の「古いupdateTime受理」や「別state writerのlast-writer-wins」とは異なる、**venue照合後からstate確定までの状態変化**に関する競合境界。

## 一次証拠・再現条件

- GitHub一次source commit: `939b59da49ce7960485a2004b0068dc63417ae82`。一次TS4ファイルをGitHub raw実バイトでPCに取得し、SHA256 pin一致。各pinは付属JSON参照。
- 元の復旧関数のアルゴリズムは変更していない。合成venue応答の変更タイミングのみ、依存 `copyFile` 境界で制御注入。state/backup/rename/readbackは実Windows FS。
- 独立Python launcher2本×通常・`-O`・`-OO`、全6子プロセス、各17ケース、合計 **102/102期待結果一致、6 exit0、canonical SHA256全一致**。
- Canonical JSON SHA256: `c7b365fed3840d667ff096cc8bdbc96db02dbf9e103dfcc586dd8a5ae59f0867`。
- 対照：baseline PASS、readback前のSTOP/TP取消・STOP/建玉消失、初期STOP価格違い・STOP欠損・Pending・LONG方向は拒否。

## 証拠限界と次の認証

合成venue状態の制御介入であり、Asterの実注文取消・建玉変化がこのwindowで自然発生した証拠ではない。真正Aster receipt、実operatorのAccount Lock、Native8、13 GateProof、Production、実注文の認証は成立していない。次は実operator callerの排他範囲、venue readbackのsource identity、単調sequenceとcommit-time fencingを一次コードで追跡する。

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`、Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`、Gross=`0.25x`。**NEED_NATIVE_ALLOCATOR / order_authorized=false**を維持。VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、汚れた既存worktreeは変更していない。研究書込は所有PC許可領域のみで、C:/tmpは使用しない。既探索期間をOOSと呼ばない。
