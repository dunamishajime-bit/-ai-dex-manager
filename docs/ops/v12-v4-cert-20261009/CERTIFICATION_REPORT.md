# V12 V4 V2 Production認証報告（2026-10-09）

**採用判定：BLOCKED。新V12のProductionデプロイ・実注文有効化・新HP公開は実施しない。**

指定Handoff a537329f98a3c4b521d59043b90d0517d2faf3ae と指定監査資料2本を全文確認。現行 ce1edeead8d0f9e5d88e829d415057117502a335 を基点に監査した。隔離された認証用作業ツリーで修正・再検証し、他担当の研究ツリーとWindows主作業ツリーは変更していない。先行HPの順次ランキングアニメーション修正68631785460629d377d1927874bd08aebf105b4cを保持した。

## 再開後の実機観測（18:35 / 18:56 JST）

別作業で現行Runtimeが復旧したため、午前の保護停止・保有記録は過去時点の証拠として扱う。2026-10-09 18:35 JSTの署名付き取引所照会はPASS、実建玉0件・未約定注文0件。共有Kill Switchはactive=false。解除記録はSIGNED_TRIPLE_FLAT_RECOVERY／OPERATOR_EXTERNAL_MANUAL_CLOSE_VERIFIED_3X_FLAT。今回の新V4認証作業から解除・建玉決済・再起動はしていない。

現行Production SHAはce1edeead8d0f9e5d88e829d415057117502a335で変更なし。V12/PENGU/Q102/V52/HYPE_LONG/FET/IDLE(RESIDUAL含む)、Shared Risk、Margin Guardは全active/running。**これは現行ロジックの稼働であり、新V4の有効化ではない。**

公開HPはf2608b5720d7系のui-20sounds-top3リリース、/realtime HTTP200。新V4候補へ最新HPの1.5秒順次アニメーションと20効果音・通知変更を取り込み、旧UIへ巻き戻さない。新V4表示の修正は候補ソースまで。新V4本番公開は採用ゲート未合格につき実施しない。

旧HOLD_PROTECTEDという運用障害は現在解除済みだが、DD20.42%、外部PF0.57/Y06PF0.30、全8系統実行一致の未認証という採用上の問題は残る。Native Entryは下記の継続検証で外部候補・Core・修正後258件まで一致した。新V4の注文権限は無効のまま。

## 研究BTとLIVE認証の区別

|コスト|研究最終資産|件数 / V12|PF|最大MTM DD|
|---|---:|---:|---:|---:|
|10bps|291,326,102.62円|1,222 / 828|4.048992|-20.420014%|
|20bps|231,193,740.03円|1,224 / 828|3.655683|-20.965901%|
|30bps|174,749,524.32円|1,218 / 824|3.277641|-18.388765%|

旧研究の取引・資産・Funding・指標12ファイルすべてSHA256一致。参照Pythonモジュール30本は改行正規化後に一致。これは**研究モデルの再現率100%**であり、現行全8系統LIVEと研究の一致率ではない。

独立期間へ凍結41ルート・2段階修正を因果的に適用した結果は258件、PF10/20/30bps=0.570027/0.544400/0.519875。Y06は102件、PF=0.299519/0.286658/0.274162。順位・Grossは学習期間の事後評価で定められ、研究期間内の先読みを含む。外部期間開始前に凍結した順位を使う評価とは区別した。既に閲覧済み外部期間は未使用の将来検証とは呼ばない。

全8系統は研究モデルに含まれる。しかし現行Q102 CAUSAL_V4 selector、各Runnerの非同期約定・予約枠・所有権・Stock現行Fundingなどの完全なイベント一致は未認証。独立期間の全8系統統合BT・MTM DDも未認証。未知の結果を補間したり、研究資産額へ合わせ込んでいない。

## 10bps ロジック別研究指標

|系統|件数|勝率|PF|研究モデル損益（万円）|
|---|---:|---:|---:|---:|
|V12|828|73.07%|4.9015|15,930.89|
|PENGU|67|74.63%|3.4484|2,047.20|
|Q102|136|63.97%|2.0264|2,128.67|
|V52|87|81.61%|27.2557|3,757.14|
|HYPE_LONG|28|60.71%|3.4592|4,685.65|
|FET|7|85.71%|25.2045|412.57|
|IDLE|47|55.32%|3.2819|612.37|
|RESIDUAL|22|59.09%|0.5782|-138.16|

上表損益はUSD取引台帳を各決済時のモデルFXでJPY換算した値。LIVE損益ではない。過去指標の一部にJPYと名付けられたUSD列があったため明示的に分離した。各系統・ルート別の全コスト指標、発火拒否、Gross競合、台帳は docs/research/results/v4-production-cert-20261009/ に保存。個別最大DDを合算して統合DDとは扱わない。

## 実装・修正の到達点

- 41ルートのExit定義、閉じたH1の特徴量、2段階修正、凍結順位、サイズ・数量制約、予約枠、部分約定、所有権、同通貨反転待機、Cooldown、再起動用ジャーナルをオフラインで実行可能にした。
- Native G3は既存ProductionのprotectiveLevels/nextTrailingStopを再利用。凍結済み1,978件に対しExit時刻・価格・理由が1,978/1,978一致。証拠 v4-native-exit-parity.json。
- ネイティブ候補生成・Momentum age・90h onset・Core Native Gross・取引所注文ブリッジは未認証。入力のsourceParityVerifiedフラグだけでは認証しない。中央認証ゲートとオフラインCLIの実注文権限は常に無効。
- 研究Gross Recovery2.50/V123.00/Crypto3.50/Total4.75を予約込みで検証するコードを追加。現行VPSの2.0/3.0/4.25を無条件変更していない。Grossはポートフォリオ資産比であり、取引所レバレッジと区別した。
- Alpaca IEXフィードの購読ACK・通常市場の無通信再接続・正確なfresh/deferred表示を修正。鮮度TTLは緩めていない。休場中のTSLA古値を新鮮と扱わない。
- V52は保有中の休場ループでも読取専用ガードに口座注文ロックを使わない修正。緊急FLATTENは引き続きロック下。これは準備済みソースであり、VPS適用済みとは扱わない。
- HPは研究/Shadow/実観測を分離し、時刻・SHA・Kill Switch・Runner状態が曖昧ならLIVE表示を拒否する修正。新HPの本番公開は未実施。

## 運用保護と復旧条件

午前の共有HOLD_PROTECTEDはTSLAフィード鮮度HTTP503を起点とした。午前のV12停止は同Kill Switchを尊重したもの。ACCOUNT_LOCK_BUSYは孤児ロックではなくV52休場中の短周期ロック取得による。強制削除は行わない。全建玉フラット前提の既存自動復旧は午前当時のTSLA/PENGU保有に適用できなかった。現在は別作業の署名付きflat recoveryで現行運用が復旧している。

XRP pending用の復旧コードは、通常のnative口座ロック取得、V12停止、同じ現行SHA、3回の署名付き注文照会400/-2013、全対象時間の約定0件、全建玉と保護注文の安定、状態CAS・事前アーカイブ、対応予約枠の一意一致を要求する。共有/ローカルKill SwitchとmanualReviewを残す。注文・取消・強制決済・Runner再起動は行わない。適用結果は pending-apply-retry.txt と最終観測で確認する。

## 認証不足・リリース禁止理由

1. 10/20bps DDが20%超、外部V2/Y06 PFが1未満。
2. 順位の将来再現性と未使用期間での全8系統外部検証が未証明。
3. ネイティブEntry候補生成・全系統実設定・非同期venue execution・Funding/予約統合の完全一致が未証明。
4. TSLA通常市場で継続した新鮮な引用時刻の証拠は未取得。今回の認証作業では解除していない。別作業のflat recoveryによる現行解除を最新実機観測として区別する。
5. Productionと新候補SHAの一致、および全認証PASSは成立していない。現行安全管理を維持し、新V4の実注文は有効化しない。

ロールバック方針：現行Productionリリースを変更せず保持。運用整合は対象ファイルのアーカイブとCASを保存するが、予約を単独で戻して二重枠にしない。将来の安全修正も保護建玉を保った読取照合と条件付きActivationを経る。旧ロジックへの巻き戻しは行わない。

## 最終証拠

- 最新実機証拠：resume-vps-1832.txt、resume-signed-account.json（18:35 JST）。
- 最終rootテスト：120ファイル全PASS。WindowsでPOSIX専用2ケースskip、同じケースをLinuxで全3件PASS確認（feed-agent-targeted-test-evidence.json）。
- HPテスト：31ファイル114件全PASS（resume-ui-tests-correct-cwd.txt）。root/research TypeScript、Python14件、口座ロックscope、pending13件PASS（resume-typecheck-python.json）。
- Native Exit一致率：1,978/1,978、100%。研究12ファイル一致率：12/12、100%。現行全8系統との実行一致率は未認証、数値を捏造しない。
- ロジック別MTM最大DDは未認証。共有資産曲線を個別系統の独立資本曲線として流用できない。個別件数/勝率/PF/実現損益と発火順・Gross競合の全台帳は研究成果ディレクトリ参照。
- GitHubは指定実装ブランチへ通常のfast-forward Pushのみ。Production ce1edeeaはGitHubコミットAPIでも存在・SHA一致を確認済み。新候補とProductionのSHA一致は成立していないため、新V4 LIVE完了とは報告しない。
- ビルド検証の結果はresume-ui-build.txtとresume-linux-ui-build.txt。WindowsネイティブSWC不整合はWASM fallbackでビルドPASS。本番OSの隔離ビルドは初回heap不足、2560MB heapでの再試行は500秒タイムアウト。LinuxビルドPASSとは扱わない。18:56 JSTに当該ビルドプロセス0件を確認して今回の/var/tmp隔離ディレクトリのみ除去。GitHub Linuxクリーン環境でRoot/research型検査、V4安全テスト、UIテスト、production buildがすべてPASS（run 37914537310、コードSHA 034e88b4851302fddc457d010cc81f63c5ad7b19、19:01 JST完了）。これは採用認証PASSを意味しない。Productionサービス・UIリリースは変更しない。

18:56 JSTの最終読取照会でもProduction ce1edeead8d0f9e5d88e829d415057117502a335、全8系統RunnerとShared Risk/Margin Guard active/running、署名付き実建玉0・未約定0・送信注文0、HP HTTP200を確認（resume-final-vps-audit.txt）。one-shot監査サービスのinactive/deadは継続Runner停止とは区別する。

## LIVE優先の最終判定

18:59 JSTのユーザー指示に従い、HP追加変更・公開を後回しにしてLIVE側のEntry生成を再照合。現行buildV12SignalsはH2 Top3/既存WinRateGate、研究selected externalは別の候補集合・Core抽出台帳とinc_keysを使う。名前が同じnativeでも同じ候補母集団とは認証できない。現在の候補アダプターはSourceEvidenceを外部から受け取るもので、独立native生成器の完成とは扱わない。事後選別IDを実注文判定に流用せず、新V4実注文はBLOCKEDを維持する。

研究DD超過・外部PF失敗はコードビルドPASSやGross拡大で解消できない。必要な未達はNative Entryの候補全数一致、Core onset/Gross因果生成、全8実装の共有予約・約定・Funding統合リプレイ、未使用期間の将来順位再現性。これらを合格扱いに書き換えていない。

19:01 JST Linux CI全工程PASS: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/37914537310 。初回クリーン依存環境のRecharts label型不一致はunknown入力をstring/numberへ検証してDateへ渡す修正で解決。古い失敗ログをresume-ci-first-failure.txtとして残す。公開HP ai-dex-manager-ui.serviceは18:57 JSTにactive、PID3032654、f2608b5720d7リリースを維持（過去preflight unitのfailedとは区別）。共有Kill Switchは同時点active=false。

## 19:07 JSTの継続指示後：Native Entryとルート割当の修正・一致証拠

この節は上記の「Native Entry生成未実装」という以前の到達点を更新する。新V4のLIVE権限と採用判定はBLOCKEDのまま。

- 閉じたH2のみから現行buildV12Signalsを呼ぶNative候補生成器を追加。Momentum age（90h条件、96h上限）、H2 6hリターン、H2 EMA12/ATR31を移植。CONTはこのH2診断を使い、Recoveryは閉じたH1の特徴量を維持する。未来のindex+1 candleを渡してEntry時刻を決めない。
- Coreの90h onset、構造break、6h以内のfail、retest/reaccelとの遷移優先順位、Top3、ATRリスク数量とrank3 0.10x上限をNative状態機械として実装。6hはsetup確認期間でありExit保持時間ではない。
- 元候補から全一致ルートを候補化する実装を修正。研究の凍結discovery順で最初のルートを割り当て、その後に2段階修正を適用する。修正で拒否された場合に次ルートへ流さない。Core sourceからRecoveryを重複生成しない。これはポートフォリオ発火順位とは別の順序。

|照合対象|結果|証拠|
|---|---:|---|
|Native元候補、方向/rank/ATR/age/診断/Score/Volume/gate|299 / 299、差分0|native-source-parity.json|
|Core生イベントと選択・Gross|8 / 8、差分0|native-core-parity.json|
|修正前ルート候補|570件、研究258件に対し余分312件|native-route-parity-before.json|
|修正後Entry identity/rank/requestedGross|258 / 258、余分・不足・差分0|native-route-parity-after.json|
|単独legのEntry/Exit時刻・価格・正規化理由|258 / 258、差分0|native-route-exit-parity.json|

外部台帳で実際に発火した25ルートを覆う。残り16ルートの実発火一致、1年全体のNative選別一致、全8系統共有予約・非同期約定・手数料・Funding・実機数量はこの258件のPASSに含めない。Exit照合は単独leg・仮想fractional数量・既知H1約定価格のジャーナルであり、取引所約定の一致ではない。最初のExit比較は修正前274件の台帳を使っており対象誤りだった。正規の修正後258件の台帳へ訂正し、Exit実装を結果に合わせて変更せず一致した。

Native source/core/adapter/Exit CLIには取引所実注文権限を与えない。sourceParityVerified入力だけをLIVE認証とは扱わない。原研究に存在する学習期間の事後選別inc_keysを将来Entryの判定材料にしない。

### 継続後の検証・実機

Root/research TypeScript PASS。Root全122ファイルの初回は121 PASS/1 FAIL（Windows atomic renameのEPERM）。同じrate-budget競合テストを再実行し14 PASS/1 Linux限定skip。初回失敗証拠もnative-full-root-tests.jsonに保持する。Linux CIへ全122ファイルの回帰を追加し、失敗を無視しない。UIはアプリ正規cwdで114/114 PASS（native-ui-tests-app-cwd.txt）。誤ったroot cwdで実行したUI失敗もnative-ui-tests-wrong-cwd.txtに保存し、コード失敗と区別する。

19:28 JSTの署名付き再照会：Production ce1edeead8d0f9e5d88e829d415057117502a335、全8系統（IDLE内RESIDUAL）と共有Risk/Margin Guard active/running。共有Kill Switch active=false、実建玉0、未約定0。この監査の注文・取消・建玉変更は0。native-final-vps-audit.json参照。

同時刻の公開HPは別作業のui-sfx-diverse-ce392a0d8dd1、PID3073347、active。正規ポート3001 /realtimeはHTTP200（native-final-hp-audit.txt）。3000へのconnection refusedは誤ったポート照会でありHP停止とは扱わない。今回の新V4作業はHPを再デプロイしていない。

### 条件付きLIVE判定

候補実装の一致改善は実施したが、10bps DD20.420014%、20bps DD20.965901%、独立期間V2 PF0.570027 / Y06 PF0.299519は変わらない。コード一致はこの研究案の将来利益を証明しない。全8系統統合イベント一致も未合格。ユーザーの「DD20%超・事後順位再現性等の未解決が残る場合は実注文を有効化しない」という条件に従い、新V4デプロイ・実注文有効化は実施しない。既存LIVEは稼働中。旧ロジックへの巻き戻し、Kill Switch解除、強制lock削除、強制決済は行っていない。

Linux初回run 37918318265は全体回帰で停止。V4固有テスト/型検査はPASSだが、Idle状態移行の所有権検査に必要なdeployユーザーがCIに存在しなかった。Productionの所有権チェックを緩めず、使い捨てLinux CI内にdeployユーザーを作成しroot権限で所有権移行テストを実行する設定へ修正。全122TSに加え14MJSとV52 Python capacityテストをCI対象に含めた。Windows MJSは12/14ファイルPASS、2ファイルはbash不在/WindowsパスのPOSIX非互換。Linux再検証の結果を別途記録する。

## 継続作業の最終確定（19:45 JST）

Linux再検証run 37918728861は全工程PASS（19:42 JST完了）。検証コードSHA d4c4f041019c4583bf664b330249af051659b66d。全136 Node rootテストファイル（122TS＋14MJS）、V52 Python容量テスト、Root/research型検査、V4固有テスト、UI114テスト、Linux本番buildを失敗無視なしで通過。native-ci-linux-final.json参照。URL: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/37918728861 。これはコード検証PASSであり、研究案の採用認証PASSではない。

19:45 JSTの署名付き最終照会でも、Production ce1edeead8d0f9e5d88e829d415057117502a335、全8系統とShared Risk/Margin Guard active/running、共有Kill Switch false、実建玉0・未約定0、注文/取消/建玉変更0を確認。HPはui-sfx-diverse-ce392a0d8dd1、active、正規ポート3001 /realtime HTTP200。証拠native-release-decision-audit.json。今回の新V4作業でProduction・既存LIVE・HP公開を変更していない。

Native外部Entry/Exitの一致範囲は258件・25ルート、元候補299件・Core8件。残り16ルートの実発火、全8系統の約定/手数料/Funding/共有予約統合、事後順位の将来再現性、通常株式市場のfeed継続鮮度は未認証。研究10/20bps DD>20%、外部PF<1も残る。最終採用判定BLOCKED、新V4実注文無効・デプロイなし。現在稼働する旧来の現行LIVEと新V4のLIVEを混同しない。

## 20:25 JSTの切替依頼を受けた再監査

20:30 JST署名付き照会PASS、実建玉0・未約定0。Production SHA ce1edeead8d0f9e5d88e829d415057117502a335、共有Kill Switch false、全8系統を担う7 RunnerとShared Risk/Margin Guardはactive/running。最新HPは別作業のui-studio-15-b297c883dfdaでactive、正規ポート/realtime HTTP200。

実機release内のlib/config/scriptsと候補8d9f69a36f50d278e6f31c011958034845b5c4f1を改行正規化SHA256で比較した。既存プログラムの差分はV52のlock scope修正とAlpaca feed鮮度修正の2ファイル。V4モジュールは実機releaseに存在せず、現行V12 Runnerにも新V4への接続はない。候補にはオフラインlifecycle/候補生成/認証のみがあり、実注文への注文ブリッジと全8統合実行認証は未完了。単純配置・orderEnabled書換えを新ロジックLIVE完了とは扱わない。ソース証拠activation-source-audit-2025.json、照会証拠activation-readback-2025.json。

研究の最終判定9c03bb90841e4fb9fe62186940c62d3fcedabac4（2026-10-09 12:13 JST）も全文確認。Y06の外部PF0.2995を受け、BLOCKED_PRODUCTION_ROBUSTNESS、現行LIVE維持・新V4/Gross即時昇格不可と明記。本文の固定コピーactivation-research-verdict-source-2025.mdを保存した。リスク縮小やY06停止は事後検証の仮説であり、指定291,326,103円案と無断で入れ替えない。

最新ユーザー指示は切替希望の再確認として扱い、最初の「全認証に合格した場合に限りLIVE」「DD20%超等の未解決が残るなら実注文を有効化しない」という条件を撤回したとは扱わない。実装未完了・全8実行未認証・外部成績不合格のため、切替未実施、新V4の実注文権限は無効。既存LIVEへ注文/取消/決済/再起動/設定変更は行っていない。

## 実注文基盤の修正と実装（今回の継続作業）

監査結果の列挙で止めず、以下のコードを実装した。これは実注文Runner完成・採用認証・LIVE切替の宣言ではない。

- ACCOUNT_MARKで他ロジックの現在建玉・未約定予約を更新し、更新時の資産額を基準にGrossを換算する。数量ゼロの未約定予約も共有上限に計上する。
- 予約額を超える確認済み約定を拒否して台帳から落とす不具合を修正。実数量・実価格・手数料を記録し、超過はexecutionReviewとして以後の新規を停止する。決済は妨げない。
- v12-v4-execution-store.ts：原始状態からのジャーナル再生照合、revision CAS、exclusive writer、ファイルfsync/atomic rename/Linux directory fsync、release一致を検証する永続ストア。SUBMITTING/UNKNOWNからPREPAREDへ戻せない。
- v12-v4-durable-orders.ts：既存Aster adapterの実注文/Reduce-Only Exit/STOP/TPを呼ぶ送信ブリッジ。共有予約後・送信前にSUBMITTINGを永続化し、通信断はUNKNOWNへ記録する。同じCIDの照会が-2013/nullでも再送しない。注文ACKと約定・保護確認を区別する。
- v12-v4-venue-fills.ts：独立取得したorder/user tradesのorderId・symbol・side・数量・価格・手数料を照合し、trade IDで重複計上を防ぐ。完全な約定履歴がないterminal ACKでは予約を解放しない。USDT以外の手数料は換算証拠が必要。
- V4関連66テストPASS、Root/research型検査PASS。RED→GREEN証拠を同ディレクトリへ保存。Linux全体回帰は新commitを対象に別途実行する。

残作業：この送信基盤をNative/H1/H2常駐Runnerへ接続すること、実共有予約・全8所有権を具体的に供給するProduction guards、実約定・部分決済・保護注文・Fundingの統合照合、全8系統外部期間認証。送信基盤のテストでこれらをPASSと扱わない。独立期間PF<1、開発期間DD>20%、事後順位問題も未解決。新V4実注文を有効化していない。既存Production、Kill Switch、建玉・注文、HPには本修正から変更を加えていない。

### 修正基盤のLinux検証と実機確認

実装SHA a4b40c29f99e796caf9dd6f7375d12f3b7e339ab のLinux CI 37926847668は全工程SUCCESS。Root 140 Nodeテストファイル、V52 Python capacity、Root/research型検査、UIテスト、本番UI buildを通過した。証拠 execution-bridge-linux-ci.json、URL https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/37926847668 。注文Runner統合・全8戦略採用認証をこのコードCIで代替しない。

20:59 JSTの署名付き実機照会（execution-bridge-vps-readback.json）：Production ce1edeead8d0f9e5d88e829d415057117502a335、全8系統を担う7 Runner＋Risk/Margin Guard active/running、現在のkill-switch.json active=false、実建玉0・未約定0、HP ui-studio-15-b297c883dfda /realtime HTTP200。before-clear/backupのkill記録は現在状態と区別する。取引所送信・取消・建玉変更0、新V4デプロイ・有効化なし。

今回、実装上の不具合を修正して送信・再起動・Entry約定照合の基盤を追加したが、依頼全体は未完了。新Runner統合・保護/Exit/Funding・全8統合認証と戦略の独立検証が残る。研究案の外部PFとDDに関する不合格も残り、指定条件のまま新V4 LIVE完了とは報告できない。

## DD許容値の更新（2026-10-09 21:04:45 JST）

ユーザーの最新指示「20%でも21%にはいっていないので許可します」により、候補V4のDD許容上限を21%へ更新した。新しい判定は10bps -20.420014%・20bps -20.97%をDD理由で拒否しない。元のBT値、41ルート、順位、Gross条件を変更していない。

config/v12V4AdoptionRiskPolicy.tsを単一の基準として、V4採用評価と候補lifecycleのDDガードが参照する。既存VPSの他ロジックのリスク設定は変更していない。21%超で新規を拒否し、既存legの決済は妨げない。

この更新は外部期間PF不合格、先読み順位、取引所Exit保護・全8統合未認証を解除しない。新V4の実売買有効化は未実施。
