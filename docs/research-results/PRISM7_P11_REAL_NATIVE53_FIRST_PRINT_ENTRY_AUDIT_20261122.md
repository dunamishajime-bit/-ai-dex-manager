# PRISM VII P11 — 実SHORT V20の元53エントリー・初回5分足取引印字監査（2026-11-22）

**RESEARCH ONLY — 正確なsource-native入口/出口53/53一致を維持。勝率・損益・STOPは再計算せず、自然SHORTのエントリー時刻が取引印字で裏付けられる範囲を区別する。**

P11の仕様は本評価前に `PRISM7_P11_PRECOMMITTED_NATIVE53_ENTRY_M5_PRINT_EXECUTION_AUDIT_20261122.md` としてPR #595へPushした。元source commit `1657e173d250ad58f53e62f7bb0a3428fb405496`、自然SHORT 6+40+7=53件を全件、H1 sourceモデルのentryTs・entryPriceとPENGU M5公的sourceアーカイブ正出来高印字で結合。元SOURCE実約定台帳ではなく、次H1 OPEN仮想価格モデル。

## 全53件のエントリータイミング検査

| 元source自然SHORT、H1エントリー予定時刻から | 件数 | 割合 |
|---|---:|---:|
| 最初のM5（0〜5分）で正出来高印字あり | **33** | **62.26%** |
| 初回印字が5〜50分遅れ | **19** | **35.85%** |
| 予定H1の12本のM5がすべて印字0 | **1** | **1.89%** |
| **合計** | **53** | **100%** |

52件には正出来高M5印字が存在し、その**最初の正印字M5 openは元H1 source entryPriceと52/52件で完全一致**（>0.05%、>0.1%、>0.5%、>1%のopen価格差はいずれも0件）。この一致はソースOHLC構築が同じ取引価格を使った可能性と整合するが、**当該botの発注時刻・実約定・qtyは証明しない**。19件で当該取引印字は初回H1から遅れているため、元SOURCEの `entryTs` 時刻で `entryPrice` 約定した保証はない。

初回印字までの待ち時間の全分布：0分33、5分7、10分5、20分1、25分1、30分3、50分2、H1中に一度も印字なし1。初回印字最大遅延**50分**。

元モデルでH1全時間印字なし1件は `BASE_2025_2026 / PENGU_00071`（entryTs `1778716800000`）。元の30bps source仮想結果は**+6.036699589%の勝ち**、EXIT reason `SHORT_MAX_HOLD`。この勝ちを勝手に損失へ修正するのも、botが実際にentry priceで約定できたと主張するのも誤り。**SOURCE価格モデル勝ち**と **M5当時の取引印字根拠なし** を別項目に分離する。

元SOURCEの29勝の内訳：H1開始直後M5正印字17件、遅延11件、当該H1全印字なし1件。元24敗：最初M5正印字16件、遅延8件、全印字なし0件。したがって、印字不十分の20件は**元勝ち12件／元負け8件**。恣意的に20件を除くと、勝率の見た目が変わる可能性があるので**SOURCE自然SHORT母集団53件からは除外しない**。実約定証拠が欠ける点をリスクとして残す。

期間別：PRE6件の最初5分印字3・遅延3、BASE40件は最初5分25・遅延14・全印字なし1、POST7件は最初5分5・遅延2。

## 考察と上流の課題

- 最初の印字openが元H1 source openと52件で一致しても、源source H1/M5の他の時間に存在する価格再構成不整合が解消したわけではない。**今回はentry時のopen照合のみ**。
- 一部のH1 `open` は当時の最初の取引印字が出た**後で確定する価格**であり、時間足開始直後に既知の取引可能価格ではない。今後は`time-of-first-print`、約定板のbid/ask・数量・キュー・取引所注文応答、STOP/EXIT resident orderの実行時刻を分離しないと、nativeのEXIT利益率をそのまま実約定可能と検証できない。
- H1次openの価格モデルをP11だけで「初回印字に遅らせてエントリーし直す」だけではsource STOPとENTRY stateが矛盾する。経済的なBTには、元SOURCEを固定したまま**研究用注文状態機械・発注許可・約定・建玉・STOP更新**を時間順に別途再構成して、新旧結果を全件比較する必要がある。
- 今回のM5印字が存在することですら個別botのsigned fill証拠ではない。補足：SOURCE固定SHAの53/53の自然candidate/STOP価格モデル一致はP8で検証済み。

## 証跡・検算

- 全53個別台帳 `docs/research-results/prism-phase2-20261122/PRISM7_P11_NATIVE53_SOURCE_H1_VS_M5_FIRST_PRINT_20261122.csv`
- source M5/immutable original case SHA256付きsummary `PRISM7_P11_NATIVE53_FIRST_PRINT_EXECUTION_AUDIT_20261122.json`
- 元53 ID・H1 entry/price/PnL/pinned exitと全53同値、印字有無/時刻の分類を検算する回帰テスト **5/5 PASS**。
- 独立再計算で2出力のSHA256が完全一致：
  - CSV `6247e23daeb045b6cfd75678d5a8f4f74f6335fb26f0790b7d6811445c03f3c3`
  - JSON `7fa29ee6c73a7c88f316699721d21fdf33df53d6123414d8dcb0a3fc279f99b3`
- 研究コードとテストをPR #595 Draft研究ブランチにPush。本番変更なし。

## 次に必要なゲート

PENGU SHORT V20 80%・最大DD20%以下の実現には、単純な閾値/保護STOP変更で元の勝ちを破壊することを繰り返さず、まず新入口/出口の**as-of source情報と執行状態の因果再現**が必要。

ここまでにP9人工同一履歴の反実仮想「shockで元勝ち→負け8/13」を確認し、P10保有中反転保護は源実53で29→18勝、人工157で77→71勝まで悪化して**REJECT**している。未見OOS、PENGU H1/M5整合、source-nativeの成行約定／STOPのgap執行、Funding・Gross/Shared Risk、複利総合BT・DD <=20%はまだ未検証。勝率だけを数字上で改善する偽装は行わない。

**VPS/Production/Runner/注文/建玉/STOP/Kill Switch/HYPE/masterは変更していない。**
