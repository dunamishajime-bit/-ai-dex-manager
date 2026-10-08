# Runner LIVE recovery — 2026-10-08
停止原因を修正し、7売買RunnerをHEALTHYへ復旧。最終確認 2026-10-08 13:39:57 JST。Kill Switch OFF、新規注文許可ON。売買ロジックのLIVE releaseは ce1edeead8d0f9e5d88e829d415057117502a335 を維持した。

## 原因と対応
- Q102の復旧アーカイブがroot所有0700で、deployによる状態バックアップがEACCESとなり起動失敗。VPSの古いsystemdテンプレートには、リポジトリ側に存在するarchive作成処理が反映されていなかった。
- FILの未処理状態が残り、取引所FILの設定20倍に対してMargin Guard契約は5倍Cross。共有GuardがDATA_UNAVAILABLEとなり、他Runnerも新規注文BLOCK。
- archiveをdeploy所有0700へ修正。実効ExecStartPreを検査し、権限整備→既存SHA/実装/Operator Gate→未処理注文照会・復旧→LIVE事前検証の順序を保証した。元のGateは維持。
- Q102の既存復旧処理による3回の取引所照会でFIL注文の約定・建玉・未決済注文がないことを確認し、backup後に未処理状態を解消。Q102は13:27:23 JSTにLIVE復旧。その後PID1887838を維持。初回の共有ロック競合で再試行1回、復旧後に追加再起動なし。
- 対象36通貨の設定を検査し、APT/ARB/ENA/FIL/HYPE/LDO/ONDO/OP/SEI/SUI/TIA/TRX/UNIの13通貨を5倍へ整合。Crossは既に設定済み。Gross・売買条件・実建玉は変更していない。

## 再発対策
- Q102全instance用95-recovery-archive-ownership.confを導入。archiveのsymlinkを拒否し、復旧照会より先にdeploy権限へ整備。
- 未処理状態復旧の起動wrapperは、共有Lock競合・明示的なread-only rate budget飽和だけを最大180秒まで再試行。権限・認証・約定不明・曝露不一致等はfail closed。復旧条件・SHA・ackは元の処理のまま。
- account-config-readiness.timerをenabled/active。起動後2分、以降完了から5分＋最大15秒分散で検査。
- 設定整合は、実行release SHA一致・共有account lock・必須shared pending registryと全8状態ファイルの確認を経る。未処理/UNKNOWN/manualReviewでは延期。対象通貨がflatで未決済注文なしの場合だけ設定変更し、変更直前・直後に再照会する。注文/取消/建玉変更を送信する機能はない。
- null/空文字/boolean/配列/不正な数値の曝露をflatと解釈しない。missing/不正データはfail closed。再照会の整合点検は変更ゼロでPASS。
- 新releaseへのpromotion時は、同梱installerを新しいexact SHAで再実行し、36通貨policyが有効なuniverseをカバーすることを確認する。SHA不一致時は設定変更しない。

## 検証
- WindowsとVPS Linuxでpolicy30件・retry6件PASS。
- 別の一時ディレクトリでroot所有archiveのEACCESを再現し、startup installでdeploy書込へ回復、symlink拒否を確認。LIVE状態への障害注入はしていない。
- systemd実効ExecStartPreのarchive→recovery順序PASS、unit verify PASS、設定点検再実行の変更ゼロPASS。
- 7売買Runner＋Shared Risk＋Margin Guardのcurrent SHA/process/cwd/状態を点検。HEALTHY・fresh・新規注文許可ON・Kill Switch OFF。live-evidence.json参照。
- 独立コードレビューでImportant2件（pending網羅・数値coercion）を修正。最終Critical/Important0件。

将来の取引所障害まで無停止を保証するものではない。今回の再発経路は権限・設定・一時的競合の各層で対策した。強制発注や研究ロジックへの切替は行っていない。
