# DisDex: 目的単位のOwner承認 v1（候補 / 本番未適用）

## 目的

一度HPで承認した**作業目的**（停止RunnerのLIVE復旧、指定ロジックへの切替）が変わらない限り、修正によってコードSHAや実行計画が変わってもOwner OTPを繰り返さない。

- Owner承認は `goalId` と一意の `goal.fingerprint` に紐付く。
- 不変: kind、operation、Runner scope、strategyId（切替時）、対象HP、注文権限上限、fail-closed profile。
- 可変: 候補ソースSHA、実行Plan SHA-256、CI Run ID、GitHub Actions Run ID。毎回個別の証拠と短期署名が必要。
- 有効期間: 本人が取り消すか成功完了まで。放置中の実取引権限を意味しない。新規署名はCI・保護ゲート成立時のみ。
- 注文禁止の承認から orders=true を発行しない。別のRunner/ロジック/目的/注文上限への拡張は別の目的。
- HYPE H48の例外、STOP解除、Kill Switch迂回、保護Environmentの自動承認は**対象外**。

## 典型的なフロー

1. 操作者は `publish_goal` で kind、operation、subject、切替対象の strategy_id を宣言し、Ownerに目的を表示する。すでに同一 `goalId` が承認されていれば新しいOTPを送らない。`get_goal_status` で状態を照合する。
2. HPでOwnerがOTPを**一度だけ**認証する。これはコード実行トークンではない。認証IDと `fingerprint` をチェックポイントに保存し、秘密情報は保存しない。
3. 開発中の修正は任意の回数行える。目的・権限・安全条件を明記し、`sourceBinding: "GITHUB_RUN_HEAD_SHA"` を持つJSON計画を `docs/implementation/goal-campaigns/<goalId>.json` にコミットする。計画にそのコミット自身のSHAを書き込んではならない（自己参照ハッシュになる）。Push後に候補SHAのCIを実施し、HP側でGitHub Run head_shaと計画が置かれたcommitを一致検証する。
4. 保護されている正式Workflowで `claim_goal_release` を呼び出す。引数: `goal_id`, `run_id`, `ci_run_id`, `target_sha`, `plan_sha256`, `orders_enabled`。
5. HPはGitHub APIを読み取り、該当CIのhead SHAとsuccess、信頼できる不変Workflow、実際の計画ファイルのSHA-256と目的・権限・安全条件を確認した後にのみ、該当候補SHAと計画に有効な**最大300秒の署名トークン**を発行する。
6. 正式Workflowはこのトークンを既存の署名検証・Root gateへ渡す。Runner／建玉／STOP／Shared Risk／HOLD／手数料・Gross等、対象運用に必要な安全条件を全て検査する。
7. 不成功の場合は `finish_goal_release` に `outcome=failure` を記録し、同じ `goalId` で修正を続ける。完了した最後の成功のみ `outcome=success, final=true` として目的を閉じる。本人はHPから取り消し可能。

## CI/証跡

- 信頼される候補CI：`.github/workflows/disdex-owner-goal-candidate-ci.yml`（読み取り専用）。
- SHAを変更したらCI Runと計画ファイルハッシュを更新する。目標Fingerprintは変わらない。
- 同じ目的でも変更がリスク・権限・Runner対象を広げた場合は `GOAL_PLAN_OUTSIDE_APPROVED_PURPOSE` 等で fail-closed。
- CI成功は本番稼働の保証ではない。本番の Root preflight/Build manifest/Operator permit/保護Environment が別途必要。
- CIは候補コミットで実行するため、不正なテスト置換やリスク変更も発見できるよう、正式統合前に独立安全テストと特定差分レビューを追加すること。

## Rollout gate（すべて満たすまで本番では利用しない）

- [ ] TypeScript / 目的・認証・Redis並列台帳の回帰テスト PASS
- [ ] 同一目的：SHA・plan変更時の2回目OTP **0回**をE2E確認
- [ ] 他のRunner／strategyId／権限拡大／無効CI／改ざんPlan：署名 **0件**
- [ ] Owner取り消し／完了後：新規署名 **0件**
- [ ] 保護Environment + exact SHA署名検証 + nonce replay防止 + fail-closedを維持
- [ ] 必須BT、Production実装照合、保護STOP・建玉・Shared Risk・Kill Switch前後照合
- [ ] 正式GitHub Actionsの個別切替Workflowから `claim_goal_release` を実際に利用（旧 `redeem` の目的承認への適用は禁止）
- [ ] 署名付き証跡を確認したうえで正式にHP・VPSへ反映

**重要:** 開発者への一般的な作業許可は、Owner OTPやRoot実取引許可の代替ではない。署名済み古い実装に無関係なSHAを流用しない。目的一致を示すだけの自己申告を認めない。
