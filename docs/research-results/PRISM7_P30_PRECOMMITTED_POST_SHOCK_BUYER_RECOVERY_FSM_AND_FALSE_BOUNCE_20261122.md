# PRISM VII P30 — 急落後の買い戻し回復を事後の完了5分足で確認してからSHORTを清算する研究状態機械（成績を見る前に固定）

研究ロジック：PENGU_S4_RECOVERY_CONFIRMED_EXIT_V1。ProductionのPENGU SHORT V20、S4研究の元SOURCE120 setup/ENTRY、REFERENCE_STOP72は不変更。P25無条件CAPITULATION決済はP29の同一過去人工未来でCONTINUE_DOWNのSOURCE勝ち利益を8/8で削った。P30はその反例を見た**後**に組んだ仮説であり、過去SOURCE同一経路・P29と同一人工未来での評価結果は独立未見OOSではない。元source native pinned SHA：1657e173d250ad58f53e62f7bb0a3428fb405496。

## 元ショックと次に観測可能な状態
- P25と**完全に同じ**CROSS_ASSET_CAPITULATION検出：SHORT時点の固定ENTRY価格に対してPENGU確定5M終値が25%以上有利、直前positive-print M5終値から20%以上暴落、BTC同時刻positive-print M5終値が直前positive比3%以上暴落、PENGU taker buy ratio<=0.45。判定できるのは**該当5M足が完全にCLOSEした後**。
- 直ちに全量利確するP25は一般ルールとして不採用。まずPENDING_BUYER_RECOVERYに遷移する。以後2H以内の**今まで未観測だった正出来高M5の確定**を監視する。
- この新規5M足のPENGU close>=元SHOCK確定PENGU close×**1.01**、かつ close>open（陽線）。**同一clock**のBTC positive-print M5 close>=元SHOCK時BTC M5 close×**1.005**。BTCが今の足を終えるまでは条件成立としない。新たなリカバリー条件は 1% / 0.5% に固定、結果後チューニング禁止。
- 時刻tからt+5minのM5が確定して初めて RECOVERY_CONFIRMED になる。新規BUY-to-coverの価格代理は**確認完了の次以降の1本目/2本目の正出来高PENGU M5 OPEN**。源REFERENCE_STOP72が先なら源STOP優先。モデル価格はそのM5 OPEN×(1+extraExitSlipBps/10000) とし、元SHOCK足や回復確認足のOPENに遡って約定しない。
- 2H以内に回復確認不能ならP25専用EXITを適用しないで元SOURCE REFERENCE_STOP72を維持する。認識直後の値動きが上昇か下降かという将来ラベルや最終損益を判定に使わない。相場が戻った後にさらに急落するFAKE BUYER BOUNCEは予め反例対象とする。

## 反例テスト：元SOURCE同一prefixの**後だけ**未来を生成
- P29と**同じ**既知2025-10-10 21:15UTCのSOURCE PENGU M5 close0.010000/BTC104694.7、entry0.022617、およびその一つ前のM5価格を共通prefixとして固定。未来最初のM5は21:20以降。P29のRECOVER_FAST, CONTINUE_DOWN, CHOPPY_REBOUND（各8位相seed/正出来高EVERY_M5,E3RD,E12TH）を再利用するが、BTC未来も固定で生成：RECOVER_FAST BTC target115000 / tau1H、CONTINUE_DOWN target95000 / tau24H、CHOPPY_REBOUND target110000 /tau4H。
- **新たな反例**FALSE_BOUNCE_DUMPを明示的に追加：PENGU SHOCK0.010→最初の30minで0.012近辺に上昇、その後24Hかけて0.004まで再下落；BTC104694.7→最初30minで107000近辺に反発、その後24Hかけて95000へ下落。人工関数は初期回復区間に指数近似tau=0.25H、その後はend値から指数tau=12H、全seedは固定位相変動を最大0.8%以下で付加。結果を見て閾値や人工相場を選び直さない。
- 全4レジーム×8seed×3印字マスク=**96人工未来**。全部同じ元SHOCK確定のSOURCE prefixを使用し、初期SHORTやshockラベルを再学習しない。元REFERENCE_STOP72 vs P25旧無条件1/2print とP30新buyer-confirm1/2printを同一元人工価格で経済比較する。fee10/30bps×extraExitSlip0/100/1000bps×確認後1/2正印字=96×2×2×3=**1,152新P30ケース**。BASIC比較のP25旧はsame future同じpositive印字2本目で報告。
- 既存SOURCE勝者の利益を削る件数、負けを救う件数、途中信号無し、止めるまでの発火時間、先にSTOPが来た数、各レジーム別平均net/PF、印字マスクで時間が遅れて成績が崩れる件数を、個票と集計に保存。FAKE_BOUNCE_DUMPで回復確認しても再暴落する反例が出たら、なおモデル不採用として明記する。人工結果をリアルOOSと主張しない。
- 実市場SOURCE P22全120元setupにも同じ状態機械を適用して、P25既知Oct eventの回復確認時間と次positive M5買い戻し、SOURCE元STOP先着、1枠、右打切り1、P26時間順M5 close/HIGH DDと10/30bps費用を再計算する。検証結果は結果を見た後の後付けなので、LIVE採用/真のDD20・PENGU80の達成証拠ではない。

本番master/VPS/Runner/建玉/実注文/STOP/KillSwitch/HYPE/他Codex作業は絶対不変。研究Draft PR #595だけへ全source/事前登録/成績/失敗例をPush。
