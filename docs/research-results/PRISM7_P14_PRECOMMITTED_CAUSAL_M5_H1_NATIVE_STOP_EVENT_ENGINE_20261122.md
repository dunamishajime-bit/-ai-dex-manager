# PRISM VII P14 — Native SHORT V20のM5時間順約定代理・resident STOP・H1確定時状態機械（実行前固定）

**RESEARCH ONLY、SOURCE pinned `1657e173d250ad58f53e62f7bb0a3428fb405496`、元53候補すべて監査。取引所の自己注文約定/板/queue/STOP手数料/本番LIVEの再現ではない。**

目的：P11 53件ENTRYのうち33件最初5分に取引印字、19件が5〜50分遅延、1件はH1全期間印字なし。P12 STOP23件はM5 highタッチ確認するがSOURCE EXIT時刻はタッチから5〜60分遅延。P13 SOURCE fixed STOP価格/次H1 openを使う価格代理に留まり、動的native STOP stateは再評価していない。この弱点を分離するために新たな因果順イベント研究モデルを定義する。

## SOURCE発火と純関数
1. 元source natural SHORT V20の53件を入口候補として全保存。SOURCE固定SHAから抽出した `buildPenguDualLsV2EvaluationSeries`, `createPenguShortV20State`, `evaluatePenguDualLsV2PositionBar`, `PENGU_DUAL_LS_V2.short.*` をそのままimportし、純関数の経済条件は改変しない。別事前段P8では元53 source entry/EXIT reason/price/time完全一致済みで、P14実験前に必須。元source baseline29/53勝率54.717%、30bps平均+1.000655%、PF1.377342と、P13の非reprice proxy基準を保存。
2. SOURCE H1のentryTsにSHORT注文intentを作成、同じH1内の最初の正出来高M5 OPENを価格代理。無印字H1は `NO_PRICE_PRINT_ENTRY` としてsource intentは残し、BT勝ち/負けに再分類しない。55分以降まで待って次足を見て初回価格を確定するため、実トレーダーがその価格で約定したとは称さない。SOURCEオープン価格との差を明示。
3. ENTRY後の各H1内は**M5を時系列で走査**。印字なし足はポジションの約定/STOPタッチ・更新を行わない。SOURCE config hard STOP = entryProxy*(1+0.08)、trailingは前の**完了済みH1**のnative position lowWaterMarkを使いentry/previousBest-1>=0.15の時previousBest*(1+0.04)。H1中に新しいトレーリング水準を発明しない。元source STOP優先順位: hard before trailing (source native H1判定のモデルに忠実。ただし1M5内で先にどちらを約定したかはOHLCでは未知→ambiguity flag)。
4. resident STOPのM5 highが閾値へ初めてタッチしたらそのM5時刻で研究モデルSTOPを執行する。価格は`max(STOP_LEVEL, FIRST_TOUCH_M5_OPEN)`（short BUYギャップ不利モデル）、実際のorder book fillではない。EXIT price+timestampはSOURCE H1 labelと異なる。M5 highはその5分足の出来事であり、足の開始時刻=厳密な実約定時刻ではない。
5. resident STOPが付かない場合のみ、SOURCE pinned `evaluatePenguDualLsV2PositionBar`を**そのH1が完全に確定した時刻**に1回呼び、`features.high/low`をentry以降・正印字M5の観測最高/最低へ置換して持ち高に反映。その他のsource H1 featuresはもとのsourceから取得し、仮想nonprint H1による価格不一致は監査フラグとして保持。ENTRYがH1の途中でも、ENTRYより前のM5 high/lowはSTOP発動やposition watermarkへ使わない。
6. native source状態が `MAX_HOLD / DEADLINE / VOL_TARGET_FAILURE_EXIT` 等の非resident EXITを返したら、**H1確定前の`features.open`価格で出口を先取りしない**。確定後の次H1開始から最大6時間の最初の正印字M5 openで研究用buy-fill代理。SOURCE `VOL_TARGET` の同一H1 OPEN意図も識別し「native engineが使用するbar openを決済に使うことは時間因果上問題あり」と個別に保存。正印字が6時間ない場合 `EXIT_PRINT_UNAVAILABLE`、勝敗は未確定。
7. 検証期間は元ENTRY source3コホート（PRE6/BASE40/POST7）、source EXIT後でも翌6Hの初回正印字を確認可能な歴史資料のみ。全intentに同一10/30bps両側費用・追加出口滑り0/10/25bpsを設定。各注文にタイムスタンプ、H1/M5根拠、入口印字遅延、SOURCE vs 新 state差異、hard/trail/exit reason、STOP gap、未確定、価格収益とPF。SOURCE 53件 vs 実価格観測可能なsubsetのSOURCE条件付き成績を**同じ分母で**表示、未成立を勝ち/負けへ変換しない。
8. **強制反証ゲート**: duplicate M5、欠損M5、timestamp逆転、SOURCE native SOURCE53不一致、STOP triggerがENTRYより前、EXITのH1判定より前の価格使用、未確定を成功扱い→fail closed。SOURCE H1/M5価格ミスマッチ、gap、M5内先後順、ticker orderbookなし→必ずlimit書面化。本実験で改善ロジック採用やLIVE反映はない。未見OOS/総合DD20%/PENGU80%は未証明。

元SOURCEを保護した隔離PC研究rootで実行し、全台帳/再計算SHA/テスト結果をDraft PR #595へPush。本番master/VPS/Runner/STOP/注文/建玉/KillSwitch/HYPEを変更しない。
