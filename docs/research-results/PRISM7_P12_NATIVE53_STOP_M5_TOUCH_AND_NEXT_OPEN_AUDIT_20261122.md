# PRISM VII / P12 — 元固定PENGU SHORT V20のSTOP価格到達とSOURCE記録時刻を5分足で監査

**研究状態：SOURCE STOP到達23/23件が実M5正出来高印字で確認できた。ただしSTOPのSOURCE EXIT時刻はM5初回価格到達より5〜60分遅く、取引所の署名済み約定時刻とは別。STOP以外30件のうち18件はSOURCE EXITを仮定する時刻の最初の5分で正印字がない。**

本検証は開始前に `PRISM7_P12_PRECOMMITTED_NATIVE53_STOP_M5_TOUCH_TIMING_AUDIT_20261122.md` として固定。元pinned PENGU SHORT V20 `1657e173d250ad58f53e62f7bb0a3428fb405496`、SOURCE natural SHORT 53件の `period/id/entryTs/price/exitTs/price/reason` 全件同値、元53件のモデル29勝は変更していない。

## SOURCE pure native 53出口の理由別

| 源決済理由 | n | SOURCE 30bps勝ち | 5分足での確認 |
| --- | ---: | ---: | --- |
| SHORT_HARD_STOP | 14 | 0 | **14/14価格到達** |
| SHORT_TRAILING_STOP | 9 | 9 | **9/9価格到達** |
| SHORT_MAX_HOLD | 28 | 18 | 11初回5分印字、14遅延、3次H1全印字なし |
| SHORT_V20_DEADLINE_EXIT | 2 | 2 | 1初回5分印字、1遅延 |

STOP合計23件：元SOURCEに記録されたSTOP価格に対し、元SOURCEがSTOP判定した完成H1内のpositive-volume M5 HIGHがSTOPレベルへ達した**23/23件を確認**。元SOURCE H1 highもSTOP閾値以上。**少なくともSTOPの価格閾値タッチは全ケースで観測できる。** これを「過去のBTのSTOPは動いていなかった」と結論する根拠はない。

ただし、SOURCE native evidenceの `exitTs = decisionReferenceTs + 1H` は53全件に成立。23STOPの **初回正印字5分足highが停止価格へ到達した時刻**から SOURCE `exitTs` まで5〜60分、中央値**50分**。これはSOURCE pure logicが完成H1判定の終了時刻をEXIT記録時刻としているための時間精度の限界であり、実注文のSTOPが何分後に約定したと意味するものではない。SOURCE STOP resident価格モデルの損益計算ができても、正確な時刻のFunding/ポジションGross/他Runner競合、ギャップ時fillの再現には不足する。

## SOURCE決済30件（STOP以外）の次H1 OPEN実行可能性

| SOURCE EXIT時刻から次の5分足を観測 | n |
| --- | ---: |
| H1開始直後のM5に正印字あり | **12** |
| H1最初の正印字が5〜40分後 | **15** |
| EXIT時刻の次H1全12M5で正印字ゼロ | **3** |
| **合計** | **30** |

初回正印字が存在する27件について、source H1 EXIT priceは**初回印字M5 OPENと27/27一致**。しかしSOURCE `exitTs` にその価格で成行約定できることは証明していない。

取引印字が一切ない3件（全て`SHORT_MAX_HOLD`）：
- PRE `PENGU_00004`: SOURCEモデル損益 -0.44593%
- BASE `PENGU_00080`: SOURCEモデル損益 -2.77654%
- BASE `PENGU_00109`: SOURCEモデル損益 **+1.68604%**

元勝ち1件・元負け2件を恣意的に除いて勝率を変えていない。SOURCE仮想OPENと実際の価格印字、signed fillは別の証拠。

## エントリーP11も併せた実行可能性の制約

同じ元SOURCE自然SHORT53件について、P11ではH1 ENTRYを仮定する最初のM5に正印字33、5〜50分遅延19、エントリーH1中の正印字なし1。P12でSOURCE非STOP EXIT30件では最初のM5印字12、後半遅延15、H1全印字なし3。STOP価格は23/23 M5で観測されたが、約定可能価格・STOPキュー・SLippageは未証明。したがって **固定SOURCEモデルの勝率54.717%を実約定勝率と断言しない**。

当該元SOURCE H1 OPENとpositive M5初回印字openが同値だった事実は、価格を決済可能時刻より早く市場へ約定処理させてよい理由ではない。元SOURCE engineを変更せずに完全な実行再現を行うにはM5で注文submission→first trade/quote→fill/partial qty→STOP resident activation→STOP touch→exit、時間順に独立アダプタを実装して原SOURCE 53件の利益/損益/決済時刻を比較する必要がある。

## source再検算

- `scripts/research/prism7_p12_native53_stop_touch_vs_exit_ts_audit_20261122.py`
- `scripts/research/test_prism7_p12_native53_stop_m5_touch_contract_20261122.py` **5/5 PASS**。
- 元native raw JSONL3個とM5 archives4個、元H1 public3個のSHA256をまとめたsummary：
 `docs/research-results/prism-phase2-20261122/PRISM7_P12_NATIVE53_STOP_M5_TOUCH_SUMMARY_20261122.json`
- 53全個票：
 `docs/research-results/prism-phase2-20261122/PRISM7_P12_NATIVE53_STOP_M5_TOUCH_LEDGER_20261122.csv`
- 同じ元source・原データで独立再計算し、**CSV/JSONのSHA256完全一致**：
  - CSV `74b6939d2a590c1f706a4251818c8c10fd679af83b191fe778e76ad0ca511b21`
  - JSON `371c6f53b7d3a6d70cb33ad2b6be830dc8944e3df962edf1b7c911325683e8a3`

## 残課題

- 価格到達は注文約定の保証ではなく、H1 exit timestampをM5初回touchへ移し、同時に全SOURCEポジション状態とSTOPを再演する別の研究用执行環境が必要。
- 入口修正/保有中反転ルールも元SOURCEの勝ちを削っており、P10は実53で29勝→18勝・人工157で77勝→71勝のため**不採用**。過学習回避のため、今回のSOURCE M5後付け判断をentryで使うことは禁止。
- 未見OOS・実注文/quote/partial-fill・Funding/Gross/他Runner・複利総合DD20%以下・PENGU勝率80%は未達。入口33/53、STOP到達23/23、非STOP出口12/30という観測値だけから達成を主張しない。

**GitHub Draft PR #595の研究ブランチのみ更新。本番MASTER/VPS/Runner/STOP/注文/建玉/Kill Switch/HYPEは未変更。**
