# HYPE専用SHA 復旧 — Production実行ゲート

**状態（2026-11-08）：候補ステージ済み、切替経路レビュー中、本番切替未実施**

## 固定したリリースと現状

| 項目 | 値 |
|---|---|
| Runner | `HYPE_TREND_LONG` |
| 現行VPS旧SHA | `d6bcc94512a6416189cd92d7203b9ac3b2c98e70` |
| HYPE専用新SHA | `a7eee1f91d86d51f2333da117243d044ae1332dc` |
| 旧systemd | `disdex-hype-long@d6bcc94512a6416189cd92d7203b9ac3b2c98e70.service` |
| 状態 | `inactive/dead`, PID 0、`manualReview=HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT` |
| 原因 | V4の正規 `EXECUTION_REVIEW_RESOLVED` イベントをHYPE旧版が認識できず再生が停止 |
| 修正済みコード | HYPE専用ブランチの PR #452 / PR #453 |
| 新SHA VPS隔離検証 | 59/59テストPASS、V4実台帳10,659イベント再生PASS |
| HP側の承認要求 | PR #454 Draft、対象SHA固定 |
| 本番承認済みか | **いいえ：新SHAのHP OTP認証・正規executorはまだない** |

## 正規の実行経路（完成するまではLIVE操作禁止）

1. GitHub `master` 上で、新SHA固定のHYPE専用承認契約をレビュー。既存 `ALL_RUNNERS_LIVE_RESTORE` の旧SHAや `ordersEnabled=false` 子工程を新SHAのLIVEへ転用しない。
2. Production environment reviewerと、HPの新規メールOTP署名トークンを**同じHYPE操作・SHA・plan SHA256・注文許可**に拘束。切替workflowは本番の読み取り専用preflightを先に実行し、成功時のみOTP承認を引き換える。GitHub Actionsの実行IDを監査証跡として保存する。期限切れ・不一致・再利用は拒否する。
3. 専用root-owned executorは、特定のHYPE実行機構以外に汎用shell実行機能を公開しない。対象を旧SHAと新SHA、Runner `HYPE_TREND_LONG`、監査済み4ファイル差分に固定する。
4. immutable source SHA一致・実行コードのレビュー済みハッシュ・V4全ジャーナル再生（未解決reviewなし）・HYPE旧manualReviewの**既知の正確な理由**・他Runner pin/サービスの不変性を検証。
5. 共有account-order lockを獲得し、そのロックが維持される間に取引所へ署名付き**読み取り専用GETを3回**。HYPE/ZECに建玉・注文なし、XRP SHORT 13.3と既存reduceOnly BUY STOP_MARKETが保護されていることを照合。現在の取引所値が異なれば続行せず、実保有に合わせた別監査を必要とする。過去に確認した値だけでは実行しない。
6. **状態ファイルの無衝突バックアップと原本ハッシュ/CAS**を取得し、既知のmanualReviewだけを解決した監査イベント付きHYPE stateを新SHAとして書く。他Runner state、STOP、建玉、注文、Kill Switch、Shared Riskは不変更。
7. root-ownedの新SHA immutable release、HYPEだけの新pin、systemdの新インスタンス、厳格なoperator activation（署名された新規承認だけ）を照合。稼働前に旧HYPEのPID0を確認し、多重起動を禁止。
8. 新Runner起動後、複数回のhealth tick・mainPID・cwd・release marker・pin/HPデータ連携を検証。保護STOPと他Runnerが不変であることを最終署名GETで確認。1条件でも失敗すれば注文権限を許可せずFail Closedに保持。

## 完了の判定

**`LIVE` と表示してよいのは、HYPE専用新SHAのsystemdがactive/runningで、実mainPID・cwd・release SHA・health tickが一致し、当該Runnerの発注許可・Shared Risk・保護注文が実際に整合している場合のみ。** `mode=LIVE` やGitHubマージだけでは本番稼働ではない。

### まだ残っているブロッカー

- HP正式承認用の新SHA固定PR #454はDraftで、masterと稼働HPへ未反映。
- V4の稼働中の承認は全Runnerのpinを拘束する。V4の正式ゲートに対して、現在のmapは通過し、HYPEだけを新SHAにしたmapは `V4_CANONICAL_OPERATOR_POLICY_BINDING_MISMATCH` で拒否された。HYPE実行処理は両mapを正式ゲートで検証する。この依存を正式に解消するまでは、HYPEのpin変更は不可。
- 共有pending台帳の更新が停止している。未解放エントリは0件。既存サービスが `PENDING_OWNER_CRYPTO_PROTECTION_UNVERIFIED` を返すため、署名付き取引所照合と台帳側の所有権証明を揃え、正規照合サービスを再検証する。
- `disdex_hype_sha_owner_restore.py` と `disdex-hype-sha-owner-restore.yml` は実行経路の候補。VPSのGitHub SSH forced-commandへの正式登録、試験環境での署名付き切替・ロールバック、HP承認の公開が残る。登録時は専用コマンドだけを許可リストに追加し、`validate_forced_command` で完全一致を確認してから引数配列でexecする。
- `.github/workflows/disdex-hype-newsha-source-cert.yml` は**source-only**。検証はできるがデプロイもpin切替もしない。

この文書は監査・設計用であり、新規LIVE発注・STOP取消・Kill Switch解除を許可する文書ではない。
