# STABLE4 切替におけるDD検証延期のOwner判断（2026-11-17 JST）

## 変更判断

Ownerの2026-11-17の明示指示：「DDの条件については切替後に検証するので今回はそのまま切替でいいです。続けて」

**今回のSTABLE4正式切替は、過去研究BTの最大DDが20%を上回ること自体では停止しない。** 最大DDおよびDD復旧条件、研究BTの受入条件、長期再現・OOS・Layer改良等は正式切替後の `POST-ST4-01..07` に繰り越す。これまでの「研究BT DD20%超＝単独の本番切替禁止条件」という**手順上の判断を変更**する。過去の研究監査結果は修正・削除しない。

### 変更するもの

- 切替前 ST4-C04: **研究BTのDD20%合格証明を待つ必要なし**。通貨・ロジック・方向・Gross・H48・出口・状態の**ソース/設定同一性の照合は切替前の必須事項のまま**。過去BTの数字を合格値に読み替えず、失敗事実を記録した状態で本番計画を作る。
- 切替後 POST-ST4-01..07: DD定義・21% V4 latch・復旧条件・source-exact 10/30bps BT・過学習/OOS・誤方向を優先して検証し、段階的に改良。改善結果が本番に自動反映されることはない。
- Owner判断自体は**会話上の作業方針**であり、HP/Actionsの `operation/scope/SHA/plan` 署名・承認トークン・制御スイッチではない。新リリースの署名済み正式承認を捏造しない。

### 絶対に変更しないもの

- 本番Runtimeの既存の**最大DD停止・保持ロジック、日次Shared Risk 7.5%、Gross上限、Kill Switch**。元本やhigh-water markの書き換え、DD latchの解除/リセット、損失状態の隠蔽をしない。
- 既存建玉とresident STOP、EXIT継続経路、reduce-only、単一Writer、旧Q102のEXIT/STOP保護を維持。新旧Runner二重発注、未承認のテスト注文・取消・手動決済を禁止。
- 外部Rootのソース・動的loader検証、Q102のWriter排他・Native state transaction、公開データ/学習の出典整合、Fresh signed venue GET、API budget、Ownerスコープ認証、Rollback、稼働決定tickの照合は**引き続き切替前に必須**。
- Research Gross Crypto3.0x / Stock4.0x / Total4.25x / V4 exception4.75x、H48 time-only/no resident STOPは**経済的変更**なので、採用する正確な対象範囲・コミット・Owner承認を正式経路で確認する。前回承認の単純な再利用や本番の既存保護を飛ばすことはない。

### 研究結果の状態表示（変更せず記録）

- 2025-10-01 00:00 UTC ～ 2026-10-01 00:00 UTC（終端除外）、初期JPY10,000、研究版統合モデル
- 10bps: 最大DD 21.571152%、795取引、勝率63.899371%
- 30bps: 最大DD 22.281591%、791取引、勝率61.820480%
- **いずれもDD20%には不合格。Owner判断により、研究DD数値による切替延期のみ解除。** 本番の実測DDが20%以内で済む保証はない。Source-exact LIVE parityやOOS合格を示すものではない。

## Codex実行順序

1. Root 21モジュール/4動的loader、candidate Git 245ファイル/外部Root import8件/動的path7件の差分を最新HEADで再生成・解消（うち外部RootはGitのみで完結と偽装しない）。
2. Q102 旧Writerとnew Nativeの排他・state transaction/rollback、52 pending outcomesを確認。新規保留機構が安全に切替可能になるまでは`DRAFT_BLOCKED`を維持。
3. Signed venue GETで既存建玉/STOP、Runner PIN・PID・cwd、Shared Risk、Gross・H48契約、Owner署名を確認する。
4. CI、不可逆操作の保護、Rollbackと承認計画を完成し、GitHub Actions → HP Owner承認 → Codex正式切替へ。実際のLIVE切替前に新しい本番source/planに対する承認状態を必ず確認。
5. 切替後に実際のdecision tickを3周期以上検証し、今回延期したPOST-ST4-01..07を開始する。

**ステータス: OWNER_RESEARCH_DD_PRECUTOVER_EXCEPTION_RECORDED. まだLIVEや正式承認ではない。**
