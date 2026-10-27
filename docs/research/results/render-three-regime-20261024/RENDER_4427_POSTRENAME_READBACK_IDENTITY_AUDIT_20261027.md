# RENDER #4427 — protected recovery post-rename readback identity audit (2026-10-27 JST)

**RESEARCH_ONLY / NEW_FINDING_PROTECTED_RECOVERY_POSTRENAME_READBACK_INCOMPLETE_IDENTITY / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 未通知の新結論

固定一次TypeScript `recoverIdleProtectedRateBudgetState()` は、保存stateを `rename(temporary, statePath)` で確定した後に最終readbackを行うが、最終比較は **manualReviewがnull、positionsの件数、runtimeSha** の3条件に限られる。最終readbackで **pending、建玉数量、STOP/TP clientOrderId、価格、entryPrice、cooldown、lastDecision、updatedAt** が最初にvenue照合した内容と同一かどうかを検証しない。

元のTypeScriptを改変せず、所有PCの実Windows FSで保存state/backup/rename/readbackを実行し、`rename` 成功直後・最終readback直前に **別Node OSプロセス** がstateを書き換えるよう制御介入した。保存stateに新たな **pending ENTRYまたはEXIT** を追加、建玉数量1→2、STOP/TP注文識別子や保護価格を変更しても、復旧関数は **PASSしmanualReviewを解除**した。保存stateの建玉数量が2になった場合も、復旧前に照合した合成venueの建玉数量は1のままであり、再照合は行われない。

対照として、positions件数0、runtimeSha不一致、manualReview再設定、route/gross/stopPriceがschema不正となる変更は最終readbackで拒否された。従って最終readbackは完全に無効ではないが、**状態の同一性とpending不存在を証明できない**。

これは既報の「protected recoveryのrename前に別writerのstateを上書きする競合」と異なり、**rename後の別writerによる正規形のstate変更を、最終readbackがPASSとして追認する境界**。venue readback後・state commit前のvenue変動監査とも異なる。

## 一次sourceと再現性

- 固定GitHub一次source commit: `939b59da49ce7960485a2004b0068dc63417ae82`。
- 元TS4ファイルを所有PCから `gh api` のGitHub raw実バイトで再取得し、SHA256 pin照合一致。source pinは添付JSON `sourceRawSha256` に記録。
- 元TypeScriptをNode `stripTypeScriptTypes` + VMで直接実行。state/backup/rename/readbackは実Windows FS、venue応答のみ合成。別writerは `spawnSync` で起動した独立Node OSプロセス。
- 18ケース（PASS12、正常拒否6）×独立Python launcher A/B×通常/`-O`/`-OO` の全6子プロセスで、**108/108期待結果一致、全6 exit0、canonical SHA256一致**。
- canonical SHA256: `65efd108aaa195458a8ae967d1a44040083b07082b2f0dbd87802fe0ed829a41`。
- 監査Python・ケース別結果・独立6子プロセス証拠は本ブランチの監査スクリプト/JSONに収録。
- 既通知のGitHub最終SHA29件と当日追加研究branch8件を所有PCからGitHub実在照合し、既存監査報告19件と重複確認済み。

## 証拠の限界・次のゲート

別writerのタイミングは研究側の制御介入であり、Productionで自然にこの競合が発生した証拠ではない。venue応答は合成であり、Aster真正receipt、実operator caller/Account Lockの実際の排他範囲、Native8/13 GateProof、実注文の証拠ではない。

復旧を認証するには、全処理を通したowner/lease/Account Lockの排他または世代付きCASと、rename後の**pendingを含む完全なstate identity**の検証が必要。建玉/注文のvenue as-of、orderId/receipt、更新時刻、残量、owner/route/grossとNative8 allocatorを別途真正証拠で確認する。自己申告rootや合成receiptを真正証拠扱いしない。

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`、Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`、Gross=`0.25x`。**NEED_NATIVE_ALLOCATOR / order_authorized=false** 維持。VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、汚れた既存worktreeを変更していない。監査成果物のPC書込は `C:/Users/dis/render4427-research-only/` 内のみ、`C:/tmp` 不使用。既探索期間を未使用OOSとは呼ばない。
