# 最新8ロジック LONG/SHORT出口改善・最終統合BT研究報告 (2026-10-19)

**STATUS: 研究上の全範囲の再実行結果。V52実株5mデータ不足および実取引所STOP認証未完了のためLIVE認証ではない。**

- 2025-08-10〜2026-08-10、初期1万円、追加積立0、複利。現行実運用成果を示すものではない。
- 統合8ロジック同時ポジション・優先順位・共有Gross・複利口座MTM-DDを毎案で再計算。
- 10bps/30bps往復相当コストでDDと損失を比較。候補のSTOP約定滑りを別に0/1/2%で検証。
- PENGU LONG/SHORT既存出口は意図的に維持。戦略・入口・LIVEに変更を加えていない。
- 因果H1研究7件および独立M5 STOP投影単体テスト8件は計15/15 PASS（実venue証明ではない）。

## 統合BT：原本と採用条件累積後

| コスト | 原本最終資産 | 累積最終資産 | 原本最大DD | 累積最大DD | 取引数 | PF |
|---|---:|---:|---:|---:|---:|---:|
| 10bps | ¥222,818,967 | ¥222,818,967 | -15.620600% | -15.620600% | 1310 | 3.4588 |
| 30bps | ¥124,289,207 | ¥124,289,207 | -16.787800% | -16.787800% | 1307 | 3.0786 |

研究上の採用条件（滑り耐性0/1/2%）：**新規追加なし**。

## 方向別検証判定

| 対象 | 利益保護/初期逆行単独 | 同時組合せ | 結論・補足 |
|---|---|---|---|
| HYPE LONG | HYPE 1.5%初期STOP：滑り耐性不合格 | 候補の滑り耐性不合格 | 0%でのみ損失削減、1%/2%では逆転 |
| RESIDUAL LONG | 不採用 | 複合案不採用 |  |
| Q102 LONG | 不採用 | 複合案不採用 |  |
| V12 V4 LONG | 不採用 | 複合案不採用 |  |
| Q102 SHORT | 不採用 | 複合案不採用 |  |
| V12 V4 SHORT | 不採用 | 複合案不採用 |  |
| Idle SHORT | 不採用 | 複合案不採用 |  |
| FET LONG | 不採用 | 複合案不採用 |  |
| V52 LONG | 欠損のため採用判定不可 | 検証対象外 | 5m観測有効 16/35。比較未成立 |
| V52 SHORT | 欠損のため採用判定不可 | 検証対象外 | 5m観測有効 32/52。比較未成立 |
| Idle LONG | 元の受理取引0件 | 検証不要（受理0） |  |
| RESIDUAL SHORT | 元の受理取引0件 | 検証不要（受理0） |  |

## 勝ちトレードと平均負けへの影響 (10bps・全体採用系列)

|戦略方向|元勝数|累積勝数|元平均負け（エントリー時口座比）|累積平均負け|元最悪負け|累積最悪負け|
|---|---:|---:|---:|---:|---:|---:|
|FET_LONG|7|7|-0.335%|-0.335%|-0.335%|-0.335%|
|HYPE_LONG_LONG|11|11|-2.059%|-2.059%|-2.169%|-2.169%|
|IDLE_SHORT|44|44|-0.762%|-0.762%|-2.688%|-2.688%|
|PENGU_LONG|35|35|-4.132%|-4.132%|-8.130%|-8.130%|
|PENGU_SHORT|15|15|-2.598%|-2.598%|-8.089%|-8.089%|
|Q102_LONG|24|24|-2.565%|-2.565%|-6.047%|-6.047%|
|Q102_SHORT|115|115|-2.225%|-2.225%|-7.616%|-7.616%|
|RESIDUAL_LONG|15|15|-2.387%|-2.387%|-5.649%|-5.649%|
|V12_LONG|120|120|-0.243%|-0.243%|-1.096%|-1.096%|
|V12_SHORT|491|491|-0.545%|-0.545%|-3.835%|-3.835%|
|V52_LONG|31|31|-0.307%|-0.307%|-0.519%|-0.519%|
|V52_SHORT|40|40|-0.347%|-0.347%|-2.039%|-2.039%|

平均負けは損失取引ごとのPnL/エントリー時点の口座資産の単純平均であり、口座全体のMTM-DDとは異なる。

PENGU LONG/SHORT：出口変更は行っていない。

## HYPE LONG 1.5% wallet STOP：不利なSTOP約定滑りの影響

| STOP不利滑り | 10bps損失削減（entry equity比の累積pt） | 30bps同 | 最大DD変化 |
|---|---:|---:|---|
| 0% | +4.6967pt | +5.2294pt | 10/30bpsとも変化なし |
| 1% | -1.3495pt | -1.1955pt | 10/30bpsとも変化なし |
| 2% | -7.7018pt | -7.1632pt | 10/30bpsとも変化なし |

**1%と2%で負け総量が悪化するため、HYPE1.5%案は今回の正式累積基準には採用しない。**

## ソースの限界と認証に必要なもの

- V52株式ロジック5m足の利用可能範囲はLONG 16/35、SHORT 32/52。エラーをゼロ変化と誤認して採用しない。
- バックテストは確定5m足と過去H1データ。実約定の板・MarkPrice・Partial fills・Funding差異や実resident STOP読み戻しは認証していない。
- 独立holdoutとForward Shadowがないため、過剰最適化のリスクがある。LIVEロジックの自動切替は行っていない。
- 営業日の長期株式M5やYahoo Financeの同じ欠損期間が完全再現できる一次データでV52を再確認すること。

## 再現に使ったコードとエビデンス
- research/sequential_remaining_8_sides_20261019.py
- research/sequential_robust_oct17_baseline_sweep_20261019.py
- research/sequential_hype_stop_slippage_20261019.py
- research/sequential_combined_robust_baseline_20261019.py
- tests/test_sequential_exit_projection_20261019.py
- tests/test_long_loss_h1_causal_research_20261019.py
- docs/research/results/long-loss-research-20261019/SEQUENTIAL_STEP05_TO_12_CUMULATIVE_20261019.json
- docs/research/results/long-loss-research-20261019/SEQUENTIAL_ROBUST_BASELINE_9SIDES_20261019.json
- docs/research/results/long-loss-research-20261019/SEQUENTIAL_COMBINED_ROBUST_TWO_AXIS_AND_HV_20261019.json
- docs/research/results/long-loss-research-20261019/SEQUENTIAL_HYPE_LONG_1P5_STOP_SLIPPAGE_20261019.json
