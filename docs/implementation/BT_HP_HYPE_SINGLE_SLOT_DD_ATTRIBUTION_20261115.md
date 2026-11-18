# BT #481 — HYPE TREND単独モデルのDD・勝敗要因の独立再検算（2026-11-15）

## 再現した範囲

ユーザーPC上の保存済み **旧pin本番系HYPE TREND単独・single-slot、Funding近似を含む研究台帳**を再計算した。現行native HYPE TREND H1の78発火候補と元モデルの56採用取引を `start/end/exitReason` で相互照合。採用された56件は78候補にすべて含まれ、同じHYPE単独モデル内で重複保有期間はない。10bpsと30bpsで採用取引のtimestamp集合は一致。

| 指標 | 10bps | 30bps |
| --- | ---: | ---: |
| 研究モデルの入口候補 | 78 | 78 |
| モデル採用・決済取引 | 56 | 56 |
| 勝ち／負け | 15勝／41敗 | 15勝／41敗 |
| 勝率 | 26.79% | 26.79% |
| 最終口座残高（1万円開始） | 10,180.11円 | 8,856.34円 |
| 最大実現DD | -19.32% | -23.26% |
| 平均勝ち損益（口座比） | +5.0835% | +4.8242% |
| 平均負け損益（口座比） | -1.7541% | -1.9987% |
| 最大1取引損失（口座比） | -1.9089% | -2.0228% |
| モデル内Fundingイベント数 | 51 | 51 |

DD最大時点：**2026-04-13 14:25 UTC、26番目のモデル採用取引**。2026-02-03 03:35 UTC（6番目の取引後）の残高ピークから底まで20取引で**2勝18敗**、最長10連敗。大型損失1件ではなく連敗が主要要因。したがって単純なSTOP縮小ではなく、相場環境別の誤発火と他RunnerとのOpportunity機会費用を、時点以前情報だけを使い見直す。

## 検証方法

`scripts/bt_hp_hype_single_slot_loss_audit.py` はモデルを再計算し、各tradeの `netWalletReturn = gross×rawReturn + feeWalletReturn + fundingWalletReturn`、費用率10/30bps、各取引後複利口座残高、最大DD・勝率・Funding件数、元候補exitの対応、single-slotの非重複、両コストケースの採用集合を照合する。意図的に改ざんした台帳・重複・未知候補・ズレたコスト・日付を拒否するテスト `tests/test_bt_hp_hype_single_slot_loss_audit.py` を11件追加。

オフライン監査で使用したPC原台帳：`C:\tmp\disdex-bt-20251001-20261001\hype-aster-historical\hype-20251001-20261001-standalone-funding-aware-model.json` と `hype-trend-pinned-candidates.json`。

非公開の計算結果：`C:\tmp\bt481-hype-single-slot-loss-attribution-20261115.json`。

結果SHA256：`2F9EB7F72EF3A1477476A8DBC32BA67A42F9D6CE103589E8CC72CFCBB159C458`。

## 注意

全78候補のモデル上の出口は前段監査で再現済み（`BT_HP_HYPE_NATIVE_EXIT_CONTRACT_RECONCILED_20261115.md`）。そのうち56件が採用されたことは、現行のShared Risk、Gross、他Runner、HYPE owner state、損失上限、実約定可否を通ったことを意味しない。これは**単独研究モデルの検算**であり本番成績・経済パリティ・改善済みという意味ではない。30bpsのDDは許容20%を超過。

次の研究は連敗区間を根拠に閾値をフィットさせるのではなく、別期間／walk-forwardで入口候補のregime分解を前向きに検証し、他ロジックとの配分を含めて10/30bps統合BTを再計算する。V4切替は引き続きCodex担当で本監査から変更しない。