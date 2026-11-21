# PRISM VII P17 — 成熟済みの過去市場だけで逐次学習した24H SHORT方向：予測能力を検証できず、不採用

**判定：REJECT（研究のみ、Production未変更）。** SOURCE pinned PENGU SHORT V20 `1657e173d250ad58f53e62f7bb0a3428fb405496` の全53自然候補・SOURCE純関数のENTRY/EXIT・元29勝24敗を完全保持。結果観測より前に確定した `PRISM7_P17_PRECOMMITTED_ONLINE_24H_SHORT_OPPORTUNITY_CALIBRATION_20261122.md` の固定9入力、SGD logistic回帰、学習率0.03/L2=0.001、24H成熟ラベル以外学習禁止を使用。経済的なLIVEルール変更は実施していない。

## 時間順制約と学習目的

H1 tの完成時点で、最大で24H前の `t−24H` のSOURCE特徴量を、その時点から現在tまで24Hの相場推移で観測できたラベルに照合して1件ずつ学習。新source H1のFEATURE（PENGU24/72h、BTC24h、相対return、EMA72乖離、BTC EMA168、volume、ATR、RSI）から **「この足から24H後PENGUが30bps超下落する確率」** を予測。SOURCE native SHORTの29勝24敗ラベルは**学習に使用しない**。実際のsource native SHORTは最長72H持ち・途中STOPがあるため、24H方向代理学習の予測と同じ目的変数ではない。

53 natural candidateすべて、発火時の一回だけ過去情報で確率を計算し、後から書き換えない。H1 feature prequential prefix一致を3期間×3件=9回検証。SOURCE candidate内のsource PnLやSOURCE winrateは変更なし。

## 結果：予測器は市場勝率ベースライン未満

| 53 PENGU native source SHORTに対する参考指標 | P17 |
| --- | ---: |
| 元SOURCE natural candidate | 53 |
| 元SOURCE本来の勝ち | 29 |
| 予測値の元native勝敗識別 AUC | **0.426724** |
| 24H短期市場方向（別目的）のAUC | **0.485714** |
| 24H方向 Brier score（小さいほど良い） | **0.262790** |
| 比較：過去の確定ラベル割合だけを用いるOnline base-rate Brier | **0.257728** |
| SOURCEの元29勝のうちp>=0.5 | 8 |
| SOURCEの元29勝のうちp<0.5 | **21** |
| SOURCEの元24敗のうちp>=0.5 | 10 |
| SOURCEの元24敗のうちp<0.5 | 14 |

24H市場方向AUCはほぼ0.5で、予測校正Brierは単純な過去の勝率ベースラインより悪い。元SOURCE nativeの勝者29件のうち**21件にp<0.5**という低評価がつくため、p>=0.5をentry許可に使うと、本来の勝ちを大量に排除する。SOURCE loser24件のうちp>=0.5が10件残る。この予測器をSHORT/Long入れ替え、ENTRY抑制、STOPへ組み込むことは不採用。

期間別のSOURCE native勝敗AUC：
- PRE source6件：0.625（小標本）
- BASE source40件：**0.375**
- POST source7件：0.5

学習データを増やして複雑な推論をしただけで勝率が改善するとは限らない。SOURCE勝敗ラベルを持たない24H方向代理を学習すると、最も重要な **「元SHORT V20のEXITにより最終的にプラスとなるか」** と目標がずれ、native SRC実利を下げ得る。

## 再現性

- SOURCE pinsと各H1 gzip SHAを保存、SOURCE自然PRE6/BASE40/POST7 全53/29勝と照合。
- コード `scripts/research/prism7_p17_online_24h_short_opportunity_source53.mjs`。
- 元53個別 ENTRY/prediction/weights/maturedtraining countとSource EXIT実績、native側の学習不使用フラグ
 `docs/research-results/prism-phase2-20261122/PRISM7_P17_ONLINE24H_NATIVE53_PREDICTIONS_20261122.json`。
- summary `docs/research-results/prism-phase2-20261122/PRISM7_P17_ONLINE24H_NATIVE53_SUMMARY_20261122.json`。
- Regression `scripts/research/test_prism7_p17_online24h_source53_contract_20261122.py` **4/4 PASS**、未来学習データ混入・source entry/exit変更・元勝ち捨てを検査。
- 53 predictions / summaryの独立再実行で**SHA256完全一致**：
  - summary `324d19688bf0a77fce27d86794227328ca6b0b25f2a14f3ecb3db7624126636b`
  - 53予測 `54be0cb463b496ac4d55d245ee491370dd6d9b8f165e9c685b88527fefba2e1c`

## 次に必要な改善の方向

これまでP7で元24敗を11「全く順行せず」、7「3%以上順行後に利益全戻し」、6「少しだけ順行して損益負け」の3類型に分類。P9同一過去に未来急反発を与えるだけで元勝ち8件が負けへ反転。P10/P16/P17の一律指標・一律EXIT・単純市場方向学習は不採用。次は**7件の利益giveback**と、それと見た目が似た既存勝ち取引を正確に区別する**SOURCE M5出来高/買い比率/反転時間遷移の因果比較**を優先すべきである。新EXITは元勝ちを壊さないという強い反証を通すまで実装しない。

未観測future OOSと元SOURCE native portfolio複利BTは未完。SOURCE PENGU native勝率≥80%・総合DD≤20%の実証はまだ不可。master/VPS/Runner/建玉/STOP/KillSwitch/実注文/HYPE未変更、PR #595 Draft研究専用。
