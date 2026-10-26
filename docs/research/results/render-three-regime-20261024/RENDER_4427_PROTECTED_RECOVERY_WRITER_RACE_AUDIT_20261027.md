# RENDER #4427 — protected rate-budget recovery の実state writer競合（2026-10-27）

**RESEARCH_ONLY / NEW_FINDING_PROTECTED_RECOVERY_OVERWRITES_PEER_WRITER / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 新結論

元TypeScriptの `recoverIdleProtectedRateBudgetState()` は保存stateの読み取りとvenue照合後、`exactBackup()` から最終 `rename(temporary,statePath)` までに、同じstateファイルへ他プロセスが保存した更新を比較・排他・CASで再確認しない。保護されたSHORT建玉があるstateでも、**バックアップコピー完了後、rename前に別Node OSプロセスが元の `writeIdleState()` で新たなpending・重大manualReview・cooldown・建玉数量・lastDecisionを書き込み、実Windows FSでその新stateが読み返せたにもかかわらず、復旧処理が旧snapshotから作成したstateで上書きし、manualReviewを解除してPASSする**ことを新規実証した。

これは先に確認された「建玉がないbenign recoveryの上書き競合」とは異なり、保護建玉のvenue readbackを行うrate-budget専用recoveryの、pending/保護建玉数量とmanualReviewを巻き戻す別の実caller境界である。新pendingは復旧開始時には存在せず、復旧開始時のpendingチェックを通過する。更新が保存されたことはrename前に読み返して明示検証した。正常なvenue応答は合成データである。

## 実証範囲

GitHub一次sourceを所有PCの `gh api` で実バイト取得しSHA256固定。元TSをNode `stripTypeScriptTypes` + VMで実行し、別Node OSプロセスが元TS `writeIdleState()` を使用。保護復旧の `copyFile` 境界のみ試験用ラッパーで制御し、原コード自体は未変更。実Windows FS上のstateファイルとバックアップを使用。

正常対照と、別プロセスがpending・重大manualReview・cooldown・position.quantity・lastDecisionを書き込む各ケースでは、復旧はPASSしてpeerの更新が失われた。開始時pending存在、STOP価格不一致、STOP欠損、未知manualReviewは正常拒否。

独立Python launcherを通常/-O/-OOそれぞれ2個、合計6 OSプロセスで実行。各10ケース、**60/60ケース一致・全6 exit0・canonical SHA256完全一致**。Pythonのassert最適化消失に依存せず明示例外で判定。

## 一次source raw SHA256

- `scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts`: `70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09`
- `lib/idle-priority-short-state.ts`: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
- `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`
- `lib/aster-v3-client.ts`: `4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf`

## 監査証拠

- Audit script SHA256: `50bdf328abd2329c2057353324e3b34b20662ed0782e12d86957279128cbdc77`
- Canonical JSON SHA256: `1b3940ad53c7db84cfc2cd94585f8e1bf6e993f68feb2b6d21fbfbe2195189ad`
- 証拠JSON: `RENDER_4427_PROTECTED_RECOVERY_WRITER_RACE_AUDIT_20261027.json`
- 実行script: `scripts/dd-reduction/audit_render4427_protected_recovery_writer_race_20261027.py`

## 限界と採用条件

合成venueと意図的なプロセス間インターリーブであり、自然なProduction同時実行、実Aster venue、実注文、Native8、真正operator receiptの発生証拠ではない。Account LockやPending Registryの全実callerが本番でこの競合を許すとまでは断定しない。source identity、owner/lease/route/strategy/symbol/gross、跨プロセス排他とCAS、venue/pending receipt、Native8 allocationと13 GateProofの真正性が未成立。**NEED_NATIVE_ALLOCATOR / order_authorized=false**を維持する。

同一symbol建玉、12h cooldown、Shared Risk、Gross、Margin Guard、Kill Switch、Pending、account lock、dedupは迂回しない。既探索経済期間を未使用OOSと呼ばず、真正証拠が揃うまで10/30bps Native8統合再生は行わない。VPS/LIVE/Production/HP/実注文/現行8ロジック/旧IDLE Core _overlay_block/汚れたworktreeを変更せず、PC研究書込は許可領域のみ、C:/tmp未アクセス。
