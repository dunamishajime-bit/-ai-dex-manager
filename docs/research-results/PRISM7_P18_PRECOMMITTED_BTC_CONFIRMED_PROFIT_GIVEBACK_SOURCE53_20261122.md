# PRISM VII P18 — MFE3利益全戻し7件に絞ったBTC同時確認・M5買圧力によるEXIT (結果前固定)

**Research only / entry-source固定自然53候補・勝ち29/24敗。** P7 53件分類：11件初期順行<1%、7件は少なくとも3%順行したのに負け、6件は弱い順行後負け。過去P7-3の一律buy-flow2up EXITはnative負け6件→勝ちも元SOURCE利益を大幅削ってnetほぼ0、PF1以下〜1.0で不採用。P10一律H1買圧力はさらに悪化。ここでは**利益が最低3%へ伸びたケースの中で、BTCを含む反転の複数証拠を待つ2つの固定仮説を比較**。不採用ならそのまま残し、結果を見た後で閾値最適化しない。

## Native STOP優先とP14 M5 clock直接比較

- 元native PENGU SHA `1657e173d250ad58f53e62f7bb0a3428fb405496`、P14確定53 source original intentsとP14 M5 event-time proxy EXIT timestamp/priceを**必須ベースライン**。P14では52/53 entry+exit print proxy成立、元SOURCE勝ちを含む1件entry未印字はmissingのまま。Source model costs10/30bps、追加EXIT滑り0/10/25bpsを6通り計算。全source候補53を維持、missingを勝ち・負け扱いしない。
- 元PENGU M5の各5分の**CLOSE確定後**にしか新EXITシグナルを出せない。source P14がM5 native resident STOP価格へ最初に到達した時刻より**前に**新EXITをBUY実行できることが必須。SOURCE STOPと競合した時はsource native STOP/元P14 EXIT優先。Source `SHORT_MAX_HOLD/DEADLINE` 決済も元P14実行M5時刻以前に研究EXITが実行できなければ不採用。
- 正出来高のM5のみ `current/peak PENGU SHORT gross profit` を追跡。将来MAX(MFE)は禁止。初回**確定CLOSE gross >=+3%**で初めてactive。
- PENGU最新3本の正出来高M5が連続上昇し、直近3本の takerBuyAmount / 3本volume >= **0.60**、peak gross - current gross >=max(1.0pp,0.75×entryAtr24% )、current gross >=+0.75% が共通要求。ENTRY時点ATR24は固定（元P8 source 53原本/PRISM4特徴量）。BTCの公開M5は**PENGUと同じclose確定時刻のM5**と12本前60分のM5 closeを使用（現在より後のBTC価格は参照禁止）。BTCのM5正出来高がない/時刻不一致ならfalse。
- 2仮説：
  - `BTC_CONFIRM_GAIN_LOCK`: 上の全共通要件 + BTC過去1h終値return >=**+0.30%**。
  - `BTC_STRONG_BOUNCE_LOCK`: 共通要件 + BTC過去1hreturn>=**+0.50%**、PENGU直近6本正出来高M5の実時間約30分上昇return>=**+1.0%**。遅延印字があれば30分でなく6印字イベントと記録。
- 検知M5がtsなら情報確定はts+5min。EXIT代理はその後の**最初の正出来高M5 OPEN**で行い、STOP/他SOURCE EXITより前に実現しなければP14 baselineを維持。P7-3の課題だったSTOPタッチの時刻先行をP14自身のSTOPイベントで補正。BUY price may be worse than proxy from missing depth; signed fills0。
- 生来候補53、valid source52、SOURCE元勝者利益合計変化、native/P14元負け→勝ち、native/P14勝ち→負け、mean net、PF、fee10/30 × slip0/10/25を全ケース行保存。PRE/BASE/POST cohort別、特にBASE40を隠さない。過去閲覧済み53をsource true OOSと称しない。
- **採用ゲートは総合30bpsのPF/平均利益/元勝ち保持がbaseline以上、人工独立sourceの反証を受け、未見OOSで再現可能。** 今回改善したように見えてもP18一発で本番採用不可。目標勝率80%/DD20%の根拠が得られない場合は明確にREJECT。
- M5板情報の欠損、STOPが同一M5内でどの価格/秒に執行したか、Funding/Gross/他Runner/DDの未解決は残す。Production/master/VPS/実注文/Runner/STOP/KillSwitch/HYPEは不変更。PR #595研究DraftのみPush。
