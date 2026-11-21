# PRISM VII P22 — Route Aを「売り追随」から「買い戻りの失敗後に売る」状態遷移へ根本変更（結果前凍結）

**研究版 `PENGU_S4_FAILED_REBOUND_V1`**。SOURCE pinned `1657e173d250ad58f53e62f7bb0a3428fb405496` の全native53を対照のまま保持、P20新入口120件は `SELLER_PULLBACK_REJECTION`58、`BREAKDOWN_RETEST_FAILURE`58、`RELATIVE_WEAKNESS_DOWNSHIFT`4という入口setup母集団を**全件保存**。P21の2H下抜け売り確認はBASEでRoute A15件4勝、平均net−2.55%前後、母集団全体のPF低下源と判明。Route Bでは12件10勝の小標本（95% Wilson≈55–95%）で有望だが、BASE45 setupから9取引のみ、未見OOS/大DDは未確認。本稿は既見成績を受けた新たな研究仮説であり**次の同一歴史期間の評価は完全なOOSではない**。

## 独立した出口を維持し、市場構造の売り場を作り直す
1. `BREAKDOWN_RETEST_FAILURE`（Route B）の売り確認と2H決済モデル、`RELATIVE_WEAKNESS_DOWNSHIFT`（Route C）の試験的売り確認は **P21完全不変**。元sourceに含まれる自然signal53とSOURCEを改変しない。
2. Route Aの58 setupは「前のH1陽線→今の陰線」の時点ではすぐSHORTせず、`WAIT_BUYER_RETEST`状態。元の確定済み **signalH1 CLOSE (S)** を固定し、最大 **8H**の正出来高M5を順に観察。最初に `M5 HIGH>=S×1.015` を観測した確定足で `RETEST_SEEN`へ遷移。高値は確定M5で初めて知る。リテスト未観測なら `RETEST_NOT_SEEN_WITHIN_8H`。
3. `RETEST_SEEN`の**次のM5以降**、retst以降の最大印字高値peakを更新し、M5確定CLOSEがそのpeakより **0.75%以上低く**、なお `M5 CLOSE>=S×1.005`（元のH1終値より少なくとも0.5%以上高い場所でSHORT成立）を満たす。次の同時要件：直近3本の正出来高M5が35分以内、taker buy比率合計<=0.42、当該CLOSE<直前正印字M5 CLOSE（買い反発失敗）。
4. さらに **BTCの最新の完了済みH1** の終値が、その時点までのBTC EMA72以下、同時点BTC直近6H close return<=0。このH1はM5時刻tの属するH1より1本前であり、BTC進行中のH1 closeを未来読みしない。これでBTC上昇トレンドに戻った場合の疑似売りサインを排除する。
5. SELLER失敗反発が全部確定したM5 `[t,t+5min)` の終了後の**初回正印字M5 OPEN**を研究SHORT ENTRY価格代理とする。Signal closeから順に進み `entryTs<setupTs+8H` 必須、引けで知った値を同じ足のopenで約定しない。次の印字がなければ`ENTRY_PRINT_AFTER_REJECT_NOT_SEEN`。十分に高い場所まで戻らない局面でも、その取引を勝ちや負けに捏造しない。
6. 成立した新Route Aと元P21 Route B/Cを、単一枠の時刻順で同じ `REFERENCE_STOP72`（hard+8%、前完成H1 lowから順行15%でtrail4%、最大72H）へ投入。SOURCE originally pinned V20に忠実な新exitではなく、元P20/P21と公平に比較する **reference overlay**。M5足内注文配分/部分約定/成行ASK/ギャップは不明。
7. 全120構造setupのまま新routeAの state退場原因、成功トレード数、SOURCE既存勝者利益、30bps net平均/PF、**全setupあたりのPnL**、参考実現DD、PRE/BASE/POST別、RouteA/B/C個別、10/30bps +追加滑り0/10/25bpsを固定評価する。もし単にAを実質消して勝率が高くなるだけなら**不採用**。採用には実効trade件数/総利益/元source比較と独立別期間・人工上げsqueezeでの優位が必要。未見OOSではない。
8. PENGU V2,RecoveryV8,HYPE,master,Production,VPS,実Runner/注文/建玉/STOP/Kill Switchは**変更しない**。P21・P20 Source SHAや台帳を再生できなければFail Closed。GitHub Draft PR #595研究専用Push。

このルートは元58 H1 setupから違うタイミングで売るので、価格優位の可能性はあるが利益改善を保証しない。PENGU勝率80%以上、総合実口座最大DD20%以内は依然目標であり、本研究で未達なら未達と記録。
