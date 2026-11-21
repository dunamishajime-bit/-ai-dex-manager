# PRISM VII P27 — P25の残存DD21.96%を別トレードに分解：負けの誤SHORTではなく未実現益ピークの失効

P24で判明した2025-10-10の一時急落CAPITULATION利益捕捉を、P25研究用state/遅延第2positive M5で独立に再現しても、まだ**SOURCE public M5 close DD21.958773%**（P26の直前完成M5ピークに対する時間順HIGH DDも21.958773%）の不合格が残る。今回、元のS4固定120構造setup＋21価格代理完了＋1右打切りを完全維持したまま、ピークの元取引と後の谷を特定した。

## 本当の時系列（1万円・単一PENGU 1倍・30bps総費用の研究価格代理）

| UTC日付 | 取引ID | 元SOURCE価格/資産 | 意味 |
|---|---|---|---|
| **2026-06-04 02:00** | **`S3_07302`** | positive M5 CLOSE PENGU `0.006426 USDT`、参考NAV **35,033.39円** | 当時保有中SHORTの**未実現益ピーク**。元entry `0.007601` に対して最大有利M5 LOW15.46%を記録。SOURCE reference trailingで後に `0.006963`でEXIT、元entry資金30,421.89円→現金32,884.13円の**利益取引** |
| **2026-10-13 06:30** | **`S3_10500`** | PENGU M5 CLOSE `0.008028 USDT`、参考NAV **27,340.49円** | 前述の6月のピークから**21.958773%のDD**。ただし本人は entry0.007980、72H後exit0.007430で、キャッシュ約27,589円→29,408円の**利益取引**。保有中のM5 HIGH最大逆行はエントリー比約**0.6015%**だけ。 |
| モデル終端 | S4+P25単一枠 | 21完了、1右打切り | 残1件は架空決済せず正出来高M5 final closeで約35,621.10円とマーク |

つまり **`S3_10500`が「下降なのに間違ってSHORTした」という誤判定ではない**。この建玉を負けとして除外すると正しいSOURCEの利益を傷つける。未実現を含む口座評価額をDD基準にする場合、**別の正しい取引で一時的に大きく積み上がった含み益**も後から比較基準ピークになる。このリスクを管理するには単なるENTRYの上昇/下降多数決や短期EXIT閾値の微修正でなく、構造状態と未実現利益状態を分離するロジックが必要。

## 本研究の検算

- 事前固定 `PRISM7_P27_PRECOMMITTED_POST_CAPITULATION_REMAINING_DD_ORIGIN_20261122.md`。
- コード `scripts/research/prism7_p27_p25_remaining_dd_source_peak_origin_20261122.py`：P22全120＋P25 source M5イベント120、2print/extra0を凍結再演し、全22建玉の開始NAV→確定M5マーク→参考EXIT→次の建玉を独立再計算。P26のtime-causal M5 HIGH stress/DDと**完全一致**。
- 回帰 `scripts/research/test_prism7_p27_source120_residual_dd_peak_origin_20261122.py` **5/5 PASS**：元120setup保持、21完了＋1右打切り、旧参照M5DD21.958773%、「6月のSOURCE勝ち取引ピーク」「10月SOURCE勝ち取引の谷」、元エントリー価格・最終EXIT・最大逆行・未実現の帰属、source署名fillなし。
- 個票 `docs/research-results/prism-phase2-20261122/PRISM7_P27_S4_AFTER_CAPITULATION_22_TRADE_RISK_LEDGER_20261122.json`、概要 `docs/research-results/prism-phase2-20261122/PRISM7_P27_S4_AFTER_CAPITULATION_RESIDUAL_DD_PEAK_SUMMARY_20261122.json`。P20/21/22/25/26/source M5 SHA固定。

## 結論

**S4+CAPITULATION既知1件捕捉は入口の一部改善がある一方、まだDD20%以下の合格ではない。** S3_10500を誤判定として排除してはならず、利益保護と総資金の機会配分（Layer 3）が別問題となっている。次は同じSOURCE120・21勝敗を変えず、ユーザーが以前決めたロジック別倍率候補 `0.75x / 1.0x / 1.25x` を**結果を見る前に固定し、M5 CLOSE/DDやHIGH、PFと元の正しい勝ち取引を保つかを経済的に検証**する。これで見かけのDDを下げるために元利益を大きく捨てることがないかを検査する。SOURCE originalネイティブV20のLIVE勝率80%や総合DD20%・shared risk daily7.5%を達成したと誤称しない。

**Production/master/VPS/Runner/建玉/実注文/STOP/HYPE/KillSwitch未変更。研究Draft PR #595のみ保存。**
