# PRISM VII P33 — 「研究の良い部分を組み合わせる」検証：S4入口＋源固定V20出口＋BTC急落対策＋0.75倍

**研究名 `PENGU_S4_HYBRID_P33`。ユーザーから2026-11-22に「PENGUの研究結果をまとめていいとこだけ採用にしたらDD20%以下になりそうじゃない？」と指摘されたため、良い取引だけを選別せず、入口・EXIT・ショック状態・リスク倍率を**単一の完全な経済台帳として一体検証**した。事前規則は `PRISM7_P33_PRECOMMITTED_NATIVE_V20_S4_CAPITULATION_GROSS_HYBRID_20261122.md` として結果算出前にGitHub保存済み。

## 検証条件とSOURCEの不変性

- **SOURCE pin: `1657e173d250ad58f53e62f7bb0a3428fb405496`**、元PENGU SHORT V20自然53エントリー/元EXITは53/53完全一致・29勝24敗の比較基準として残した。元pin SOURCE原本コードとProductionは変更しない。
- 新Layer1：P22 S4市場構造H1 **120候補全部**、そこからSOURCE5M正出来高の入口31件、元native V20参考出口に接続した1slotモデル21完了・15勝・1右打切り・9 occupied、未発火は取引として創作しない。**新S4入口自体が本番SOURCE native V20の入口signalだったとは主張しない**。
- 出口：P32で SOURCE pure `createPenguShortV20State()`＋`evaluatePenguDualLsV2PositionBar()` をS4入口から再現した元native phase/stop/deadlineの時刻順M5価格代理。**以前のREFERENCE_STOP72は採用していない**。ショックなしbaselineの **mean+3.921884%、PF3.289456、保有中M5DD35.941503%** と完全一致を検証。
- Layer2：P25で固定したPENGU+BTC同一M5確定時の急落検出を、**元P32 native EXIT時刻まで全120候補で新たにスキャン**。発火したのは `S3_01700` の**1件だけ**。当時の決定時刻と検出価格はP25のreference STOP72で検出した事象に完全一致。SOURCE native EXITが先なら決済は元native優先。新futureや既存取引の勝敗結果は用いない。
- Layer3：ユーザー指定gross候補 **0.75,1.0,1.25x**、全候補を固定したままSOURCE M5 CLOSEで未実現含む元本1万円/複利の評価額と、直前完了M5 peakに対する時間順HIGH stress DD、ENTRY cash割合に比例した往復feeを計測。
- **グリッド：3倍率×3 positive5M BUY印字遅延×5extra buy-slip (0/25/100/500/1000bps)×2往復fee (10/30bps)=90条件、全SRC candidate120と価格代理建玉22件×90=1980個票**。sourceイベント/価格/時刻/ネイティブstate追跡SHAを保存。データ2025Aug-2026Nov、SOURCE PENGU/BTC 5M raw archive。元S4構造120/source pinは未変更。

## 30bps・主案・研究価格代理の比較（全120候補保持）

| 組み合わせ | モデル確定勝ち/決済 | 平均net（1回の口座持分比） | PF | 未実現含むM5終値最大DD | 先行完成M5峰→当M5 HIGHストレスDD |
|---|---:|---:|---:|---:|---:|
| P32・新S4＋元SOURCE native V20 EXIT、1.0倍、shock **OFF** | 15/21 | +3.922% | 3.289 | **35.942%** | 37.647% |
| P33・新S4＋native V20 EXIT＋確定shock一時早利確、1.0倍・第2正出来高5M・追加0bps | 15/21 | **+6.008%** | **4.507** | **22.117%** | 22.117% |
| **P33＋Layer3 gross0.75倍・第2正出来高5M・追加0bps** | **15/21 (71.43%)** | **+4.506%** | **4.507** | **17.031%** | **17.031%** |

**主案（0.75x）では研究単独PENGU M5 Mark DD20%以下を達成**。ただしP25ショックの既知2025Oct一時価格で1件のみ大きい早利確を仮定しており、真正のLIVE/OOS達成ではない。主案の元1万円→参考final marked NAV **23,017.75円**（21確定取引+最後の右打切り1件を未実現評価）。新native P32のショックなしsource1倍最終NAV20,992.52円とは資本倍率が異なり、単なるリターン増加比較は不可。

## 最重要：実行遅延の耐性が不十分

| P33の買戻し遅延/追加extra滑り | 0.75x M5-CLOSE DD | 前M5確定peakを用いるHIGH stress DD | 0.75x 平均net/取引 | PF |
|---|---:|---:|---:|---:|
| 第2 positive M5 OPEN / extra0 | **17.031%** | **17.031%** | +4.506% | 4.507 |
| 第2 positive M5 OPEN / extra1000bps | **17.031%** | 17.031% | +4.346% | 4.383 |
| **第3 positive M5 OPEN / extra0** | **20.466%（不合格）** | **20.520%（不合格）** | +3.606% | 3.807 |
| **第3 positive M5 OPEN / extra1000bps** | **23.871%（不合格）** | **23.923%（不合格）** | +3.356% | 3.612 |

したがって「**全市況・全実行条件でDD20%以下**」という達成は明確に**NO**。SOURCE price M5 OPENは板で買えた実約定ではない。1件のshock相当価格を第2正出来高5分足で買える仮定が外れるだけで、DD20%を超える。500/1000bpsを含むextra価格ストレスは定義されたスリッページ仮定で、現実に起こり得る滑りの上限ではない。

## 採用に適した構造／引き続き研究だけに留める構造

**研究として残す根幹（原本SOURCEは変更しない）**：
- S4の元H1市場構造Layer1を構築して入口方向を多層判定。DDが高い取引を事後排除せず、元S4の120 setup/売り買い候補を保持。
- 元pin V20のSOURCE phase/期限/stop出口へS4研究entryを接続し、参考STOPの「良すぎる成績」を避ける。
- 倍率は固定候補0.75/1.0/1.25のリスク比較で示し、1.0xより0.75xのDDが下がるのは勝率の改善でなく**資金投入額の削減効果**と明記。
- 実市場の同時PENGU/BTC急落と保有中未実現益の失効を検出・監視する**情報状態**としてP25 detectorを研究継続。

**LIVE採用できない箇所**：
- P25の急落検出→第2 positive5M OPENで**一律即買戻し**。P29の人工市場では下げ継続時にSOURCE winnerの利益−25pp、P31の同一過去＋BUYER_RECOVERY確認済み人工世界でも再急落時−29.6ppの原SHORT利益破壊反例あり。加えて現実のbid/ask・板・実数量・サーバー処理遅延は未確認で、上記20%クリアを楽観的にする。
- 実口座全RunnerのGross cap、Shared daily loss7.5%、Funding、単一SOURCEの権限やKill Switch、建玉変更、実現/未実現ポートフォリオDD20%未検証。ユーザーのPENGU勝率80%目標も **15/21=71.43%** で未達。ルート別条件付きでは **BREAKDOWN_RETEST_FAILURE 9/11=81.8%**, **SELLER_PULLBACK_REJECTION 6/10=60%** だが、既見小標本であり「良いrouteだけ残して全体80%」と錯誤してS4 Route Aを一律削除してはいけない。
- 各cOHORTでは PRE 0/1勝、BASE12/15勝、POST3/5勝。時期ごとの少数ケースは不確実性が大きく、**BASE期間の利益を未見フォワードの保証として用いない**。調査していた元SOURCE自然V20 53件と別の新S4価格経済母数を混同しない。

## 結果と再現コード

- 事前固定 `docs/research-results/PRISM7_P33_PRECOMMITTED_NATIVE_V20_S4_CAPITULATION_GROSS_HYBRID_20261122.md`
- `scripts/research/prism7_p33_native_v20_s4_shock_fixed_gross_hybrid_20261122.py`（SOURCE native EXIT、全PENGU/BTC M5 source因果再判定、既存source120新1slot、90 cost/grossモデル）
- `scripts/research/test_prism7_p33_native_v20_s4_shock_fixed_gross_90_20261122.py` **7/7 PASS**：元SOURCE native53/source120、元native S4 1slot/相場MARKDD、全120全90と1980個票、P25検出source一致、0.75x17.03%、1.0x22.12%、遅延3で20.47%超、費用比例とコスト悪化、source order signed fillsなし。
- **全90シナリオ summary＋SOURCE gzip/P22/P25/P32のSHA** `docs/research-results/prism-phase2-20261122/PRISM7_P33_NATIVE_S4_SHOCK_GROSS_90_SCENARIO_SUMMARY_20261122.json`
- **全120 SOURCE detector状態** `docs/research-results/prism-phase2-20261122/PRISM7_P33_NATIVE_S4_ALL120_CAUSAL_SHOCK_EVENTS_20261122.json`
- **全90×22=1980価格代理建玉レコード** `docs/research-results/prism-phase2-20261122/PRISM7_P33_NATIVE_S4_SHOCK_90_SCENARIO_TRADE_LEDGER_20261122.csv`

**最終判定：`PENGU_S4_HYBRID_P33` は研究レベルで基本条件 DD17.03%を確認したが、実行遅延stressでDD20%超のため正式採用 `BLOCKED`。** 勝率80%、総合Runner複利/実口座DD20%の安全ゲートや真正未見OOSは未達。勝った個別取引だけを残す操作も行っていない。master,Production,VPS,Runner,実注文,建玉,STOP,KillSwitch,HYPE変更なし。GitHub PR #595 Draft研究のみ。
