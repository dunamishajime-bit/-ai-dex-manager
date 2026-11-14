# BT #481 — HYPE Layer3 同時刻候補のソース照合（2026-11-15）

## 判定

**`SAME_TICK_COMPETING_CANDIDATES_RECONCILED_NO_LAYER3_EV_RANK`**。native HYPE TRENDの入口候補78時刻について、研究統合BTエンジン由来の `DECISIONS.csv` にある同時刻の別Runner候補の**存在**を両コストモデルで照合。HYPE候補78時刻にはHYPE自体の研究判定が各1つ存在し、入口時刻の一致78/78を確認。

| 同時刻の別Runner候補 | 10bps | 30bps |
| --- | ---: | ---: |
| HYPE TREND入口候補 | 78 | 78 |
| 別Runner候補が存在する時刻 | 20 | 20 |
| 別Runner候補件数（時刻重複含む） | 28 | 28 |
| V4候補 | 22 | 22 |
| Q102候補 | 3 | 3 |
| FET候補 | 2 | 2 |
| PENGU候補 | 1 | 1 |

**同時刻のcandidate存在はLayer3の候補集合把握には使えるが、同時刻のMODEL_ENTER/BLOCKの結果は研究エンジンによる判定処理後の**`post-tick`**情報であり、これを入口前に使って勝率・採用価値を選ぶと結果リークになる。** そのため `competitorModelPostTickDecisions` は証拠として保存するものの、`postTickDecisionCannotBeUsedAsCausalEntryFeature=true`、`opportunityRank=null`、`competingCandidateEVAvailable=false` を保持。モデルに実際のvenue約定を認証する能力はない。

これは前段のHYPE Layer2/Layer3 as-of Shadow（`BT_HP_HYPE_NATIVE_LAYER23_ASOF_SHADOW_20261115.md`）に続く追加照合。Layer2は過去に決済済みのHYPE単独モデルだけから参考確率を出すが、V4/Q102/PENGU/FETの過去確定時点のEVや信頼区間は今回も存在せず、**現時点ではRunner間Opportunityの順位付けは認証できない**。単にGrossが空いていることと、その1.0xが最適なことは別問題。

## 再現性・安全性

- 検証コード：`scripts/bt_hp_hype_layer3_competing_candidates_audit.py`。
- 合成テスト：`tests/test_bt_hp_hype_layer3_competing_candidates_audit.py`（6件）、全BT Python検証153件PASS。
- 元入力：PC限定の `bt481-hype-native-layer23-asof-shadow-20261115.json`、STABLE4 native HYPE統合モデル10bps/30bps各`DECISIONS.csv`。
- Private結果：`C:\tmp\bt481-hype-layer3-competitor-source-coverage-20261115.json`。SHA256 `A6E69B7024EE30BFF3CE9E9F96CE6BE21E6DD40561F85AA4889E88E1AB92B0CE`。

## 次工程

各Runner候補の同時刻**以前**で確定した入口特徴・将来を見ないEV・Wilson等の不確実性、価格モデル・実約定リスク、他Runner候補の機会費用を独立期間でfreezeして統一比較する。それができるまで本番エントリー優先順位やGross配分を変更しない。V4切替はCodex担当。PR #481 Draft、実注文・STOP・本番Runner変更なし。