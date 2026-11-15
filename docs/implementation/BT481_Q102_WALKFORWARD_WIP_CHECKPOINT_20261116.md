# BT PR #481 — 作業一時チェックポイント（2026-11-16）

## Push対象と範囲

前回のGitHub最新確定コミット `684e469b640ca816ca425a8cf7708b3c3b71e017` までで、Q102旧S1/S2研究6銘柄の人工v5ソース（22日）、180日M5→H1→Native EXITの研究再現、個票のOwner PC非公開保存を終えている。今ターンはユーザーの「一旦ここまでまとめてPush」指示に沿って、次の**未完成Walk-forward検証の土台**を隔離BTブランチにチェックポイントとして保存する。

- `lib/bt-verification/synthetic-market.ts` の人工v5限定最大観測幅を **60,000→70,000 5分tick**に拡張。**v1～v4は53,000のまま**。
- `lib/bt-verification/q102-highvol-frozen-forward-shadow.ts`：前180日閉鎖済みの研究結果を元に、月初前に固定された1研究ルールを**Original Pure Native HIGH_VOL signal/exit API**へ与え、将来月の確定済みH1から入口・出口を研究用に照合する検証関数を追加。元Native generatorの`stage:S1`指定は**テスト専用の仮ラベル**であり、正式S1 stage所属を証明しない。
- 月次ルール未選択の場合、研究候補0・モデル約定0、研究ルールが見つかってもすべて研究用の検証Eventに限定。期間外の入力、完成済みでないH1、学習末より未来の決済、重複1-slot、月末未決済をそれぞれ拒否／打切る設計。
- 対象の追加2ファイルの**単独TypeScript型検査PASS**、既存Q102 180dモデル再生自己テストPASS、`git diff --check` PASS。
- **未完：** 実際の人工将来月を流すForward E2E、モデルEventの照合テスト、月次複数回Walk-forward、10bps/30bps統合、上流S1/S2 Expanded30候補のprovenance、Live/Owner承認。新たなForward勝率・DDや合否はまだ主張しない。これを次回再開タスクとする。

重要：現行Q102やV4の元Runner、取引所、VPS、Codex作業ツリー、HP、正式Approval、注文、建玉、STOP、Kill Switchは今回**変更していない**。PR #481はDraftのまま維持し、本番稼働ソースに取り込まない。

### 次の再開順

1. 新Forward shadowに月初+336H及び対象月分の人工v5 H1を与える独立テストを作る（元コストNormal/Stressと右打切り、Rule freeze、Stage未認証を監査）。
2. Forward結果を非公開個別証拠JSON・SHA256に固定し、月次training以前の情報のみでselectedRuleを選んでいることを因果検査。
3. 研究テストPASS→単独コミット→Push、PR CIを確認。正式S1/S2メンバーシップと本番Fillが未実証の間は実注文・本番経済パリティを主張しない。
