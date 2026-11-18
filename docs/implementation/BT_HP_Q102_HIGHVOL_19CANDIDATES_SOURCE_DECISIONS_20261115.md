# BT #481 — Q102 HIGH_VOL全候補の時系列・リスクGate・モデル決済照合（2026-11-15）

## 判定

**`FULL_CANDIDATE_DECISION_COVERAGE_NO_INDEPENDENT_OOS_CERTIFICATION`**。Q102の現行source pin `ef1ab178e26a7bf5bddb6473467765edba242e1d` の HIGH_VOL 全19候補を、研究版統合BTの10bps/30bpsの**各採用・遮断decisionとモデルFill**へ漏れなく1対1対応付けた。19候補中、ONDO10・SUI7・ARB2。元candidate19件の入口・モデル出口は2026年7〜9月へ集中しており、このデータだけでは独立したPre-targetまたはOOSの勝率・期待値を認証できない。

| 通貨 | native候補 | 10bpsモデル採用（決済／期末未決済） | 10bps採用決済の勝敗 | 30bpsモデル採用（決済／期末未決済） | 30bps採用決済の勝敗 |
| --- | ---: | --- | --- | --- | --- |
| ARBUSDT | 2 | 2（2／0） | 0勝2敗 | 2（2／0） | 0勝2敗 |
| ONDOUSDT | 10 | 3（3／0） | 1勝2敗 | 4（4／0） | 2勝2敗 |
| SUIUSDT | 7 | 2（1／1） | 0勝1敗＋期末1件 | 2（1／1） | 0勝1敗＋期末1件 |
| 計 | 19 | 7（6／1） | 1勝5敗＋期末1件 | 8（7／1） | 2勝5敗＋期末1件 |

10bpsのモデル決済純損益：ARB 約−841,863円、ONDO約＋690,362円、SUI約−393,620円。30bps：ARB約−373,674円、ONDO約＋535,084円、SUI約−212,728円。これはモデル資本配分が他Runnerの勝敗・発火順により変化した研究台帳のJPY値で、単独ロジックの再現性や本番利益を示さない。

### 非採用理由の再現

10bpsは19候補中12ブロック（ONDO7・SUI5、ARB0）。30bpsは11ブロック（ONDO6・SUI5、ARB0）。理由は`SYMBOL_BUSY`、`DAILY_LOSS_7P5_GATE`、`RUNNER_SLOT_BUSY`。**1つの通貨について時間近接の候補が重複するため、19候補を19独立約定として数えない。** 30bpsの方が採用が1件多いのは、モデル資金/共有Risk判定経路差であり、単純にコストが高い方が成績が良いわけではない。

### 年度末未決済の取り扱い

source candidate `Q102P_00224`（SUI LONG、2026-09-29）は入口採用後、ソース上のモデル出口期限が**2026-10-01の終端を超える**。このため10bps/30bps双方でモデルFillを持たない期末建玉として記録される。ここを架空の決済・勝ち・負けと見なすのは不可。ポートフォリオ複利、未実現MTM、Gross計算では期末開放ポジションを保持する。

## 検証スクリプト

`scripts/bt_hp_q102_highvol_source_admission_audit.py` はAster本番寄りQ102 builder由来の全224候補（そのうちHIGH_VOL19）をsource SHA・source signal ID・source entry UTC・Route・方向・Grossで固定し、STABLE4 native HYPEケースのモデルdecision・entry・Fillを相互照合。全19候補がMODEL_ENTERまたはBLOCKのいずれかで1回だけ登場し、採用後のFillまたは期末未決済の証拠が必須。Fakeの実約定ID・数量・証明フラグは拒否。

`tests/test_bt_hp_q102_highvol_source_admission_audit.py` に合成6テスト。全BT Pythonテスト合計138件PASS。

Private結果：`C:\tmp\bt481-q102-highvol-source-admission-audit-20261115.json`。SHA256 `70D24A01A2B207A655F63843953D1EC55AA17E9BA587C1F55ABDB1B753FEA5C2`。元ソース候補／モデル台帳はPCのみ、GitHubには秘密情報を置かない。

## 次に必要な検証

ARB/SUIの対象年モデル損失だけを見てブロックするのは**結果リーク・過学習**。2025年10月より前の確定済みHIGH_VOL原因変数（高Vol判定の特徴量・閾値・方向情報）の再現、2026年10月以降のAster forward/OOSなど別期間によるDirection + EVの事前freeze検証、閾値揺らし・人工相場・Shared Gross機会費用を検証してから入口レイヤーを見直す。现行LIVE経済パリティ・本番fillについては未証明。V4切替はCodexへ委譲、PR #481はDraft、実注文・STOP変更0件。