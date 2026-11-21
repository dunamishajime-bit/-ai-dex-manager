# PRISM VII P20 — PENGU S3 STRUCTURE V1: SHORT入口を市場構造から再実装し、元V20より劣後。初版不採用。

結果取得より前に `PRISM7_P20_PRECOMMITTED_PENGU_S3_STRUCTURE_ENTRY_REBUILD_20261122.md` へ3入口の全ルールと同一実行方式を固定。SOURCE runtime pinned `1657e173d250ad58f53e62f7bb0a3428fb405496` は一切変更せず、source original SHORT V20 natural53件（29勝24敗、SOURCE本来のnative exitでは別成績）を独立対照とした。

## 市場構造3つの入口から新たに発火した機会

- `SELLER_PULLBACK_REJECTION`：下降相場の戻り失敗、58候補。
- `BREAKDOWN_RETEST_FAILURE`：過去support24割れ後の上方リテスト失敗、58候補。
- `RELATIVE_WEAKNESS_DOWNSHIFT`：BTC比のPENGU下落加速、4候補。
- **計120自然入口候補**。Source originalの53候補を除外しない。全H1の確定時刻から次H1開始に意図を作り、最初の正出来高M5 open価格でSHORT代理。入口H1に印字無しは未約定モデル（勝ち・負けに数えない）。

公平な入口比較としてSOURCEとS3に共通 **REFERENCE_STOP72（hard8% / prior completed H1で有利15%後retracement4% / maxHold72H）**を適用。これはSOURCE本来のV20-phase EXITと完全一致しない経済比較用overlay。トレード1枠、既に建玉で他候補が発火した場合は `OCCUPIED_SLOT`を全件記録し、見送りを勝ち取引に換算しない。費用10/30bps・追加滑り0/10/25bpsを独立計算。

| 30bps / 追加滑り0 / 1枠条件 | SOURCE V20本来の入口+参考出口 | 新S3入口+同一参考出口 |
|---|---:|---:|
| 信号候補 | 53 | **120** |
| 枠占有でエントリー見送り | 20 | **65** |
| ENTRY時刻H1に正印字なし | 0（1枠見送りが原source未印字を含む可能性） | **2** |
| 価格代理ENTRY/EXITが完了 | 33 | **53** |
| モデル上の勝ち | 17 | **25** |
| 条件付き勝率 | 51.515% | **47.170%** |
| 平均net利益 | **+1.535980%** | +0.299541% |
| PF | **1.560015** | 1.084057 |
| 10,000円順次複利での参考終了残高 | 14,914円 | **9,708円** |
| 同じ順次実現損益モデルの最大DD | **28.075%** | **44.743%** |

順次複利は**実現損益だけのDD**であり、運用口座の未実現損益・手数料変化・他Runnerのgrossを含むDDではない。成績を長期本番へ外挿してはいけない。

一方、1枠制限なしで全新候補を個別評価すると S3は115件価格代理完了・59勝（51.30%）・平均+0.528589%、PF1.157238。元SOURCE53候補は52件代理完了・27勝（51.92%）・平均+0.839501%、PF1.29226。**新S3は同一費用・出口ルールでも総合的に劣る。**

## なぜ候補が増えても改善しなかったか

| 30bps, 1枠で完了した新S3 | n | 勝ち | 平均net | PF |
|---|---:|---:|---:|---:|
| 戻り売り失敗（Route A） | 22 | 11 | +0.6321% | 1.1781 |
| 支持線割れ・戻り失敗（Route B） | 28 | 13 | +0.3404% | 1.1014 |
| 相対的弱化（Route C） | 3 | 1 | **−2.5206%** | 0.5506 |

全候補を重複可で価格代理評価すると、Route Bは56件中31勝、平均+1.2577%・PF1.4466と部分的には望みがあるが、1枠運用では28件中13勝・PF1.101へ悪化した。**真に有利な後続candidateを他の建玉で塞ぐ機会競合**が疑われる。1枠に入ったrouteは先着順であり、優劣の期待値が事前に分かっているわけではない。Route Cは元市場内で4件と少数だが、入口の情報が弱く、BTCが下落していないのにPENGUだけ売り込まれる局面では反発に巻き込まれる危険が残る。

期間別S3 single slot：PRE2025 Aug-Sepは4件中1勝、平均−4.7474%；BASE2025Oct–2026Sepは40件中18勝、平均+0.2282%；POST2026 Oct-Novは9件中6勝、平均+2.8595%。**後半だけの良成績を切り取って採用しない。** SOURCE main BASEの24件/13勝/平均+2.4626%とも乖離する。

## 研究ゲート・保存

- `scripts/research/prism7_p20_pengu_s3_market_structure_native_source_comparison_20261122.py`：独立構造生成、価格印字を待つENTRY、SOURCE同一参考STOP、候補すべて、1枠/候補独立実行、費用再計算、参考DD。未来足を入口に混ぜない。
- `scripts/research/test_prism7_p20_s3_structure_source_reference_contract_20261122.py` **5/5 PASS**：original SOURCE53 ID/元勝敗/EXIT保持、120自然候補のas-of、1枠状態、STOP優先、費用の単調性、実約定証明なし。
- 証跡：
  - `docs/research-results/prism-phase2-20261122/PRISM7_P20_PENGU_S3_SOURCE_COMPARISON_SUMMARY_20261122.json`
  - `docs/research-results/prism-phase2-20261122/PRISM7_P20_PENGU_S3_ALL_CANDIDATES_20261122.csv`
  - `docs/research-results/prism-phase2-20261122/PRISM7_P20_PENGU_S3_ALL_TRADE_EVENTS_20261122.jsonl`
- 台帳内にM5 source/ H1 source三期間gzip SHA256, 区分別全分母・native原本のSHAを固定。
- 本稿のデータは既見の歴史市場。次に市場参照順の独立再計算と人工squeeze、未見OOSが必要。

**結論：`PENGU_S3_STRUCTURE_V1` 初版REJECT。** 理由は単純な勝率だけでなく、元SOURCEより総合PF・平均利益・順次実現DDが著しく劣ること。次のP21では「構造の発火」と「その後の実際の販売成立確認」を別状態へ分け、初期売り場を追って不要な位置で入ることを防ぐ。ただし保有枠への機会配分と潜在実行時刻を必ず保存し、candidateの除外だけで見かけの勝率を上げる設計は禁止。これをPENGU80%達成/PortfolioDD20%達成と主張しない。

本番MASTER/VPS/Runner/STOP/注文/建玉/HYPE/Kill Switchは変更せず、PR #595 Draft研究専用。
