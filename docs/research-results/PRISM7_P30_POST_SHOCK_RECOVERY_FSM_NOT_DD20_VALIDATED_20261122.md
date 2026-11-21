# PRISM VII P30 — 急落後の買い回復を完了M5で確認してからEXIT。下落継続の勝者を守るが実データでDD20%未達

**研究名 PENGU_S4_RECOVERY_CONFIRMED_EXIT_V1。本番採用禁止。** 元SOURCE pinned 1657e173d250ad58f53e62f7bb0a3428fb405496の自然V20 53件は別に保持。S4新研究構造120セットアップ・完了21/元15勝/右打切り1、REFERENCE_STOP72、P25元source shock検出120件を不変更で使用。結果取得前GitHubへ固定した仕様 docs/research-results/PRISM7_P30_PRECOMMITTED_POST_SHOCK_BUYER_RECOVERY_FSM_AND_FALSE_BOUNCE_20261122.md に準拠。

## 状態機械の構造

1. 既存P25クロスアセットCAPITULATION検出までは完全同一。
2. 急落確定後、PENGU/BTCの**新たに確定した同時刻5M**のみ監視。PENGU CLOSEが元SHOCK CLOSEの**+1%以上**かつその5Mは陽線、BTC CLOSEが元SHOCK BTC CLOSEの**+0.5%以上**。確認まで最大2時間。異常な無印字期間はシグナルにならない。
3. 条件成立した5M CLOSEが確定して初めて次状態RECOVERY_CONFIRMEDへ遷移。次以降1本/2本目の正出来高PENGU M5のOPENを買い戻し価格代理（STOP先着は元SOURCE優先）。10bps/30bps手数料、追加100/1000bps滑りを固定ストレス。
4. 反発確認がない場合は元REFERENCE_STOP72をそのまま残し、下落が進む勝ちSHORTを早期EXITで壊さない。元H1 setup120とENTRYはすべて保持。REFERENCE_STOP72は独立研究の共通参考出口であり、元SOURCE native SHORT V20本来のphase/STOPの完全再現ではない。

## 1. 同じ過去→異なる人工未来96本（1152ケース、実際の未見OOSではない）

元P29のRECOVER_FAST / CONTINUE_DOWN / CHOPPY_REBOUNDに、新たに**FALSE_BOUNCE_DUMP**（買い反発の後に再下落）を設計・事前登録。4未来×8決定論的位相seed×3印字マスク=96人工価格経路、1/2正印字EXIT遅延×2手数料×3追加滑り=1152件。2025Oct既知のsource event発生までの過去PENGU/BTCは全ケース固定。人工未来の成績を本人市場予測能力や独立OOSと誤称しない。

30bps/追加0/回復確定後1本目正出来高M5における人工経済meanは以下（全て同じentry価格の1件の人工参考SHORT）：

| 人工未来 | SOURCE参考STOP72 | P25無条件早期EXIT | **P30回復を待ってEXIT** |
|---|---:|---:|---:|
| 急回復 RECOVER_FAST | +31.816% | +55.485% | **+50.327%** |
| 下落継続 CONTINUE_DOWN | **+80.703%** | +55.485% | **+80.703%** |
| 断続反発 CHOPPY_REBOUND | +52.089% | +55.485% | **+53.611%** |
| 一度反発→再下落 FALSE_BOUNCE_DUMP | +47.483% | +55.485% | **+50.967%** |

CONTINUE_DOWN人工世界では3印字マスクいずれも回復確認なし、次のEXITを発動せず元勝ちSHORT利益を全8seedで維持した。印字が60分ごとのケースではRECOVER_FASTは8位相のうち5位相で回復シグナルが確認できたがSOURCE STOP先着が起きたため新EXITは0件；バーが存在しない時点を勝手に約定にしていない。ただしFALSE_BOUNCE_DUMP参考SOURCEにわずかな利益差しかないのは**この人工価格とREFERENCE_STOP設計の帰結**。買い反発直後にさらに大暴落して売りが有利になる二世界を排除したわけではなく、P31で強い反例を確認すべき。

## 2. 実SOURCE PENGU/BTC M5に適用すると利益/リスクは劣化

元SOURCE2025-10-10の急落直後PENGU 21:20 UTC CLOSE0.009588では回復未確認、21:25 UTC M5 CLOSE **0.013801** とBTC **109076.5** が初めてP30固定条件を満たす。21:30 UTCまでの完全確定データを待った後、買い戻しM5 positive OPEN価格代理は**1本目21:30 = 0.015800 USDT、2本目21:35 = 0.017030 USDT**。元P25無条件2本目21:25 OPEN0.010100 USDTより高い。実市場のASK板/成行数量はなくsignedFill証拠なし。

30bps、源SOURCE120 setupを全て保持し単一slot21決済/15勝＋right-censored1。SOURCE 30bps+追加滑り0、共通REFERENCE_STOP72：

| 研究形式 | 単発P25既知イベントをいつ買い戻したか | SOURCEモデルmean net | PF | M5-close未実現含む最大DD |
|---|---|---:|---:|---:|
| P22 no shock EXIT | SOURCE trailing22:00 0.020007 | +4.93363% | 3.90560 | 35.94150% |
| P25無条件2nd positive M5 | 21:25 0.010100 | **+7.01950%** | **5.13405** | **21.95877%** |
| P30回復確認後1st M5 | 21:30 0.015800 | +5.81939% | 4.42726 | **25.22993%** |
| P30回復確認後2nd M5 | 21:35 0.017030 | +5.56042% | 4.27474 | **28.36167%** |

元P25のsourceBTC PENGUショック確定1件、源S4 H1 setup120、単一slotのSOURCE状態、STOP時刻はすべて不変更。追加1000bps滑り（回復確認後1本目）では平均+5.48673%、PF4.23134、M5 DD29.25282%。**元勝ちを保護しようと確定情報を待つほど、実市場の短時間反発時には購入価格とDDが悪化した。** この差を隠してP30改善達成と主張しない。

## 判定・再現性

- Source original case120＋CROSS_ASSET shock検出イベント120/当該1件を回復確認段階化して以外は同値。
- 研究コード scripts/research/prism7_p30_postshock_recovery_fsm_identical_prefix_futures_20261122.py と scripts/research/prism7_p30_real_source120_recovery_confirmed_20261122.py。
- 回帰 scripts/research/test_prism7_p30_recovery_fsm_96_identical_prefix_artificial_20261122.py **6/6 PASS** と scripts/research/test_prism7_p30_real_source120_m5_recovery_confirmed_20261122.py **6/6 PASS**、合計**12/12 PASS**。
- Github JSON+全個票：
  - docs/research-results/prism-phase2-20261122/PRISM7_P30_RECOVERY_CONFIRMED_96_FUTURES_SUMMARY_20261122.json
  - docs/research-results/prism-phase2-20261122/PRISM7_P30_RECOVERY_CONFIRMED_1152_SYNTHETIC_CASES_20261122.csv
  - docs/research-results/prism-phase2-20261122/PRISM7_P30_REAL_SOURCE120_RECOVERY_CONFIRMED_SUMMARY_20261122.json
  - docs/research-results/prism-phase2-20261122/PRISM7_P30_REAL_SOURCE120_RECOVERY_EVENTS_20261122.json
  - docs/research-results/prism-phase2-20261122/PRISM7_P30_REAL_SOURCE120_1440_SCENARIO_LEDGER_20261122.csv
- 全SOURCE H1/M5 PENGU/BTC raw SHA/元P25source SHAを結果に固定。

**P30の人工反証では「下落継続時に不適切な早期EXITを防ぐ」方向に進歩したが、実データのDD20%未達・人工未来/元SOURCE歴史は既知・通貨他Runnerの実口座DD不明・ASK/orderbookとsigned fills未検証。P30をProductionへ反映しない。**

master、VPS、Runner、STOP、実注文、建玉、SharedRisk、HYPE、Kill Switch不変更。Draft PR #595研究のみ保存。
