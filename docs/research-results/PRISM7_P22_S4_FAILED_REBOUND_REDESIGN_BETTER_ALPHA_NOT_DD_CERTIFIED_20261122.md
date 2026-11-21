# PRISM VII P22 — 市場構造SHORTの入口を再設計。条件付き勝率・利益・PF改善、しかし不採用（DD等未達）

**研究ロジック名：`PENGU_S4_FAILED_REBOUND_V1`**。元SOURCE pinned `1657e173d250ad58f53e62f7bb0a3428fb405496` のSHORT V20 53自然ENTRYと元SOURCE出口は不変更。P20/P21新独立3入口の**120個のH1構造setup**を全数保存。事前仕様 `PRISM7_P22_PRECOMMITTED_FROZEN_RETEST_FAILED_BOUNCE_REPLACEMENT_20261122.md` に基づき、元P21の失敗源だったRoute A 58 setupの入口機構を、8Hまでの買い戻りを待って売りに転換する構造へ完全変更。Route B/CのP21信号/STOP/価格は**元台帳と全件同値**。

新Route A（58候補）：構造確認H1の終値から1.5%以上の上方リテストを正出来高M5 HIGHで確認→**次M5以降**にpeakから0.75%以上反落・元signal H1 CLOSEより0.5%以上高い場所を維持、直近3M5売り成約優勢（taker買い比率<=0.42）、BTCの**最新の完了済みH1**がEMA72以下かつ直近6H上昇なし→決済ではなく、新SHORTを次のpositive M5 OPENへ依頼（8H期限厳守）。価格代理と本番注文約定は別物。

## 新しいP22とP20/P21との比較（同一30bps・追加滑り0・1x/1枠参考）

| 指標 | Source旧V20入口+共通出口 | S3 (P20) | S3 seller確認 (P21) | **S4 (P22)** |
|---|---:|---:|---:|---:|
| 元候補 | 53 | 120 | 120 | **120** |
| 価格代理決済済 | 33 | 53 | 34 | **21** |
| 勝ち | 17 | 25 | 19 | **15** |
| 条件付き勝率 | 51.5% | 47.2% | 55.9% | **71.43%** |
| 平均net利益 | +1.536% | +0.300% | +1.002% | **+4.93363%** |
| PF | 1.560 | 1.084 | 1.296 | **3.90560** |
| 先に算出した実現済みDDのみ | 28.075% | 44.743% | 31.167% | **16.102%** |

**勝率・PF・平均利益とも改善**したが、P22は元120setupのうち21決済完了（別に**右打切り建玉1件**）、機会数が激減した**選別の経済比較**であり、21件の勝率からPENGU全体の80%達成を主張しない。95%Wilson区間は15/21＝**約50.0〜86.2%**。SOURCE自体のnative出口再現とは違う共通 `REFERENCE_STOP72` を使い、SOURCE V20元の勝率29/53も維持している。

P22 Route Aの58setup内訳：初回買い上昇リテストなし18、買いリテスト後の有効な反落未確認24、枠占有5、実際の価格proxy決済10、右打切り1。決済10のうち5勝・平均+2.58529%・PF1.95224。P21のRoute A 22取引9勝・平均−1.60046%・PF0.641からは改善するが、出入り機会が減少し、絶対的な勝率は50%にすぎない。

P22 Route Bは58setup中、M5 SELLER確認なし41、次の正印字なく2、枠占有4、ENTRY/EXIT価格proxy11（**10勝、平均+7.06849%、PF10.13895**）。ルートB 10/11のWilson95%勝率区間は**約62.3〜98.4%**、source BASE45 setupからの取引9件/7勝、POST13 setupから3件/3勝など、少標本と既見市場の楽観バイアスに留意。P22 Route Cは元4setupのうち売り確認なし4、代理約定0。

P22期間別：PRE9setup→決済1/0勝/平均−8.3%；BASE85setup→決済15/11勝/平均+5.59454%、PF4.30410；POST26setup→決済5/4勝/平均+5.59763%、PF15.285（出力はPOSTの見かけの強いPFであり未見OOSではない）。すべて同一reference STOP72の比較であり、従来V20の本来のnative出口や本番の近未来再現を保証しない。

30bps +追加出口slippage 10bps/25bpsでP22の21完了はなお15勝、平均+4.83363%/+4.68363%、PF3.79960/3.64701。費用感度を隠さない。

## 最大の不合格：P23で発見した保有中DD

P22の**実現DD16.102%**だけを採用判定に使うことは誤り。直後に事前固定したP23のSOURCE positive-M5 mark評価で、S4 1倍/1枠30bpsの**保有中5M close含む最大DD35.94150%、足内高値stress37.64670%**となる。しかも期間末に未決済の右打切り1件が残る。元SOURCE referenceもM5 close DD32.45294%、P21 40.51113%、P20 47.30243%。P22自体が1倍単独でもDD≤20%に届かない以上、Production採用は**REJECT**。SOURCE stop hard8%＋手数料30bpsの1x負けは最大1件あたり8.3%に達し、shared daily loss7.5%上限との関係も別途安全側で再検証が必要（これは約定ギャップや他建玉があれば悪化し得る）。

**PENGU S4を新たなLIVEロジックにはせず、入口構造の研究結果として限定的に維持する**。取引数を不自然に捨てて勝率を「改善した」と偽装しない。次は、保有中の最大逆行と「売り構造の失敗/買い回復」を元の勝ちを傷つけず検出できる新状態機械、実約定可能性・別市場OOS・運用SharedRiskの多層対策が必要。Exitだけの局所調整P10/P19は不合格済みで、過学習した小閾値の改変を避ける。

## GitHub証跡・再現

- `scripts/research/prism7_p22_pengu_s4_failed_rebound_architecture_20261122.py`、`scripts/research/test_prism7_p22_failed_rebound_fsm_source120_20261122.py` **6/6 PASS**。
- `docs/research-results/prism-phase2-20261122/PRISM7_P22_PENGU_S4_FAILED_REBOUND_SUMMARY_20261122.json`、source H1/M5 gzip SHA256、既存SOURCE native53 SHA、P20/P21 prior result hashes同梱。
- `docs/research-results/prism-phase2-20261122/PRISM7_P22_PENGU_S4_FAILED_REBOUND_240_EVENTS_20261122.jsonl`（全120独立+120単一枠、全route機会状態と価格proxy timestamp）。
- 結果JSON SHA256 `5889fc1a01a29de7f9d9a79202962c3a6175ce43b6fb666655da980364bfc5db`、240 event ledger SHA `a2792d43277729834f5d658b039ca0299f2084c5ec018e9cffc53cc5d51263ea`。分類名を修正して全ケースの群ラベルが正確、総合経済数字は同じ。

SOURCE V20本番/他PENGU V2/RecoveryV8/HYPE/Run-time/Production/VPS/master/建玉/実注文/STOP/Kill Switch未変更、PR #595 Draft research only。
