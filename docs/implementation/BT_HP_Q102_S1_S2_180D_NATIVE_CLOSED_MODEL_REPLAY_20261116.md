# PR #481 / BT-481-J — Q102 S1/S2 180日モデル決済済み取引台帳の因果再生（2026-11-16）

## 判定

**PASS — 独立人工市場の元ソース由来モデル台帳再現のみ。S1/S2の本番候補・実約定・勝率/DDの経済パリティは引き続きBLOCK。**

以前の`bt-hp-q102-180d-native-monthly-ledger-selftest.ts`の16件は手作り損益のUnit Fixtureだった。今回、同じ固定Native source SHA `7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f`から、(1) 完了H1、(2) `computeQuality102HighVolFeatures`、(3) `matchQuality102HighVolGrid`、(4) Native `simulateQuality102HighVolExit`、(5) Native fee/funding `quality102NetFromGross`、(6) 既存180日月次セレクターへつないだ。元のNativeロジック・閾値やS1/S2 IDは変更していない。

## 事前固定の人工市場・観測結果

- 月次判定：2026-03-01 00:00 UTC。Native学習窓：直前180暦日、終端は2026-02-28 23:00 UTC。336本の追加H1ウォームアップあり。
- 価格経路：テストコードに明記した数式（緩やかな上昇＋160時間周期の下押し/戻り）から生成した**架空の確定済み1時間足**。実Aster相場・STABLE4研究fills・Production現行pinとは別。価格経路を任意に作っているため成績を外部市場へ一般化できない。
- 計測対象：事前に指定した合法グリッド**2ルールのみ**。全288通りのモデル選抜やアップストリームS1/S2ステージ所属判定ではない。各ルールは相互独立な研究シナリオ、同一ルールで保有が重なる候補は再入場させない。
- Native生グリッド一致 **87**、ルール内の重複保有遮断 **60**、月次判定時点までにNative出口を閉じたモデル取引 **27**。モデル右打切り **0**（この人工経路の今回の設定に限る）。
- 各モデルEventに signal/open/close availability、entry価格、exit価格、side、hardStop/trail/72h native出口理由、hold、Gross/Net、source rule keyを記録。Native exit bar timestampはその足の開始時点なので、学習に使える出口時点を **exit bar + 1時間** と保守的に扱った。学習最終時刻を超えるExitは除外する。
- Native月次セレクターは**研究ルール1件を選択**。条件に当てはまったという結果であり、過去の適合結果を使って本番の取引を選んだわけではない。**実S1/S2シグナル0、実注文0、モデルを本番へ反映0**。
- 元のNormal経済費用は片道0.0006 + funding/day0.0002。ユーザー指定の統合10bps/30bps経済条件と混同しない。Native研究台帳をそのまま統合BTへ読み込むことはできない。

## Fail-Closed・テスト

1. 完全な前180日と336Hの事前履歴を必須にし、欠損・重複時間、OHLCの矛盾、余分な未来足、未登録ルール、重複ルールを拒否。
2. Signalの利用はそのH1足と過去だけ。翌時間足のopenでモデル入場、Native出口に使った足の終値確定後だけモデル損益を学習に供給。各Eventを独立に再計算して確かめた。
3. 月次セレクターへ渡すのは確定済み取引のみ。将来の未決済価格から月次ルールや勝率を創作しない。繰り返し決定性も一致。
4. 新テスト `scripts/bt-hp-q102-180d-native-replay-selftest.ts` PASS、既存`scripts/bt-hp-q102-180d-native-monthly-ledger-selftest.ts` PASS。型検査とCIの結果は別途確認。LIVE・STOP・Kill Switch・HP正式反映には一切変更なし。

## 再実行とOwner PC証拠

```powershell
cd C:\Users\dis\disdex-bt481-j-20261116
$env:DISDEX_BT_PRIVATE_EVIDENCE_DIR="C:\Users\dis\disdex-bt481-private-evidence-20261116"
npx --yes tsx scripts/bt-hp-q102-180d-native-replay-selftest.ts
npx --yes tsx scripts/bt-hp-q102-180d-native-monthly-ledger-selftest.ts
```

- 非公開保存：`C:\Users\dis\disdex-bt481-private-evidence-20261116\Q102_S1S2_180D_CLOSED_NATIVE_REPLAY_20261116.json`
- 再生成後の証拠SHA256：`9FCE65B082312DC33D9714EBFC19385392EAAD4E0FA9624DBB54A2E81E6F2932`。コード改変でscript SHAが変わるとJSON SHAも変わるので、必ずその場で再計算する。
- 原個別Event JSONはGitHubへPushしない。コード、テスト、結果の集計、出所説明のみコミット。

## 未完のBT-481-J境界と次Task

実際のQ102 S1/S2のstage1Ids/stage2Ids、全ネイティブルールの前180日Native H1価格・Entry・Exit・venue費用と実約定照合、毎月繰返しのOut-of-Sample、多市場独立検証、Q102 one-slotと他RunnerのPortfolio Opportunity/Shared Risk/Grossへの接続は**まだ未認証**。

次は上流の30件S1/S2 IDとNativeソース/Exit経済の対応を読み取り専用で特定し、証拠不足なら `STAGE_MEMBERSHIP_UNVERIFIED` を維持。人工月次研究27件の勝率・DDを、本番で達成した数値と表示しない。V4本番切替はCodex担当のままとする。
