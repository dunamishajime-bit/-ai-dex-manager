# PRISM VII P34 — gross0.75固定：SELLER_PULLBACK_REJECTION の因果BTC方向Gate・追加25条件

**意思決定**：`PENGU_S4_HYBRID_P34_BTC6H_CONTEXT` は**研究候補**として保存。0.75倍固定でSOURCE5M値段モデルの基準時点DD17.03%、第3 positive5M売買印字＋追加買戻し1000bps滑りでもDD18.82%とP33の同条件23.87%から改善。ただし**新しいBTC6h gateを既存S4損益を見た後に仮説化したため完全out-of-sample根拠なし**。勝率73.68%（14/19）でユーザーPENGU80%目標は未達。本番はBLOCKED。

## 事前固定と方法

本実験結果を見る前に `docs/research-results/PRISM7_P34_PRECOMMITTED_PENGU_S4_SELLER_PULLBACK_0P75_ASOF_GATE_ABLATION_20261122.md` をPR #595 DraftへPush。対象SOURCE元pin `1657e173d250ad58f53e62f7bb0a3428fb405496`、新S4入口source120 setup、pinned V20 native EXIT on S4 NEW ENTRY（original native 53とは別）、SOURCE P25 PENGU/BTC共同M5急落確定1件、M5 native phase、30bps、gross **全25条件0.75倍**。P33 SOURCE120単一slot結果に合うことが前提。

P20 `asofFeatures` を **signalReferenceTs（entry時刻前に確定）**から読み取る。P20 H1 `futurePricesUsedToFormSignal`全120件falseを要求。検証モデルは以下固定でいずれも `SELLER_PULLBACK_REJECTION` にだけ入口制約し、他routeを変えない。
- `BASE_UNMODIFIED`
- `SELLER_BTC_TREND_ONLY`: P20 BTCret6<=0
- `SELLER_REL_WEAKNESS_ONLY`: PENGUminusBTC6<=0
- `SELLER_EMA_TREND_ONLY`: EMA24<=EMA72
- `SELLER_CONSENSUS_3_OF_3`: 上記3条件AND

5entryモデル×shock後第2/第3 positiveM5 OPEN×追加slip0/1000bpsの4ストレス、および各モデルshock OFF 1条件=**25条件**。entry条件を満たさないsetupはSOURCE120から削除せず `RESEARCH_P34_GATE_BLOCKED` にして原本entry/exit時刻は保存。**全120時系列を再admit**（空いた枠へ次に来た取引を計上）、元SOURCE価格・EXIT・M5のH1不変。結果は分解可能な全25条件×モデル建玉jsonl、source120 causal features、25 scenario statisticsに保存。

## 主要結果

30bps・単一PENGU 0.75倍・複利・元本1万円のモデル。SOURCE M5 CLOSE mark-to-market DDを「最大DD」とする。価格代理であり実口座ではない。

| Layer1 研究入口 | 基本 第2印字・追加0 勝/決済 | 同 主なM5最大DD | 第3印字・追加1000bps 最大DD | 第3印字・追加1000bps HIGH stress DD | 同 PF |
|---|---:|---:|---:|---:|---:|
| P33 原型 | 15/21 (71.43%) | 17.0314% | **23.8713%** | **23.9231%** | 3.6123 |
| P34 BTC6H非上昇 | **14/19 (73.68%)** | **17.0314%** | **18.8177%** | **18.8729%** | **4.5922** |
| P34 PENGU対BTC相対弱 | 14/19 (73.68%) | 17.0314% | 18.8177% | 18.8729% | 4.5050 |
| P34 EMA24<=72 | 15/21 (71.43%) | 17.0314% | 23.8713% | 23.9231% | 3.6123 |
| P34 3/3一致 | 13/18 (72.22%) | 17.0314% | 18.8177% | 18.8729% | 4.4014 |

**P34 BTC trendの第3印字＋1000bps追加滑り参考平均netは口座資金比+3.92397078%/取引**、P33基準同条件+3.35624014%、勝者14・敗者5、profit factor4.59215672。main第2印字0bpsは P34 14/19・平均net+5.19455672%、PF5.75530091、DD17.03139963%。

**P34 BTC trendの成績変化の厳密な内訳**：
- SOURCE S4 SELLER 58 setupのうちBTCret6>0で**23候補**をBlock。実際ENTRY代理価格を持つ4取引が対象（多くは元からENTRYしない setup）。
- 元単一slot価格決済から**勝ち1件 `S3_01634` 参考net+2.86746% (notionalベース)も失った**。元負け1件 `S3_01864` 参考net−8.3%(notionalベース)は回避。新admissionで穴埋めとなった価格決済は**0件**。元120全件のシグナルは保存。
- 同様のPENGU対BTC相対弱ルールは別の元勝ち `S3_05514` +5.27934%(notional)を1件失い、同じ負け`S3_01864`を回避。3条件ANDは勝ち2件・負け1件を落としPFが劣る。EMA24<=EMA72は元SELLER58 setup**全件true**で**非識別**、新しい情報がないので採用しない。
- POST `2026-10~11`の5完了うち3勝はゲート適用前後で変化しておらず、**後半相場の外部検証成果とは言えない**。すでに前回研究でPOSTを見ている。PRE 1件0勝も未変化。BASE期間内のわずか1勝1敗除外で全期間DDが変わっている。
- **急落時買戻しルールをOFF**にすると 0.75 BTC6h GateでもM5 CLOSE DD **24.85495896%**（HIGH31.06420603%）となり依然20%未達。利益保持/DD抑制の最大寄与要因はP25で観測後仮説化した**1件の既知shockの早期利確**であり、BTC gate単独ではDD20を守れない。

## 判定／次研究の前提

- S4元120構造全件・源V20 native出口・P33 M5 markと因果価格を保持。P34 25条件すべてgross0.75、30bps、源候補/枠組み一致。**P34回帰7/7PASS**。
- **研究候補としてP34 BTC6h Contextだけ保持**。相対弱Gateは既知勝者+5.28%損失、3/3は勝者2件を失い見合う勝率改善がない、EMAは無変化。BTC6hが1勝を落とす欠点も残る。
- **今後の改善対象は「負けたS3_01864だけを見て阈値を調整しない」ことと、一律急落買戻しのP29/P31反証**。全SOURCE orig53戦略・別期間・外的人工市場で事前固定guardを検証して反例を探す。元53 natural ENTRYとは別のS4新ENTRYである点を継続区別。
- BTC6h gateと shock P25 detector は完全未見OOSで性能確認なし。ショック判断後の「第3印字を実際に買える」保証、板/asks、5Mとintrabar STOP順序、Funding、Shared Risk日次7.5%、他Runner Grossと総合DD20%以下は未確認。好条件で実市場にもDD18.82%が保証されるとは絶対に主張しない。
- PR #595 Draft研究のみ。master/Production/VPS/Runner/注文/STOP/建玉/KillSwitch/HYPE/Codexの操作・変更なし。

## 再現性と証跡

- `scripts/research/prism7_p34_pengu_seller_causal_three_gate_075_gross_ablation_20261122.py`
- `scripts/research/test_prism7_p34_pengu_seller_three_gate_075_20261122.py` 7/7 PASS
- `docs/research-results/prism-phase2-20261122/PRISM7_P34_SELLER_ALL120_CAUSAL_PREENTRY_FEATURES_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P34_SELLER_075_CAUSAL_GATES_25_STRESS_CASES_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P34_SELLER_075_25_CASE_POSITION_LEDGER_20261122.jsonl`
