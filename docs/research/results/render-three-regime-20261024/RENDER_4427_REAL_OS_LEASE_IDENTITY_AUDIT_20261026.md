# RENDER #4427 — Windows実ファイルシステム Lease同一性監査（2026-10-26）

## 新しい一次コード監査結論

固定された既存TypeScriptの `FileAccountOrderLock` を所有PCの許可研究領域内で実行し、**メモリ仮想FSではなくWindowsの実ファイルパスに対する操作**で、Owner/Lease確認後のパス置換が3つの更新経路に影響することを確認した。

- `release()`：旧Leaseのread後に別プロセスが新Lease文書をパスに置換すると、旧Handleの`unlink()`が新Leaseのパスを削除し、成功を返す。
- `reserve()`：read後に新Lease文書を置換すると、旧Handleの`atomicWrite()`が新Leaseを上書きし、Gross 0.25xの予約を成功させる。
- `releaseReservation()`：read後に新Lease文書を置換すると、旧Handleが新Leaseを上書きし、旧予約の`RELEASED`更新を成功させる。
- **正常対照**：置換がread前に完了していれば、Owner/Lease不一致は検出され、`reserve()`と`releaseReservation()`は`ACCOUNT_LOCK_NOT_OWNER`で拒否する。通常操作も確認した。同一Owner・新Leaseへのread後置換も検証した。

これは既知のメモリ内TOCTOU監査の単純な再通知ではなく、**別Nodeプロセスによる実OSファイル置換と元TypeScript関数の実OS操作を組み合わせた追加証拠**である。ただし、置換プロセスは新Ownerの`acquire()`全体を実行したのではなく、文書を一時ファイルに書き`fs.renameSync()`で置換する**制御された介入**である。現行Productionで自然に同じ競合が発生すること、真正Native8全体の経路、実取引所の動作を立証したものではない。

## 一次コードと方法

- Repository: `dunamishajime-bit/-ai-dex-manager`
- 固定source commit: `939b59da49ce7960485a2004b0068dc63417ae82`
- 固定source: `lib/disdex-account-order-lock.ts`
- 一次コード実バイトSHA256: `169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b`
- 研究script実バイトSHA256: `33cea544a815886470a4abc04a33458f2b2aa37048065fe1ab73f90efda98545`
- 実行方法：元TSのimport/export境界を研究VM用に変換し、Node `stripTypeScriptTypes(mode=transform)`でクラス本体を実行。Lockパスの`mkdir/open/writeFile/rename/unlink`は実`node:fs/promises`、`readFile`だけは読取後の介入バリアを追加。Pending台帳の外部副作用は研究スタブ。別Nodeプロセスが研究ディレクトリ内のLock文書を`renameSync`で置換。
- 所有PCの許可研究領域：`C:/Users/dis/render4427-research-only/`のみ。C:/tmp、VPS、LIVE、Production、HP、実注文、現行8ロジック、旧IDLE Core `_overlay_block`、既存の汚れたworktreeには書き込まない。

## 独立検証

Python通常・`-O`・`-OO`の各モードで、互いに独立した2つのPython子プロセスを起動。各プロセスは固有の研究ディレクトリで12ケースを実行し、すべて終了コード0。**6プロセス×12ケース＝72/72 PASS**。全プロセスでcanonical JSON SHA256が一致：

`3ec5bfa2b56a923e56bc16a6806748ab58e4570a7f4cb7060518dbe13a56b425`

所有PCの監査証拠JSON実バイトSHA256：

`afc296334ef25fca9da34e76b0c9176a1f3ee21b431091b907e54ea47e166a23`

各実行は通常のOwner/Lease不一致拒否と、read後のパス置換による誤削除・誤上書きを区別している。これは**強制的に挿入したタイミングでのOSパス意味論の検証**であり、自然発生頻度、実ディスク停電、跨ホスト分散、実venue状態、Native8正式preallocationを測定していない。

## 採用判断と次の監査

- Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`
- Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`
- Gross=`0.25x`
- 判定=`NEED_NATIVE_ALLOCATOR`、`order_authorized=false`、正式Owner/Route登録・13 GateProof・真正operator trust root・Native8認証なし。
- 同一通貨建玉、12h cooldown、Shared Risk、Gross、Margin Guard、Kill Switch、Pending、account lock、dedupは迂回しない。
- 次は実caller全件、OSパス同一性と跨プロセス原子的CAS/排他、全Pending writer coverage、Owner不在とvenue照合receipt、Native8 preallocation/owner-priority、真正inventory/root/13 GateProofを追跡する。
- 自己申告root・合成receiptは真正証拠としない。5/27は拒否、6/23・6/25は真正証拠不足なら拒否。経済BTは真正証拠が揃うまで実施しない。既探索期間を未使用OOSとは呼ばない。

## 証拠ファイル

- `scripts/dd-reduction/audit_render4427_real_os_lease_identity_20261026.py`
- `docs/research/results/render-three-regime-20261024/RENDER_4427_REAL_OS_LEASE_IDENTITY_AUDIT_20261026.json`
