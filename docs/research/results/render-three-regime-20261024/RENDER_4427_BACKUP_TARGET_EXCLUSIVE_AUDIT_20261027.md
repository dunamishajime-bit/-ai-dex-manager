# RENDER #4427 — 保護復旧 backup destination 排他作成欠落監査（2026-10-27 JST）

**RESEARCH_ONLY / NEW_FINDING_PROTECTED_RECOVERY_BACKUP_TARGET_OVERWRITE_RACE / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## 未通知の新結論

固定一次TypeScript `recoverIdleProtectedRateBudgetState()` の `exactBackup()` は、`stat(backupPath)` でバックアップ先の不存在を確認した後、**排他的作成フラグなしの `copyFile(statePath, backupPath)`** を呼ぶ。この2操作の間に別プロセスが同じパスへ先にバックアップ／監査証拠を作成すると、既存ファイルを上書きして消失させても、復旧は **PASSしmanualReviewを解除**できる。

元TypeScriptの判定ロジックを変更せず、所有PCの実Windows FSで、`stat` の不存在確認後・`copyFile` の直前にI/O境界を制御介入し、**独立Node OS子プロセス**が同じバックアップパスへ先にファイルを書き込んだ。JSON、binary、1KiBの異なる証拠ファイルを用いた3ケースすべてで、別プロセスのファイル作成成功を確認した後、元TSの`copyFile`がその内容を上書き。最終backupは復旧対象stateとバイト一致するため`BACKUP_NOT_EXACT`検査も通過し、state rename/readback、manualReview解除まで完了した。

一方、**最初からbackupPathが存在する**対照（通常ファイル・ディレクトリ）は`BACKUP_EXISTS`で正常拒否。pending、建玉欠損、STOP/TP欠損、STOP価格不一致、未管理active注文の対照も正常拒否。従って問題は「既存ファイルを常に無視する」ことではなく、**不存在チェック後の競合に限った排他性欠落**である。

既報のstate別writerによるlast-writer-wins、protected recovery rename前／rename後のstate競合、backup後のstate上書きとは異なる。今回破壊されるのは**復旧用backupPathを別プロセスが取得した直後のバックアップ証拠そのもの**である。

## 一次source・独立再現

- 固定一次GitHub commit: `939b59da49ce7960485a2004b0068dc63417ae82`。所有PCからGitHub raw実バイトを再取得し、4ファイルのSHA256 pin一致を確認。全pinは付属JSONに記録。
- 元TSをNode `stripTypeScriptTypes` + VMで実行。state/backup/rename/readbackは所有PCの実Windows FS。venueのみ合成。介入は`copyFile`呼び出し境界に限定し、元の`stat`・`copyFile`順序と実FSの`copyFile`挙動を保持。
- 独立Python launcher A（runpy）とB（別Python subprocess）×通常／`-O`／`-OO`の全6子プロセス、各12ケース。**72/72期待結果一致、全6 exit0、canonical SHA256一致**。
- canonical SHA256: `7491f66edc3ff2e3eb16010be83ad8ee9ca05521f4eb9c533fd05d00edd11010`。
- GitHub既知commitの実在照合33/33、所有PC既存監査報告18件と最新研究ブランチを重複確認。今回の結論は未通知。
- 詳細ケース別結果、6子プロセスのmode/exit/一致ハッシュは同名JSONに収録。

## 安全性・限界・次の認証

これは**制御介入で再現したコード境界の競合**であり、Productionで自然に競合が発生した証拠、実Aster receipt、Native8、13 GateProof、実注文の証拠ではない。バックアップ上書き自体は所有PCの許可研究領域内でのみ実行し、他の既存worktreeや実バックアップは変更していない。

復旧用バックアップには、存在チェックとコピーを分離せず、OSの排他作成または世代付き一意パス・所有者検証・永続化された証拠台帳を適用し、競合時はFail Closedとする必要がある。さらにoperator caller、Account Lock/lease、venueの同一snapshot/receipt/残量、Native8 preallocation/owner-priority、正式Owner/Route、13 GateProof、共通予約・dedupを真正一次証拠で検証する。自己申告rootや合成receiptは真正証拠扱いしない。

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`、Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`、Gross=`0.25x`。**NEED_NATIVE_ALLOCATOR / order_authorized=false**を維持。VPS/LIVE/Production/HP/実注文、現行8ロジック、旧IDLE Core `_overlay_block`、汚れた既存worktreeは変更しない。PC研究書込は`C:/Users/dis/render4427-research-only/`のみ、`C:/tmp`未使用。既探索期間を未使用OOSとは呼ばない。
