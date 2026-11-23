# STABLE4 DD30 — master統合ソース完了・Codex正式切替手順（2026-11-23）

## 状態の明確な区別

**本資料は切替前に完成したコードを引き渡すものであり、Production LIVEの完了証明ではない。**

- master基準：1eeb864b7b8be2a0279be9ed60af1b9ad234d8ed
- DD30・V4 resident STOP・V52/PENGU/Q102出口修正元：179e3f4e50f86ca8ab60baadaba1a96ed4c914ee（PR #596）
- 新しい候補：prep/stable4-dd30-integrated-source-20261123。最終SHAはこのブランチのコミットHEAD。固定SHAをソースファイルへ自己埋込しない。
- 元STABLE4、V4新規注文DD30%、Crypto Gross3.0、Stock Gross4.0、Total Gross4.25、Shared Crypto日次7.5%。PENGU固有DD17%、既存H48・Funding・STOPを維持。
- 新PENGU独立発火とP100ポイント制は今回採用しない。旧DD21承認の再使用を禁止する。
- DD30研究で全口座最大DDは10bps 31.9963%、30bps 31.6246%。30%以下を保証しない。

## 修正内容 — 新しい単一実行ソースツリー

1. **現行masterを親**にした隔離ブランチを作り、PR #596にしか存在しないV4/Q102/PENGU/V52/FET/HYPE/IDLEのRunner、システム監視、保護STOP、自己テスト、設定など約876ソース/テストファイルを統合。既存masterのHP UI、Owner-goal、Root承認、deploy制御スクリプトは維持。
2. ASTER V3 API、direct-trade-executorを、V4 STOP、Q102/FET、PENGUの必要な条件付き注文、signed fill、margin 5x cross検査、reduce-only型を含む候補版に一致させた。masterの旧V96期限付きOwner overrideを維持するため、V96証跡ではexpiresAt不明を明示拒否。
3. STABLE4 GLOBAL HOLDはQ102が明示opt-inした場合のみ厳密なoperator/scope/理由を検証して認識。既存V96のFLATTEN_MANAGED-only契約は保持。Unknown HOLDや権限上昇はFail Closed。
4. masterで利用するV96/V52基準の旧設定を丸ごと書き換えず、必要なV50定義のみ追加した。masterのNext/Owner UIやpackage-lockはそのまま。
5. V4 resident STOP照合コードの**53a0beハードコードを撤廃**。root-owned runner-pins.jsonのrunners.V12_V4.sha/releaseRoot/serviceUnitに基づき署名台帳、heartbeat、サービスを照合。不正なroot pin、署名不足、STOP不一致はBLOCKED。実行側は一切の注文や取消を行わない。
6. VPSで失敗していたc731 Margin Guardのスクリプト名（disdex_v12_v52_margin_guard_runtime.py）を提供。既存実働版のシリアライズ済みdisdex_v96_v52_margin_guard_runtime.pyへ同じCLIで委譲し、別のrisk/orderロジックを発明しない。
7. STOP診断systemdが旧Shared Risk固定SHAを参照する依存性を解除（ローカルファイル依存のread-only timer）。新releaseへの実際のunit設置はCodex切替時。
8. DD30共通定数と既存STOPを保存。重要なソース20ファイルをSHA256固定して新規のpre-LIVE gateとoffline-only CIにより監査する。

## テスト（ローカル）

- TypeScript全体：型エラー0／PASS
- V4 DD30・署名STOP・EXIT・monitor・Q102 GLOBAL HOLD：91テストPASS
- master Owner-goal・OTP・署名計画・HTTPモック：10テストPASS
- V4 STOP動的pin・Margin Guard wrapper：5 PythonテストPASS
- 20件の重要ソースSHAと非LIVE宣言：5 PythonテストPASS
- V52既存建玉STOP/EXIT（日次損失HOLD中も継続）：6テストPASS
- Q102 H1欠損時の既存保護EXIT、PENGU外国注文のreduce-only EXIT：PASS
- GitHub Actionsの統合専用CIは本ブランチPush後に実行結果を確認すること。Next.js Production build/実取引所エンドツーエンドテストは未実施。

## Codexに残すのは正式切替に不可欠な認証・本番操作のみ

**下記はコード不具合として無断操作せず、正式Root切替トランザクションに含めること。**

1. 正確な新しいGit SHAとsource manifestを検証し、review済みmaster lineageで全必須CIを成功させる。
2. masterの旧c731専用STABLE4 safety-repair workflow/planは使用しない。既存正式Owner-goalの SWITCH_STRATEGY_LOGIC とSTABLE4 scopeに従い、新SHA・新計画・DD30経済変更を含む正確なoperation/scope/plan hashを結びつけてHP Owner承認を取る。旧DD21承認や別の目標署名を流用しない。
3. signed Aster GET×3で全口座建玉0/非ゼロ、未約定注文、resident STOP、所有権、Margin、Shared Risk、現GLOBAL Kill Switchを確認。曖昧な場合はFail Closedを保持。
4. Rootの正式トランザクションで新releaseをimmutable配置し、旧Q102 b8d status=200/CHDIR、旧c731 Margin Guardの欠損script/autorestart、STOP診断旧53a0 pin（/usr/local/libexecの実ファイル）、watchdog stale pinを、現行健全な保護サービスと衝突しないよう**新unitへの整合的切替の一部として**解消。リリースがない古いSHAディレクトリを捏造しない。
5. V4 e788のfull certification未成立テンプレートを強制起動しない。V4/FET等のOperator Activation Gateを満たしてからRunner毎に3周期監視する。まず全Runner order-disabled monitor-only、署名付きSTOP照合と正常なheartbeatを要求。
6. 監視UI release・owner/goal API・immutable source proofが一致してから、Goal承認に合致する**Runner別Order Enable**を正式許可する。異常なRunnerだけFail Closedし、既存建玉保護処理と新規注文判定は分離する。
7. Codexは結果として正式Git SHA、CI、Owner consent、VPS実効各Runner SHA/モード、STOP証拠、order permit、残障害を報告。

### 重要な残る本番現況

- old Q102 b8d missing release：まだVPSに再起動中インスタンスが残っている。新ソースに移すだけではこの古いインスタンスは止まらない。
- old c731 Margin Guard missing script：今回の新ソースでは起動ファイル名が解決したが、VPSの旧c731 immutable releaseは未変更。旧インスタンスを直接継ぎ足し修正せず、正式Root切替に含める。
- 既存V4/FET fail-closed、旧GLOBAL HOLD、Owner署名、UI認証は本番で未変更。これらの解除は本コードPushで行われない。
- STABLE4研究BTと本番エンドツーエンドの完全経済一致（V52歴史L2欠損など）は別途確認する必要がある。無条件の利益予測には使わない。

### 再検証

- scripts/ops/deploy/stable4_dd30_integrated_source_gate.py
- tests/test_stable4_dd30_integrated_source_gate.py
- tests/test_v4_dynamic_resident_stop_and_margin_script.py
- docs/production/STABLE4_DD30_INTEGRATED_SOURCE_MANIFEST_20261123.json
- .github/workflows/disdex-stable4-dd30-integrated-prelive-ci.yml

**STOP取消/再登録、systemd起動停止、Kill Switch変更、実注文、VPSファイル変更、HPのOwner承認操作は一切実施していない。**
