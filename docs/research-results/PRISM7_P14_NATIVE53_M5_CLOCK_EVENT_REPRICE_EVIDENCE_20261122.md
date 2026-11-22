# PRISM VII P14 — 固定source PENGU SHORT V20の53自然ENTRY＋M5時間順Native STOP研究基盤

**RESEARCH-ONLY 完了。** SOURCE pinned SHA `1657e173d250ad58f53e62f7bb0a3428fb405496` から出した SHORT V20 natural53件を元source entry/EXITを含めて **53/53完全一致**させたうえで、別の研究用position/STOP仮想時間順モデルでENTRY後のM5正出来高high/lowとnative純関数を再演した。SOURCE productionコードは変更していない。

事前登録仕様 `PRISM7_P14_PRECOMMITTED_CAUSAL_M5_H1_NATIVE_STOP_EVENT_ENGINE_20261122.md`。

## 設計上の進展

- SOURCEイベント53件のうち、最初の正出来高M5 openを価格代理として採用可能だったもの52件。残1件 `BASE/PENGU_00071` はSOURCE勝ち+6.0367%だがentry予定H1に正印字なし。実注文と同じエントリー価格が実際に成立したとは宣言しない。
- `PENGU_DUAL_LS_V2.short` 設定とsource純関数を研究adapterでimport。STOPルールは固定：**hard +8.0%、trailing は+15%有利に動いた後、前の完了H1の安値から4%戻り**。native H1内で随時過去を更新して都合のよいSTOP価格を作らない。M5印字内の最初のSTOP highタッチで終了イベントを記録し、`max(STOP, M5 open)`を買い戻し価格代理。H1のOHLCを1時間の終わりまで待ち、SOURCE `evaluatePenguDualLsV2PositionBar`を1回呼ぶ。
- SOURCE 53 natural ENTRY全保存。M5正印字がentryより前のバーから出た高値/安値は、position STOP/low-watermarkに反映しない。H1 native STOP相互競合時はsource hard優先、M5足内の順序が不明なケースは`simultaneousStopAmbiguity`フラグで記録。
- SOURCEの非resident decisionは**H1確定後の次H1以降の最初の正印字open**で執行価格代理を用いる。仮にSOURCE関数が同じH1の開始openをexitPriceに設定していても、既に確定したH1のopenへ遡って価格モデル約定したことにはしない。SOURCEの`SHORT_V20_DEADLINE_EXIT`2ケースの同一bar open価格モデル疑義を記録。
- ただし source H1 CloseほかEMA/ATR featureは元H1アーカイブを使用（元H1/M5価格プロバイダー不整合の可能性は残る）。ASK価格・板・実STOP注文・口座risk/grossは依然不明。**M5 barの開始時刻は足内で実際にSTOPをタッチした秒数を表さない。**

## SOURCE元モデルとP14時間順モデルの比較（30bps、追加滑り0）

| 指標 | SOURCE固定native53 | P14 SOURCE signal＋時間順M5研究モデル |
| --- | ---: | ---: |
| 自然SHORT candidate intent | 53 | **53** |
| 価格観測可能 | SOURCE仮想53 | **52** |
| 元source観測可能52件だけの勝ち | 28 | **29** |
| 全53件のSOURCE勝ち | 29 | 価格不明1件（勝ち数に加算しない） |
| 52件内の勝率 | 28/52=53.85% | **29/52=55.77%** |
| 52件内平均PnL（30bps） | **+0.903808%** | +0.858779% |
| PF | **1.334391** | 1.314102 |

52件の条件付き勝率が僅かに高くても、SOURCEの本来のシグナルの勝率を改善したわけではない。初回正印字前の価格を使わず、元SOURCE自然53取引意図から**1件の約定モデルが未成立**である事実を残した。

P14のモデルEXITはhard14、trailing9、maxHold27、deadline2、entry未観測1。観測可能52件のSOURCE元EXIT理由とは一致（未観測1件のSOURCE理由はmaxHold）。H1/M5価格データ差の監査では、**今回トレード保有中の正印字M5と源H1の高値・安値・始値が異なる時間足は累計0件**だった（元PENGU市場全期間の不整合を否定したわけではなく、対象position時間帯に限る）。53件で元source native positionは2,812個のH1 state/m5 stop eventを記録。

30bps＋追加EXIT滑り25bpsだと、52件 **28勝・平均PnL+0.608779%、PF1.213996**（SOURCE元52件の平均+0.903808%、PF1.334391を下回る）。Sourceの勝者が1件、25bps stressで損失に変わる。相場成績が滑り仮定へ敏感である点を明示。

## 検証と再現証跡

- `scripts/research/prism7_p14_m5_causal_native_repriced_stop_core.mjs`（SOURCE unchanged pure state + M5 clock event research）
- `scripts/research/prism7_p14_real53_event_time_source_native_harness.mjs`（固定期間3×源ピン53 matching、M5アーカイブsource SHA、元停止理由比較）
- `scripts/research/test_prism7_p14_native_m5_clock_event_contract_20261122.py` **6/6 PASS**（53件完全一致、53×2 fee×3滑り318 rows、価格印字なしを勝ち扱いしない、H1判定/STOPの時刻因果、元SOURCE設定、venue fillが未証明）。
- all53 total 2,812 event/h1 state logs:
 `docs/research-results/prism-phase2-20261122/PRISM7_P14_NATIVE53_M5_CLOCK_REPRICE_SUMMARY_20261122_EVENTS_53.json`
- 318ケース：
 `docs/research-results/prism-phase2-20261122/PRISM7_P14_NATIVE53_M5_CLOCK_REPRICE_SUMMARY_20261122_SCENARIOS_318.jsonl`
- 検証summary＋源SHA：
 `docs/research-results/prism-phase2-20261122/PRISM7_P14_NATIVE53_M5_CLOCK_REPRICE_SUMMARY_20261122.json`
- 独立再実行でsummary/events/cases 3ファイルのSHA256完全一致：
  - summary `ace5f1d217a033cffe9456d6167fbfbe6cc01dd5ebf21b700b39a589e009edad`
  - 53イベント `6fbcc481379c4fb69d1620dd416181c69cc1bff29efd0656fa4f6892704de104`
  - 318費用 `5f83807a87378f1bf06467f130f9d4a3b714d04bacd87653a238e69101e98e56`

## 今後の方向

これが実行時間整合を図った基盤であり、**PENGU80%やDD<=20%を達成する新戦略ではない**。改良する際は初期SOURCE候補数/勝ち/LONG/SHORT合計経済損益と比較し、元の勝ちを捨てた見かけの勝率を採用しない。未見のカレンダー期間（PENGU March–July 2025など。ただし当該資料が従前の別研究で閲覧済みか注意）でもSOURCE純関数による独立方向検証が必要。

残る課題：H1市場全期間source不一致の根因・取引所ASK/数量/own signed fill・M5足内STOP約定順序・Funding・他RunnerのShared RiskとGross・複利総合DD20%以下。LIVE/master/VPS/Runner/HYPE/実注文/STOP/KillSwitch未変更。PR #595研究Draftのみ更新。
