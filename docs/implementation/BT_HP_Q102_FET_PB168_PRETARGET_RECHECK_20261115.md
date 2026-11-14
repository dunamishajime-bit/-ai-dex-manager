# BT #481 — Q102 FET PB168 時系列独立証拠の再監査（2026-11-15）

## 判定

**`PRETARGET_CONFLICT_NO_ROUTE_FREEZE_MODEL_TARGET_DIAGNOSTIC_ONLY`**。Q102 FET `FET|PB168_0.1_P24_0.02_H12` は、対象年（2025-10-01〜2026-10-01）の1件の大きな損失だけで停止・削除してはならない。元研究資料の2025年3〜9月の独立スプリットで、学習区間と検証区間が異なる評価を示すため、方向判定の再学習やLayer 2/3改善は別データで検証する。

| 30bpsの対象年前Proxy | 期間 | サンプル数 | 勝率 | PF |
| --- | --- | ---: | ---: | ---: |
| Train | 2025-03-22〜2025-06-30 | 32 | 40.63% | 0.4133 |
| Validation | 2025-07〜08 | 6 | 66.67% | 2.1325 |
| Prehold | 2025-09 | 4 | 100.00% | 損失0（研究上の999表記） |
| 全Pre-target | 2025-03〜09 | 42 | 50.00% | 0.5095 |

Source: Owner PCの `DIRECTION_RESEARCH_20261109/q102_fet_route_pretarget_freeze_forward_veto_20261112.json`。この研究はBinance FETのpre-target価格Proxyであり、取引所Asterの署名済み約定とは一致保証なし。サンプルが少なく、prehold4勝をもって高勝率とは判定しない。元評価の `freezePretargetOnly=false` を維持。

別の先行しきい値 `ret14 <= 0.048722800378429465` はPre-target全体で native PF1.1387 → gate PF1.1301に悪化しており、**Pre-target因果Gateとして不採用**の既存判断を尊重。対象年の損失を根拠にこの閾値を再採用しない。根拠 `q102_fet_ret14_gate_pretarget_recheck_20261112.json`。

## 統合BT・対象年の再照合

既存の `STABLE4...NATIVE_HYPE_TREND_SOURCE_GROSS_20261115_V1` 研究モデル台帳から、10bps/30bps両ケースのFET PB168モデル約定 **各6件（5勝1敗）** を全件対応付けた。

| モデル費用 | 対象年約定 | 勝ち | 負け | 合計モデル損益（JPY） |
| --- | ---: | ---: | ---: | ---: |
| 10bps | 6 | 5 | 1 | +736,039 |
| 30bps | 6 | 5 | 1 | +257,405 |

負け1件は **2026-09-10 01:00 UTC LONG → 同日07:35 UTC HARD_STOP**。10bps約−698,168円、30bps約−388,868円。この損失は期間の最大DD区間で目立つが、PB168全体6件では純損益プラス。したがって「負けているロジック」と短絡できない。他Runnerと資金競合した時点の機会費用、保有中MTM、発注可能性、経路誤判定を別途調べる必要がある。

## 実装・再現証拠

- `scripts/bt_hp_q102_fet_pb168_evidence_audit.py`：保存済みPre-targetスプリット、PF/勝率/件数/損益算術、研究Gate不採用、元対象年Fill ID/UTC/市場/方向/コストモデル集合/venue非証明をfail closedで検証。
- `tests/test_bt_hp_q102_fet_pb168_evidence_audit.py`：11件の合成テスト。費用別元候補集合、Pre-target欠損や改変、取引所約定証拠を研究台帳へ偽装した場合の拒否を含む。
- Private出力：`C:\tmp\bt481-q102-fet-pb168-pretarg-target-evidence-20261115.json`。SHA256 `B3B79C86AF210CD113FFDD7204B0E94CAACBCDB5604BF0A47DA31FE7842F5A92`。

**このタスクは研究台帳・独立期間の照合のみ。実装変更／LIVE切替判断は未実施**。V4切替はCodex担当、PR #481はDraftのまま。対象年の負け1件を基準とする閾値最適化は禁止。