# RENDER #4427 — protected recovery runtime SHA lineage rebind audit (2026-10-27)

**RESEARCH_ONLY / NEW_FINDING_RUNTIME_SHA_REBIND_WITHOUT_COMMIT_ATTESTATION / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 新たに実証した認証境界

固定一次TypeScript `recoverIdleProtectedRateBudgetState()` は、入力 `sourceSha` を使って既存stateの `runtimeSha` を検証するが、入力 `expectedSha` は40桁hex形式の検査にとどまる。`assertStateShape()` 内の `void expectedSha` は期待releaseの真正性・承認済みGitHub commit・親子関係・operator trust rootを検証しない。その後 `after.runtimeSha = expectedSha` でstateを再ラベルする。

元のTypeScriptを変更せず、所有PC実Windows FS上のstate/backup/rename/readbackと合成venueで実行したところ、保存state `runtimeSha=a×40` から `b×40`、`c×40`、`0×40`、`f×40` への書換えがPASSし、`manualReview` が解除された。`a→b→c` の連続再ラベルもPASSした。対象の40桁値が実GitHub commitに存在するか、Production承認済みかの証明はこの関数内で要求されない。

対照として、`sourceSha` を省略して新 `expectedSha` と旧stateが不一致の場合、誤った `sourceSha`、不正なSHA形式、STOP価格不一致、STOP欠損、pending存在、LONG方向、建玉空配列は拒否された。**旧stateのSHA照合は機能するが、移行先SHAの独立した真正性・承認証明とは別**である。

## 一次証拠・再現性

- 固定GitHub一次source: `939b59da49ce7960485a2004b0068dc63417ae82`。一次TS4ファイルを所有PCでGitHub raw実バイト取得しSHA256 pin一致。値は付属JSON `sourceRawSha256` に記録。
- 元TSはNode `stripTypeScriptTypes` + VMで実行し、state/backup/rename/readbackは実Windows FS。venue応答のみ合成。元判定関数のロジック変更なし。
- 独立Python launcher2本×通常/-O/-OOの全6子プロセス、各16ケース、**96/96期待結果一致、全6 exit0、canonical SHA256完全一致**。
- Canonical SHA256: `be098169b8f86866964f855d8719f7dae32035693d0f76289878b45e980db38e`。
- 監査Python実バイトSHA256: `f8f91ca0eec4832ae8a66b7fa0f70df89629b068265b03670d63846d1e012a6c`。
- 既通知のGitHub研究final commit 35件を存在照合し、所有PC既存研究報告と照合して重複結論を除外。

## 限界・次の認証

これは**独立した復旧関数のcaller-provided SHA境界**であり、実operatorが任意の `expectedSha` を受け付けること、承認済みreleaseが実際に偽装されたこと、Native8・13 GateProof・Production障害・実注文の証拠ではない。operator callerが候補非依存の署名済みrelease root、GitHub commit/tree、許可されたsource→target遷移、Account Lock/lease/receiptを別途照合しているかを一次コードで追跡する必要がある。合成venueのreceiptを真正証拠としない。

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`、Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`、Gross=`0.25x`。**NEED_NATIVE_ALLOCATOR / order_authorized=false**維持。VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、既存worktree変更なし。研究書込は所有PC `C:/Users/dis/render4427-research-only/` のみ、`C:/tmp` 未使用。既探索期間をOOSと呼ばない。
