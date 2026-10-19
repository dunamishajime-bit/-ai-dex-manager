# LONG損失縮小：ロジック別・因果H1検証（2026-10-19）

**STATUS: RESEARCH ONLY — forward shadow required; no LIVE strategy change.**

## 目的と一次ソース

利用した確定ソースは dd1296 final 2026-10-05の13万円複利/1,358 accepted trade台帳 (docs/research/results/dd1296-final-20261005/portfolio-trades.jsonl)。LONGのV12 379件、Q102 29件、HYPE_LONG 27件、RESIDUAL 11件、FET 8件の454件を分析した。PENGUのEXITはユーザー指定どおり変更検討の対象外、V52 LONG 34件は非常に少ない原本損失なので優先対象から除外。

同じPCのAster canonical H1 archive:
C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines

**ATR・BTC・対象通貨のret・相対強度はエントリー時点より前の確定H1だけを使って算出。** 44個のentryフィルターを、2026-05-01前後で分割。原本trade PnL/entry equityの合計に線形の拒否・半ロット効果を計算し、勝ちトレードを失った数も併記。検証は大規模候補探索の事後評価であり、未知相場への再現性や因果的な利益改善を保証しない。

## 各ロジックの優先順位

|LONG|件数|勝ち|負け|勝率|大きな負け|
|---|---:|---:|---:|---:|---|
|V12|379|227|152|59.89%|2026-08-09 ADA (-647,102台帳単位) / 2026-07-27 DOGE (-305,184)|
|Q102|29|18|11|62.07%|2026-07-13 ARB (-784,609) / 2026-05-15 ENA (-93,094)|
|HYPE|27|17|10|62.96%|2026-07-03 HYPE (-649,667: HYPE損失合計の約82.6%)|
|RESIDUAL|11|6|5|54.55%|AVAX 2件、DOGE 1件へ損失集中|
|FET|8|7|1|87.5%|軽微|

ここでのpnlは元データの total_pnl_jpy 列名をそのまま使用（為替・会計評価は別途照合要）。この大きな損失集中は複利後半の資産規模にも影響されるため、フィルター評価にはPnL/entry equityを用いた。

## 検証案A: Q102 HIGH_VOL LONG 固有の利益保護（第一Shadow候補）

Q102の元の accepted trade 29件は、ENTRY原本価格がH1 openと29/29一致。TIME_EXITの約定価格もH1 openと一致。HARD_STOPやTRAILが先行した経路は固定原本EXITを変更せず、Q102_TIME_EXIT のみ新しい「利益確保STOP」仮想経路を再生。

確定H1の有利な高値が一度 entry+5%に達したら、**次のH1以降から entry+3% にLONG sell STOPを設定**。同じ足の高値を見てその足内でSTOPを約定した扱いにはしない。H1の次足で下落した場合はSTOP price以下の最初の約定として評価し、さらに0/0.5/1/2%の不利滑りを引く（2%の滑りなら名目+3%のSTOPでも+1%付近まで圧縮）。

|HIGH_VOL LONG|トレード件数|2%不利STOP滑りのPnL/Equity寄与改善|改善された原本負け|失った原本勝ち|
|---|---:|---:|---:|---:|
|2026-05以前|3件|+8.86088ポイント|2025-12 SUI LOSS→WIN|0件|
|2026-05以降|3件|+4.78570ポイント|2026-07 ARB LOSS→WIN|0件|

上記は全6件中2件のOUTCOME依存で、独立確認の標本不足。大きな有利浮動益から反発し負ける2件の典型を保護。元ONDO大勝などはこのシミュレーションでは早期STOPに掛からなかったが、新しい相場も同じとは限らない。

**全Q102に同じルールを使うのは不採用**。BRK/FET・NEARなど大幅な利益を減らし、利益合計はむしろ下がるケースがある。現行Q102には5m確定足で+2%有利→+0.5%保護の既存Overlayが実装済み（ENV flag次第）。本研究は旧2026-10-05台帳のH1経路であり、現在の5m Overlayと競合なく置き換えられるという認証ではない。正しい5m/venue STOP読戻しで比較すること。

## 検証案B: Q102 LONG BTC弱さによるリスク削減

エントリー前のBTC12h return <= -2.5%で、各期間2件ずつ候補に該当：
- 2026-05以前：負け1/勝ち1。全部見送りの原本損益寄与改善+7.0518ポイント。
- 2026-05以降：負け1/勝ち1。改善+3.4236ポイント。

代替で該当LONGだけGrossを半分にする場合、線形損益寄与は前半+3.5259pt、後半+1.7118ptで勝ちトレードは注文自体として残る（ただし勝ちサイズ半減）。少数4件でありBTC弱さがQ102勝率を本当に改善するかForward Shadowで継続検証。全LONG共通には適用しない。

## 検証案C: RESIDUAL LONG BTC弱さ回避

BTC12h return <= -1%（確定H1）で固定された11件中3件の**原本負けのみ**が該当（2026-05以前2件、以後1件）、原本勝ち除外0件。原本PnL/equity寄与改善は前半+1.6177pt、後半+2.4070pt。ただし独立11件中3件、44フィルター候補探索の後付け選択という過学習リスクが大きい。正式採用ではなくShadow条件とする。

## 棄却案：V12 LONGの一律フィルター・追加連敗Cooldown

V12 LONG 379件に対して、BTC下落、対象通貨の相対弱さ、ATRの43+ルールを比較。2026-05以前310件/194勝、以後69件/33勝の両期間を改善するゲートはなし。BTC12h -1%でvetoすると訓練側 -5.0255pp、後半 -1.9612pp悪化。
連敗2/3/4/5/6回→3/6/12/24hの20条件を、**受け入れて決済が完了したLONGの損益だけで因果シミュレーション**したが、trainを改善した条件なし。6連敗6時間は発火せず差分ゼロ、他は勝ちを失う場合が多い。V12 V4の既存6連敗冷却の変更理由にはならず、追加冷却は不採用。

HYPE LONG n27は弱BTCフィルターの訓練期間で一部負けを除外するが、検証側は発火ゼロ又は大きな勝ちを失うため有効性がない。既存HYPE損失制限は維持し、LIVE設定変更はしない。FET LONG、V52 LONG、PENGU LONG EXITも変更しない。

## 次の認証境界

1. 現行LIVE V12 V4 / HYPE / Q102 Overlayの**正確な SHA・設定・STOP read-back**を確認する。現行5m OverlayによるQ102初期ProfitStopとの因果重複を排除。
2. 5m価格原本がarchive H1 close/openと整合する取引所ソースの確保。保存済みH1と公開Asterの過去5mに価格乖離があるため、5mへの無条件置換は禁止。
3. Q102 HIGH_VOL LONG +5/+3を正式5mソース・手数料/滑り・実STOP優先順位・同時保有・SharedRisk/Margin/partial fillで再計算。
4. OOSは実Forward Shadowで追加独立20件程度のHIGH_VOL LONG候補（母数希少なので期間固定で監視）。良いデータが集まるまでLIVE変更禁止。
5. BRK/PB/REV Q102、一律V12 LONGには同じprofit floorを拡大適用しない。

## 再現とテスト

- research/long_loss_causal_h1_filter_study_20261019.py
- research/long_q102_h1_profit_floor_study_20261019.py
- research/long_v12_causal_loss_cooldown_study_20261019.py
- tests/test_long_loss_h1_causal_research_20261019.py
- docs/research/results/long-loss-research-20261019/LONG_CAUSAL_PREENTRY_LOSS_FILTER_GRID_20261019.json
- docs/research/results/long-loss-research-20261019/Q102_LONG_PROFIT_FLOOR_H1_SIM_20261019.json
- docs/research/results/long-loss-research-20261019/V12_LONG_STREAK_COOLDOWN_GRID_20261019.json

7/7 tests PASS。総合複利JPYと全ロジック最大DDの改善値は**未計算**。この時点でLONG新条件のLIVE採用は行わない。

**結論：SHORT採用は別PRでPush済み。LONGはQ102 HIGH_VOL限定 +5/+3 保護、Q102弱BTC半ロット、RESIDUAL BTC12弱トレード除外の3つをShadow研究候補とする。**
