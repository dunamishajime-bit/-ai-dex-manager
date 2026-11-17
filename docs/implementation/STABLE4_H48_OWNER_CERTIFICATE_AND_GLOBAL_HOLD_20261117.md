# STABLE4切替：H48証明書とGLOBAL保護HOLDの正式経路

## 固定対象
- 候補SHA: `e0e4f1d8f22b62e9410188ef6e590a20e31f760f`
- H48 scope: `HYPE_TREND_LONG`, policy: `H48_TIME_ONLY`
- Plan SHA256: `82d9eb3f4ff4c9787f59c1843a69249e66df6d95696e426b4ee984719ad152ce`
- HP Owner承認ID: `9ae68788-91df-44ac-b616-beb076cf65ff`（読み取り専用確認でAPPROVED）

## Root正式操作
1. `scripts/ops/deploy/disdex_stable4_h48_formal_issue.py`: HP承認operation・source・plan・GitHub実行ID、HP Ed25519署名トークン、候補release内H48政策ソースSHA256を固定検証。root-owned/0444の証明書と監査台帳を一回限り発行。未認証の証明書作成は禁止。
2. `scripts/ops/deploy/disdex_stable4_global_hold_formal_arm.py`: 前段証明書と同一承認証跡を検証後、既存の `inactive/GLOBAL/HOLD_PROTECTED` だけを正式経路で再アーム。旧Kill Switchのdeploy所有・0600、Root証跡、V4 pin、10分graceを維持。別のactive incidentやFLATTEN_MANAGEDを上書きしない。
3. `.github/workflows/disdex-stable4-h48-owner-gates.yml`: master・Owner本人・disdex-productionレビューのみ。既存HP Bridgeから正確な承認をredeem、署名検証し、Root staged source SHA一致を確認して実行。注文・取消・建玉変更・STOP変更、Kill Switch clear、Runner起動/停止、LIVE切替は行わない。

## 実施前の条件と残タスク
- このPRのCI成功後、master統合が必要。Root真正証明書を発行するworkflowは **Root正式切替をすぐ続けられる時点** に限って手動実行する。
- GitHub Actionsで本workflowをmasterから手動起動し、approval_idを指定、disdex-productionレビューを通す。HPの申請有効期限は事前OTPの期限であり、既にAPPROVEDとなった同一identityのOwner承認は継続利用できる。redeem時に300秒の署名トークンを新規発行する。別のGitHub実行IDに既にredeem済みで再発行不能の場合はFail Closedし、正式な新規申請経路を使う。
- Actions成功後、**別途** Codexの正式Root切替を実行。署名付きGET、既存建玉/STOP/V4台帳・heartbeat、旧Q102 Writer排他、Shared Risk・Gross、API予算、systemd/PID/期待SHA、immutable root overlay、rollback、3周期実判定をすべて検証する。
- 保護HOLDは勝手にclearしない。切替できない場合は保護状態を維持して原因・復旧経路を確認する。
- DDの過去研究再設計はLIVE切替後まで延期するが、本番のShared Risk/Kill Switch/DD/STOPは保護する。
