# RENDER #4427 — Account position-mode readback omission audit (2026-10-27 JST)

**RESEARCH_ONLY / NEW_FINDING_ACCOUNT_POSITION_MODE_NOT_ATTESTED / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 未通知の新結論

固定一次TypeScript `recoverIdleProtectedRateBudgetState()` は、保存stateのSHORT建玉をvenueの `getPositions(symbol)` と保護STOP/TPの `getOpenOrders(symbol)` で照合する。しかし **Aster口座全体のposition mode（`dualSidePosition`）を取得・検証しない**。一次 `lib/aster-v3-client.ts` には署名付き `getPositionMode()`（`/fapi/v3/positionSide/dual`）が実装されているが、復旧CLI adapterの `IdleProtectedVenueReadback` には渡されない。

元TypeScriptを変更せず、所有PCの実Windows FSでstate/backup/rename/readbackを行い、venueのみ合成して実行した。追加した `getPositionMode()` の計測用methodは **全16ケースで呼び出し0回**。次の口座モードと建玉rowの矛盾を合成しても、復旧PASS・`manualReview` 解除となった。

- `dualSidePosition=false`（one-way想定）だが建玉row `positionSide=SHORT`、数量+1。
- `dualSidePosition=true`（hedge想定）だが建玉row `positionSide=BOTH`、数量-1。
- mode読取が未定義、あるいは呼ばれれば例外を投げるadapterでも、建玉/STOP/TPの照合が一致すればPASS。

正常な想定組合せもPASS。対照のLONG建玉、BOTH正数量、STOP価格違い、STOP欠損、pending、未管理active注文は拒否された。

**意味:** この復旧関数単体のPASSは、建玉rowのside/数量照合ができても、口座position modeが当該建玉/保護注文のpositionSide契約と整合することの独立した証明にはならない。既通知の「注文rowのpositionSide不照合」や「単一建玉rowの符号矛盾」とは別の、**口座全体の署名付きモード取得・照合欠落**である。

## 一次source・独立再現

- 固定一次GitHub source: `939b59da49ce7960485a2004b0068dc63417ae82`。
- 一次TS4ファイルをGitHub raw実バイトで所有PCへ再取得、SHA256 pin照合。各pinは付属JSON `sourceRawSha256` に記録。
- Node `stripTypeScriptTypes` + VMで元TSを直接実行。state/backup/rename/readbackは実Windows FS、venue readbackとposition mode応答のみ合成。
- 独立Python launcher A（runpy）/ B（別Python subprocess）×通常/`-O`/`-OO` の全6子プロセス、各16ケース、**96/96期待結果一致、全6 exit0、canonical SHA256一致**。
- canonical SHA256: `fb9c3d594ad68955f084618037d9a4c0e81a8453e7deb4558c7794fb66d3c96f`。
- 監査Pythonの所有PC raw SHA256: `b0fbac3c3f224b8e888fb04feb0e0cbe2ef8c87fb928a88b7a99a77cae047ff1`。
- ユーザー提示の既知29 SHAと、その後の既存研究6 branch HEADをGitHub実在照合し、所有PC既存監査報告と結論の重複を点検。

## 証拠限界・次の認証

合成venueによるコード境界の再現であり、Asterが矛盾したmode/positionSideを実際に返すこと、真正署名付きGET/receipt、実operator callerがモードを別途確認しないこと、Productionでの障害、Native8、13 GateProof、実注文を証明しない。**実operator callerとAccount Lockの排他範囲、getPositionMode真正署名付き応答、注文/建玉の同一snapshot・positionSide・workingType・残量・sequence/receiptの結合を一次コードと真正証拠で確認する必要がある。** 合成receiptや自己申告rootを真正証拠にしない。

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`、Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`、Gross=`0.25x`。**NEED_NATIVE_ALLOCATOR / order_authorized=false**維持。VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、汚れた既存worktreeは変更していない。PC研究書込は `C:/Users/dis/render4427-research-only/` のみ、`C:/tmp` は使用しない。既探索期間をOOS扱いしない。
