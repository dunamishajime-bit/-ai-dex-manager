# HYPE専用SHA 復旧 — Production実行ゲート

**状態（2026-11-08）：実装候補検証済み／本番切替未実施**

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
| 新SHA VPS隔離検証 | 59/59テストPASS、V4実台帳10,637イベント再生PASS |
| HP側の承認要求 | PR #454 Draft、対象SHA固定 |
| 本番承認済みか | **いいえ：新SHAのHP OTP認証・正規executorはまだない** |

## 正規の実行経路（完成するまではLIVE操作禁止）

1. GitHub `master` 上で、新SHA固定のHYPE専用承認契約をレビュー。既存 `ALL_RUNNERS_LIVE_RESTORE` の旧SHAや `ordersEnabled=false` 子工程を新SHAのLIVEへ転用しない。
2. Production environment reviewerと、HPの新規メールOTP署名トークンを**同じHYPE操作・SHA・plan SHA256・注文許可**に拘束。GitHub Actionsの実行IDを監査証跡として保存。期限切れ・不一致・再利用は拒否。
3. 専用root-owned executorは、特定のHYPE実行機構以外に汎用shell実行機能を公開しない。対象を旧SHAと新SHA、Runner `HYPE_TREND_LONG`、監査済み4ファイル差分に固定する。
4. immutable source SHA一致・実行コードのレビュー済みハッシュ・V4全ジャーナル再生（未解決reviewなし）・HYPE旧manualReviewの**既知の正確な理由**・他Runner pin/サービスの不変性を検証。
5. 共有account-order lockを獲得し、そのロックが維持される間に取引所へ署名付き**読み取り専用GETを3回**。HYPE/ZECに建玉・注文なし、XRP SHORT 13.3と既存reduceOnly BUY STOP_MARKETが保護されていることを照合。現在の取引所値が異なれば続行せず、実保有に合わせた別監査を必要とする。過去に確認した値だけでは実行しない。
6. **状態ファイルの無衝突バックアップと原本ハッシュ/CAS**を取得し、既知のmanualReviewだけを解決した監査イベント付きHYPE stateを新SHAとして書く。他Runner state、STOP、建玉、注文、Kill Switch、Shared Riskは不変更。
7. root-ownedの新SHA immutable release、HYPEだけの新pin、systemdの新インスタンス、厳格なoperator activation（署名された新規承認だけ）を照合。稼働前に旧HYPEのPID0を確認し、多重起動を禁止。
8. 新Runner起動後、複数回のhealth tick・mainPID・cwd・release marker・pin/HPデータ連携を検証。保護STOPと他Runnerが不変であることを最終署名GETで確認。1条件でも失敗すれば注文権限を許可せずFail Closedに保持。

## 完了の判定

**`LIVE` と表示してよいのは、HYPE専用新SHAのsystemdがactive/runningで、実mainPID・cwd・release SHA・health tickが一致し、当該Runnerの発注許可・Shared Risk・保護注文が実際に整合している場合のみ。** `mode=LIVE` やGitHubマージだけでは本番稼働ではない。

### まだ残っているブロッカー

- HP正式承認用の新SHA固定PR #454はDraftで、masterへ未反映。
- **新SHAのHP OTPを検証・引き換えたあとだけ動くroot-owned実行処理は未実装。** 実行コード作成が安全チェックで拒否されたため、別経路で迂回しない。
- `.github/workflows/disdex-hype-newsha-source-cert.yml` は**source-only**。検証はできるがデプロイもpin切替もしない。

この文書は監査・設計用であり、新規LIVE発注・STOP取消・Kill Switch解除を許可する文書ではない。
