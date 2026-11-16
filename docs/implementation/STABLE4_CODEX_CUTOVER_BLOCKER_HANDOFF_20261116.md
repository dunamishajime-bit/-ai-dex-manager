# STABLE4 切替のCodex最終引継ぎ／未解決ゲート（2026-11-16 JST）

> **状態: BLOCKED — この文書はCodexへの実装・検証依頼であり、LIVE切替許可・追加リスク許可ではない。**
> 一番重要な指示: 既存の `codex/stable4-production-integration-20261115` を継続する。新たな別ロジックへの切替、過去の保護状態の破棄、未認証の本番操作はしない。

## 目的・範囲

現行STABLE4の **V4 3-layer + H48 time-only + research Gross + Q102 source-pinned learning** を、完全なソース・経済契約の再現、状態／旧Writer排他、Root来歴、保護STOP、Shared Risk、Owner承認、CIとロールバックを含む正式な切替経路にまとめる。**Codexが実際の最終切替を担当**する。ChatGPT側では既存作業と重複せず、読取専用診断、非本番修正・テスト、GitHub Pushまで実施し、合格しないゲートは未達として明記する。

既存基点: `d39d4e7f28ae29fe9a1b5c7ad16ca3f431d10cea`（2026-11-16）。この文書追加後の新しいブランチSHAを必ず再取得し、切替候補の完全一致を取る。上書き前に `git status`, `git branch --show-current`, `git log -1` を確認し、他のCodex編集と競合させないこと。

既存の原本と研究証跡:
- `docs/implementation/STABLE4_INTEGRATION_CONTINUATION_20261116.md`
- `docs/implementation/STABLE4_POST_CUTOVER_DD_RECOVERY_AND_BT_REVALIDATION_20261116.md`（POST-ST4-01〜07は正式切替後のみ。現行リスクルール変更を許可しない）
- GitHub Actions run `43875784924` は `verify=success`。ただし成功はLIVE認証ではない。
- Owner PC の非公開Root/Q102/venue/BT証跡はGitHubに追加しない。

## 2026-11-16 再実行した非本番診断（操作・注文ゼロ）

1. Hajime Remote接続済。既存Windows worktree `C:\Users\dis\.codex\worktrees\stable4-production-handoff\-ai-dex-manager` は基点 `d39d4e7f2` でclean。
2. `python scripts/ops/build_stable4_runtime_source_manifest.py --source-sha d39d4e7f28ae29fe9a1b5c7ad16ca3f431d10cea`：レビュー対象Git blobs **236**。未解決ローカルimport **5**、dynamic/unresolved path **8**、`productionReady=false`。
   - 未解決Root import: `disdex_unified_root_gate`, `disdex_pending_maintenance_install`（upgrade/recover/refreshの計5参照）。
   - 未解決パスには `scripts/ops/deploy/disdex_pending_maintenance.py` および `lib/disdex-pending-*.ts` が含まれる。動的 import は `lib/stable4-uni-owner-evidence.ts` の実行中V4 pin固有のモジュール読込であり、単純な警告消去では対処不可。
3. Windowsローカル `PYTHONPATH=scripts/ops/root python -m unittest discover -s scripts/ops/root -p 'test_disdex_stable4_*.py' -q`：**49件、fail 0、skip 10**。POSIX専用テストはUbuntu CIで別途照合。PC側ログ `C:\tmp\stable4-root-test-20261116.log`。
4. 候補Gross設定（既存ソース）: Crypto 3.0x / Stock 4.0x / Total 4.25x / V4特例 4.75x。一方過去の研究マニフェストが示す旧契約は 3.0x / 1.5x / 3.5x。旧マニフェストを候補の本番経済パリティ認証に流用しない。
5. 最新候補Grossに合わせた私有研究BT: 2025-10-01 00:00Z〜2026-10-01 00:00Z、元本JPY10,000、複利、別建て10bps=795 fills / win 63.899% / 最大DD **21.571152%**、30bps=791 fills / win 61.820% / 最大DD **22.281591%**。両方ともOwnerのDD<=20%を不達。これは本番source-exact/OOS/約定同等性認証ではない。
6. 最新の既存監査ではactive旧Q102 pin `ef1ab178...` は legacy stateに書き込む。新`stable4-online-state.json`には書き込まない実装とのソース照合はあるが、全旧Writer排他は未証明。旧プロセスに `DISDEX_STABLE4_MODE=OFF` は設定されていない。Bootstrap `prepare/install/native_validate` は意図的 `DRAFT_BLOCKED` を保持。
7. 既存の署名済み取引所GET監査ではV4 SOLUSDT建玉1件・resident STOP1件が一致した時点証拠がある。これは継続的な保護保証やH48 no-STOP承認ではない。切替直前に新しい署名GET/注文台帳/STOP/PIDを再照合すること。

## Codexの実行タスク（優先順・一件ずつ検証してPush）

- [ ] **ST4-C01 源泉・依存関係**: 最終候補40桁SHAを固定。Root installed 21 modules / 4 dynamic loaders とGit 236 blobsの双方を確定・独立レビュー。5 missing imports / 8 dynamic pathsの各起点・終点・実行可能性を追跡し、必要な依存を正規immutable releaseに取り込む。外部Root preimageの観測SHAだけで信頼認証とみなさない。review-only inventoryと実際のarchiveを混同しない。最後に再度source manifestを生成、missing=0／解決済み動的経路の独立レビュー証拠を提出。
- [ ] **ST4-C02 Q102旧Writer排他**: 正規旧pin `ef1ab178...` の実際のプロセス・systemd・cwd・state path・他のwriter一覧を照合。旧RunnerのEXIT/STOP維持と排他の両立を設計し、所有状態を保護した正式トランザクションをテストする。既存`DRAFT_BLOCKED`を未認証で解除しない。設定文字列OFFの有無だけでwriter停止と判定しない。
- [ ] **ST4-C03 Q102 Native parser/seed/bootstrap**: 候補pinのNative parser、二つのseed、sourceCache、requestPlan、全evidence hashes、strict JSON重複キー／schema／時刻frontierを独立検証。隔離した非本番環境で状態導入→異常注入→完全ロールバック→再実行を行う。現行旧state、建玉、STOP、承認権限を変更しない。正式Owner承認前に本番bootstrapをinstallしない。
- [ ] **ST4-C04 経済契約・BT・DD**: 候補pinのLayer1〜3、V4/PENGU/Q102/FET/AVAX/UNI/HYPE/IDLE/V52、H48出口、Funding/手数料/STOP/Gross/Shared Riskを同一ソースから再計算。10/30bpsを分離し、未使用期間OOS/walk-forward/先読み/遅延/部分約定と最悪DDを独立監査する。**研究DD21.57/22.28%を合格に読み替えてはならない**。Owner条件DD<=20%と現在のRisk Gateを満たせない限り `BLOCKED_RISK_DD`、非LIVEで継続する。閾値・Gross・V4 21% latchを無断緩和しない。
- [ ] **ST4-C05 本番読取専用照合**: Fresh signed venue GETで全建玉、未約定注文、resident STOP、reduceOnly、残数量、Journal、同一SHAのRunner PID/CWD、Q102 writer、HYPE flatness、Shared Risk（日次7.5%）、Gross、pending状態、Kill Switch/STOP ownerを突合。修正で保護STOP、注文、既存建玉を壊す場合は拒否。旧・新同時発注禁止。
- [ ] **ST4-C06 認証・ロールバック・CI**: GitHub exact-head CIとRoot/Ubuntu/Python/TS/rollback fault-injectionを合格させ、root実装とimmutable stagingのhash/markerを一致。H48のtime-only / no resident STOPおよびStock4.0/Total4.25/V4特例4.75の**経済条件を明記した個別スコープのOwner承認**を正規Actions→HP経路で確認。既存承認のoperation/scope/SHA/plan一致・期限等を実際のゲートで確認し、承認不足を迂回しない。切替途中失敗時は旧安全構成にロールバックしSTOP維持。
- [ ] **ST4-C07 最終切替（Codex専任）**: C01〜C06の外部証拠・合格記録と正式Owner承認をそろえ、旧/新Writer・Runnerの競合なしを証明して最終発効。新しい実際のdecision tickを最低3回時間前進して観測、注文送信権限、EXIT/STOP、全ピン、Gross/Shared Risk、Web UIの実値を確認。合格前にLIVE/COMPLETEDと表示しない。**この項目は現在未実施。**

## Codexが最終報告に必ず含める項目

- 変更ファイル一覧、コミットSHA、Push先、レビューしたソースmanifestと参照hash、CI run URL、全テストのpass/fail/skip。
- Q102 old/new writer排他の証跡、Native parser/seed/bootstrapのトランザクション＋rollback証跡、Root dynamic loader/外部Rootレビューの照合結果。
- 10bpsと30bps個別の勝率、最大DD、純損益、取引回数、OOSと現行pin一致の可否。失敗した安全Gateは項目ごとに `BLOCKED` のまま残す。
- 現在の本番読取専用状態（時刻付き建玉／STOP／Runner／pending／Kill Switch／Shared Risk／Gross）と、実行した状態変更の有無。
- Ownerが承認したexact `operation/scope/SHA/plan`、正式CI/Actions/HP経路、および最終切替時のrollback実行可能性。必要な新承認は正規HP側に明示して要求する。
- 未達がひとつでもあれば本番変更せず、完了済み非LIVE部分をPushして残りを継続。憶測で`LIVE`や`DD合格`と断定しない。

## 非対象（切替後の別タスク）

DDの復旧階層、0.25x/0.5xの段階復帰、新BT acceptance、目標BT DD15%、勝率70%向け再設計、誤方向ロジックの改善は `STABLE4_POST_CUTOVER_DD_RECOVERY_AND_BT_REVALIDATION_20261116.md` のPOST-ST4-01〜07で管理。今回の既存STABLE4安全ゲートの代替ではない。

**安全境界:** 本文作成時点では、Owner PC上の非本番診断・回帰テストのみ。LIVE注文、建玉、STOP取消・再登録、Kill Switch変更、Runner再起動、systemd切替、VPSファイル変更、Owner承認、GitHubマージは実施していない。

## 2026-11-17 continuation: completed non-live hardening and remaining blockers

- `f4614a423231c72aea93865bedde2e57bb7f345c`: Q102 bootstrap JSON now rejects non-standard NaN/Infinity even with SHA-bound evidence. Local Root 50 tests, no failures (10 expected skips). GitHub Actions run `43925808817` succeeded.
- `5b6e6ab1c0e0d161fbbec26d57b130f1ac539077`: active legacy pinned Q102 cannot be declared writer-quiesced merely through `DISDEX_STABLE4_MODE=OFF`; old ef1 source does not honor it. Root 50 local tests passed (10 skips); GitHub Actions run `43926104158` succeeded. Q102 installation remains intentionally DRAFT_BLOCKED.
- `252dedb86afc0096b136118327b0dd673d053f6a`: added deterministic offline Q102 public-only request planner, 9 synthetic tests, dedicated Ubuntu CI step, and source-bound private plan for 7 symbols / 52 outcomes. GitHub Actions run `43927572024` succeeded. See `STABLE4_Q102_PUBLIC_EVIDENCE_PLAN_20261117.md`. Private plan is NOT a deployment token and has NOT fetched venue data.
- `da5af1fba58f6321521cffa752b9eb42b5755b6b`: documented why the frozen 7/7 pending no-order source overlay **cannot currently be merged into the integrated candidate**: Python 8 and TS 11 component tests pass but full TS typecheck rejects 10 incompatible/missing transitive dependencies and STOP owner exports. An experimental source-only worktree assembly was fully reverted; no incomplete candidate runtime was pushed. See `STABLE4_ROOT_PENDING_OVERLAY_PROVENANCE_GAP_20261117.md` for independent hashes, dynamic Root loader targets and missing V4 refresh helper.
- Live baseline is unchanged; no account/STOP, Runner, Kill Switch, owner approval, VPS mutation or activation took place in these tasks.
- **Next order:** solve pending/Root transitive source and dynamic loader closure without importing historical STOP semantics; finish Q102 public evidence outcomes + safe parser/writer exclusion; then independently pass source-exact risk/DD (current research 10bps 21.571152% / 30bps 22.281591% both exceed DD20%); signed venue preflight; exact scope Owner approval; formal cutover and three advancing decision ticks. Do not treat CI success or source-only request-plan success as LIVE readiness.
- Commit/CI state MUST be reacquired from the actual HEAD when Codex resumes; do not reuse any older SHA for an approval plan.

## 2026-11-17 continuation: offline Native Q102 parser and V4 release child

- V4 Root's dynamically imported `scripts/ops/deploy/disdex_v4_evidence_refresh_activation.py` is present in Git but was omitted by the candidate source manifest. The source-manifest builder now binds that exact Git-blob SHA and includes it in the inventory. Commit `4216fba9dcb1e10e2a57f2c658cb182bd3b476c2`; three focused tests pass. Candidate inventory now 237 Git files, with 8 explicit unresolved Python imports and 8 dynamic/unresolved references. These 3 newly surfaced Root imports are part of the previously hidden V4 loader source, not a permission to assume source closure.
- A separate **OFF-mode, strictly private, read-only Native Q102 parser check** confirms the source-pinned candidate Native engine and both seeds parse the owner PC private observed state. Hash and change timestamp of the private state are unchanged. Result: 52 pending, 0 completed, 0 unresolved, same observed frontier as the historical summary; zero orders. Three negative argument/path tests and repository TypeScript typecheck pass. See `STABLE4_Q102_OFFLINE_NATIVE_PARSER_AUDIT_20261117.md`.
- This check **does not** replace the DRAFT_BLOCKED Root/native bootstrap functions. Missing public M5/funding outcomes, external Root provenance, old/new writer isolation, signed venue proof, DD <=20%, economic parity and exact Owner approval remain blocking.

## 2026-11-17 continuation: pending source-only compatibility assembled

- The previous Root/pending error report (`STABLE4_ROOT_PENDING_OVERLAY_PROVENANCE_GAP_20261117.md`) remains the audit history, but the **candidate source compilation gap described there is now fixed** by a separately reviewed extension; see `STABLE4_PENDING_SOURCE_INTEGRATION_20261117.md`.
- All seven immutable pending maintenance child blobs in existing Root `HASHES` now match exact source SHA256; two missing history-verified read-only helper modules are pinned. The historical resident STOP observation source was **not** substituted: current five-argument logic remains unchanged, while the separate pending path requires explicit eight-owner SHA map and independent proof evidence.
- `npm run typecheck` PASS; STABLE4 integration 208 tests PASS; pending H48 tests 11 PASS; current resident STOP and runner 43 tests PASS; pending Root 8 Python tests PASS; added six owner-boundary tests PASS; frozen-source hash checks 3 PASS. CI now runs these source digest assertions.
- The repaired source is **candidate-only**. External Root modules and dynamic loader attestations remain unresolved; its frozen Root upgrade binds historic source SHA `bc46704cba6c5d7cc16ffaa3af32a4d222425505`, not the current STABLE4 candidate. There is no authorization to re-use the historic approval/Root transaction.
- Q102 52 pending outcomes, old/new writer isolation, signed venue/STOP evidence, source-exact economic parity, and 10/30bps research DD 21.571152/22.281591% (both above DD20%) remain BLOCKED. Do not promote or activate until independently resolved.

## 2026-11-17 continuation: byte-exact pending source and external Root audit

- GitHub CI run 43956864901 initially failed on the pending refresh source's byte hash. The Root-frozen source required SHA c5a7fec2..., while Git autocrlf had committed a normalized LF blob with SHA 87b0718a.... No Root PIN or economic logic was relaxed.
- Commit 4013f7bcaa5488805472fc6106d965231601b5b6 added a narrowly scoped Git attribute (-text, whitespace=cr-at-eol) and renormalized only scripts/ops/deploy/disdex_pending_refresh.py to preserve its exact Root-frozen CRLF blob. The staged/committed source bytes were independently SHA verified. GitHub Actions run 43958466990 PASSED. The candidate pending no-order source integration now passes exact source/hash CI.
- The existing private Owner PC Root snapshot (2026-11-16) was re-scanned using the non-executing AST-based Root graph checker: 21 modules, all independently observed SHA matched, 0 missing static modules, 4 external dynamic code loading sites. This is NOT a live VPS process or Root ownership proof.
- config/stable4/root-observed-snapshot-pins-20261116.json and scripts/ops/root/disdex_stable4_external_root_pin_audit.py provide strict hash, source ownership, module set and dynamic loader drift checks for a later authorized VPS read-only audit. Synthetic regression tests 8 PASS and the historic PC snapshot comparison PASSED as review-only; the command deliberately returns exit 2 until independent dynamic release-code provenance is verified. See STABLE4_EXTERNAL_ROOT_PIN_AUDIT_20261117.md.
- Current ROOT_CUTOVER_NOT_CERTIFIED still applies. Signed live venue proof, Q102 52 causal outcomes and old-writer exclusion, true source/economic parity, DD<=20% and scoped Owner approval must all be resolved before changing the VPS or promoting LIVE.

## 2026-11-17 OWNER DECISION OVERRIDES HISTORICAL DD PRE-CUTOVER HOLD

**This later decision supersedes the research-DD cutover HOLD wording earlier in this handoff, but not the research results.** Per explicit Owner instruction on 2026-11-17, historical/research BT max-DD<=20% acceptance and revised DD recovery rules are deferred until **after** STABLE4 formal cutover. See STABLE4_OWNER_DD_CUTOVER_DEFERRAL_20261117.md and POST-ST4-01..07. The previous 10bps DD21.571152% and 30bps DD22.281591% remain failed research results and must be reported truthfully, but are **not alone a pre-cutover blocking gate**.

ST4-C04 now splits into: (a) **BEFORE cutover** candidate immutable source/config/economic contract, H48 and Gross approvals, protection/risk wiring and mechanical correctness/parity of the actual deployed SHA; and (b) **AFTER cutover** full-year source-exact/OOS DD acceptance, recovery and strategy redesign. Do not confuse deferred research backtesting with a license to skip any source identity, ownership, STOP, risk function, current live-account DD latch, signed venue GET or owner approval.

All other C01/C02/C03/C05/C06/C07 pre-cutover gates remain. In particular, intentionally DRAFT_BLOCKED Q102 bootstrap and unresolved external Root dynamic loader provenance still bar LIVE activation until fixed. The existing live DD/latch/Shared Risk/Kill Switch code is **not changed or overridden**. This chat decision is not an HP approval receipt for a new operation/scope/SHA/plan.

## 2026-11-17 current LIVE VPS authenticated SSH baseline (read-only)

Fresh owner-PC strict-known-hosts Root SSH successfully read **current** VPS. Checked installed external Root SHA256: 21/21 reviewed module digests match the prior pinned Owner PC inventory (37 total disdex Python files; the extra 16 are not covered by the pinned 21). Root path root:root mode755. The installed Root dynamic import child provenance and the full candidate dependency closure remain to be independently certified.

Runtime unit inspection: active V4 e788abc82e80f9fc7ab0e1ba83fdb8be267eb513; active PENGU 1657e173d250ad58f53e62f7bb0a3428fb405496; active HYPE a7eee1f91d86d51f2333da117243d044ae1332dc; active Q102 ef1ab178e26a7bf5bddb6473467765edba242e1d (MainPID805183, cwd exact old pin); FET, IDLE, Margin Guard active on 7688ed7c93a1918d8b44837339b7da5584a868f5. Current release symlink also at 7688ed7c... . This is systemd status only, not signed venue protection proof or advancing tick validation.

Current candidate SHA b57bf6c5f4cd9513ebcef1a7bdd3d2cc50afb9b3 is not staged under VPS immutable releases yet. New Q102 bootstrap state was absent or not readable on stat; the old Q102 Writer remains active. Never run new Writer concurrently or stop existing exit/STOP protection merely to speed up cutover.

See STABLE4_LIVE_VPS_PRECUTOVER_READONLY_20261117.md for exact evidence and latest preflight order. Historic Root hash and runner SHA references earlier in this handoff must not substitute for the fresh source/pins. Owner's deferred **research BT DD** is already recorded in STABLE4_OWNER_DD_CUTOVER_DEFERRAL_20261117.md. No VPS changes or order/STOP/systemd writes made.

## 2026-11-17 public-only Q102 recovery outcomes captured and replayed

**Progress:** the previously missing seven-symbol Q102 public market evidence request plan was executed on the authorized VPS against the immutable 7688 SDK and shared public API budget; Aster endpoint requests were GET-only and did not load any trading credentials. Seven data files were copied back to Owner PC and their 7/7 remote SHA256 checked. Only public evidence was stored in an isolated VPS /var/tmp research folder; no live trading/STOP/Runner change.

The 52 old Q102 recovery continuation candidates have now been causally reconciled against this real public market evidence on a **private copy** of the learning state: 47 completed, 5 explicitly unresolved (APT3/FET2, all zero-trade entry M5-open mismatch), **0 matured pending recovery**; AVAX's separate KNN continuation has 31 completed and 4 pending. Do not fabricate prices for the unresolved rows. The Root candidate evidence-hash validator passes for the historical snapshot only.

Critical remaining condition: the evidence snapshot observedThrough=1794826800000 (2026-11-16 11:00 UTC) is stale against current VPS time; the Root validator correctly rejects it with Q102_BOOTSTRAP_OBSERVATION_FRONTIER_STALE. Latest-H1 observation catch-up on all 20 rolling symbols and any newly matured outcomes is needed. Old Q102 Writer remains active; signed venue flat confirmation and exclusive migration/rollback remain mandatory. Exact public GET source/hashes, state snapshot digests and private evidence paths are recorded in STABLE4_Q102_PUBLIC_OUTCOMES_REPLAY_20261117.md. No private state or market raw data is public in Git.

The Owner's research max-DD acceptance deferral remains in effect; do not confuse that with permission to bypass Q102 source, Writer, STOP, owner authorization or account protection gates.

## 2026-11-17 signed Aster account GET confirmed flat at observation time

VPS root read-only SSH reused the *source-matching* old Q102 SDK diagnostic: Git pinned ef1ab178... scripts/disdex-aster-readonly-account-diagnostic.ts SHA256 e624fdb1... exactly matched live installed bytes. Only the existing process's SDK credentials were passed inside the command, never printed. Actual signed Aster account GET (getServerTime, getBalances, getPositions, getOpenOrders) returned PASS at epoch ms 1794868017390: **account-wide active positions 0, open orders 0, orders/cancels/position mutations 0**. It is a one-time point-in-time proof, not perpetual flatness, owner approval or old-writer exclusion. Root/Runner/STOP/host were not changed.

The old ef1 Q102 source declares position and pending optional; an earlier local-state check erroneously required both. Correction d712c29cd4158c666a377d3afa2629628cb270de pinned to the source schema and passed Root 64 synthetic tests (10 skips) plus GitHub Actions success 43969724684. On live Q102, local position/pending keys are absent but local state freshness did **not** meet the 5min threshold; BLOCKED_LEGACY_STATE_OR_FRESHNESS_UNVERIFIED and BLOCKED_OLD_Q102_WRITER_EXCLUSION_UNPROVEN remain. Do not silently reset or assume a stopped writer.

Full provenance: STABLE4_SIGNED_FLAT_AND_Q102_LEGACY_AUDIT_20261117.md. Refresh signed GET just before any formally authorized cutover. Owner deferral of historical research BT DD20% acceptance does not change Q102, STOP or Owner signature requirements.

## 2026-11-17 public H1 20-symbol catch-up: 10 advancing causal observations

- Two source-verified research-only tools have been pushed as 58c070bb3fe415a45d8f381d3455c2f1f7340dff: scripts/stable4-q102-capture-h1-public.mjs (strictly bounded 20-symbol public GET with shared budget, zero trading credentials) and scripts/stable4-q102-advance-offline-h1.ts (copy-only causal observations; no venue API).
- The live VPS SDK pin 7688ed7c... returned **200 consecutive closed hourly market bars across 20 symbols** from 2026-11-16 12:00 to 21:00 UTC. All 20 JSON files transferred to private Owner PC and 20/20 SHA matched. Original rolling source SHA 969626... remains unchanged; new private H1 source SHA 61c0b317f284f54c48bd315a9305c5686192aa1e25bb01e2e747271658774671.
- Root/bootstrap state was NOT installed. A copied 47-completed/5-unresolved Q102 learning snapshot was advanced through 10 causal observation ticks; observedThrough changed from 1794826800000 to 1794862800000; completed recovery 47 and unresolved 5 unchanged, matured pending 0. AVAX separate completed rows advanced from 31 to 33, AVAX pending 4; new public evidence request count 0. New private state SHA 725eea303f6065d1ee199c64ea45f6e6a3c4f4024eca627c077aa843ea4bd480. Repo npm run typecheck PASS. See STABLE4_Q102_H1_CAUSAL_CATCHUP_20261117.md.
- Root candidate source manifest at 58c070bb3: 245 tracked files; unresolved external Root imports 8; dynamic path reviews 7; productionReady=false. Passing off-line H1 does not certify full source closure.
- The latest snapshot is only hour-scoped; refresh H1 and signed venue evidence before any Owner-authorized actual cutover. Old Q102 ef1 Writer still active; no state/position/orders/STOP/systemd mutation and Q102 Root native bootstrap remains deliberately DRAFT_BLOCKED.
- Research historical maximum DD20% acceptance is postponed per Owner. Actual live DD/latch/Shared Risk and the remaining Root/Owner safety gates remain intact.
