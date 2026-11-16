# STABLE4正式切替直前のVPS現況（2026-11-17 JST）

## 方式と境界

Owner PCの既存SSH認証・既知ホスト鍵照合を利用した、**現在のVPSへの読取専用SSH**を実行しました。秘密鍵・認証環境・署名済みポジションの生データは取得・出力・Git保存していません。実行コマンドは、公開プロセス/RootソースのSHA256、systemd表示、readlink、stat、リリース存在確認のみです。**サービス起動・停止、VPSファイル書込、注文・取消、建玉・STOP変更は0件**。

検証時VPS時計：2026-11-16T21:53:32Z（JST 2026-11-17 06:53:32）。

## 実測結果（本番、ただし署名付き取引所照合ではない）

- /usr/local/libexec/disdex-unified：root:root、mode 755。対象ディレクトリに合計37個の disdex_*.py を列挙。
- 2026-11-16取得のプライベートRootスナップショットから構成した、**監査対象21モジュールのSHA256が実際のVPS上で21/21一致**。余剰16ファイルのソース・動的関連までは今回の固定監査対象外。以前の静的ASTでは21モジュールから動的load 4箇所を検出しており、**動的な子モジュールの正式認証は未完了**。
- Q102：`disdex-quality102-causal-v1@ef1ab178e26a7bf5bddb6473467765edba242e1d.service` ACTIVE / RUNNING、MainPID 805183、`/proc/805183/cwd` は`/home/deploy/disdex-trading/releases/ef1ab178e26a7bf5bddb6473467765edba242e1d`に一致。**旧Writerを停止したとは主張できない**。
- 他の活性プロセス（systemd表示）：V4=`e788abc82e80f9fc7ab0e1ba83fdb8be267eb513`、PENGU=`1657e173d250ad58f53e62f7bb0a3428fb405496`、HYPE=`a7eee1f91d86d51f2333da117243d044ae1332dc`、FET/IDLE/Margin Guard=`7688ed7c93a1918d8b44837339b7da5584a868f5`。これらは**systemd稼働表示のみ**で、注文可能・保護STOP健全・Heartbeat進行を保証しません。
- `/home/deploy/disdex-trading/current`は`7688ed7c93a1918d8b44837339b7da5584a868f5`を指しています。V4/HYPE/PENGUは独立unit pin上の別SHAで稼働しており、このsymlinkだけで全Runnerのソースを断定してはいけません。
- この点検時点のSTABLE4候補ブランチコミット`b57bf6c5f4cd9513ebcef1a7bdd3d2cc50afb9b3`について、VPS immutable releasesディレクトリには**候補リリースが存在しません**。Root正式stageおよびOwner承認がまだ必要です。
- Q102の新学習stateパスはstatに失敗（**ABSENT_OR_UNREADABLE**）。旧プロセス稼働のため、新Writerの競合防止と正式bootstrapは依然必要です。

## 2026-11-17 OwnerのDD判断

過去研究BTの最大DD20%合格は、Ownerの今回の明示判断により**切替後に検証**。詳しくは`STABLE4_OWNER_DD_CUTOVER_DEFERRAL_20261117.md`。本番実際のDD停止・既存Shared Risk 7.5%・Kill Switch・STOP等を緩和した証跡ではありません。

## ここからの厳密な順序

1. 最新ブランチHEADでのimmutable candidateと外部Root/動的loader source認証。21 Root SHA一致はその一部のみ。
2. active Q102旧Writer、旧ポジション・EXIT・STOPがある場合の保護を維持した、Owner承認下の排他的状態遷移とrollback。現在の`DRAFT_BLOCKED`を無検証で解除しない。
3. fresh signed venue GETで実際の建玉、open orders、STOP owner、Shared Risk、Gross、Kill Switchを突合。systemdの`active`のみから安全性を断定しない。
4. H48 time-only/no resident STOPと新Gross経済条件を含む正規plan・GitHub Actions・HP Owner承認。歴史的な承認の再利用は同一operation/scope/SHA/planの場合に限る。
5. Codex正式切替、実decision tickを3周期以上検証。その後DD/BTのPOST-ST4-01..07を開始する。

**ステータス：LIVE_VPS_ROOT_21_HASHES_MATCH; Q102_OLD_WRITER_ACTIVE; NEW_RELEASE_NOT_STAGED; FORMAL_CUTOVER_NOT_COMPLETE。**
