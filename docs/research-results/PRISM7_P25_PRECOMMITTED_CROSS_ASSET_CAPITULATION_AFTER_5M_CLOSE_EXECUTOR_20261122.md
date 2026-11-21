# PRISM VII P25 — PENGU S4「通常下降継続」と「BTC連動の流動性ショック」を分離した特殊状態モジュール（結果算出前固定）

**研究名 `PENGU_S4_CAPITULATION_CAPTURE_V1`。** P24ですでに観測された2025-10-10 21:15 UTCの極端なPENGU/BTC同時下落は既知、従って**既知事象を説明する仮説であり、この日時を含む研究データは全く独立OOSではない。** P24では S3_01700 がPENGU0.022617でSHORT代理、5分後にclose0.010000、さらに次M5でclose0.009588。SOURCE M5/H1および同時刻BTC M5/H1の価格整合あり。しかし市場価格bar内の約定・成行数量・板保証はない。元P22の結末は参考トレーリングで0.020007（勝ち）だが、途中大きな未実現益から急回復し、最悪M5 NAV DDの基準ピークを形成した。P10/P18/P19の「通常相場での買い圧EXIT」は元SOURCE利益を削って経済PFが低下したため、**極端な異常レジームのみ**別ルートで執行可能性を検討する。

SOURCE自然53・P20/P21/P22全H1構造setup120、P22 all-candidate単位の実行可能ENTRY/STOP72/保有期限を**全件維持**。参考comparison STOP72（hard+8%、前完成H1までの低値で有利+15%後trail4%、maxHold72H）は変更せず、ショック状態に限り自然STOPより早い買い戻しの**研究価格代理**へEXITを変更。PENGU BTC H1/5M raw SHA、P22 240イベントSHA、P23 M5-risk SHAを結果へ残す。

## 凍結するCAPITULATION detection

保有中各PENGU正出来高M5 `[t,t+5min)` が**CLOSE確定**した時だけ、以下を全満たすと `CROSS_ASSET_CAPITULATION_CONFIRMED`：
1. PENGU M5 **CLOSEが当該SHORT ENTRY価格の75%以下**：当該時点のgross順行+25%以上。
2. PENGU M5 CLOSEが **1本前のpositive-print M5 closeの80%以下**：5分足印字間でさらに20%以上急落。正印字が連続なら約5分。
3. BTC同時刻の正出来高M5 CLOSEが **直前のBTC正印字M5 closeの97%以下**：BTCの短期急落−3%以上。同じM5時刻でなければ条件不成立、未来BTCは参照しない。
4. PENGU M5の `takerBuyVolume/volume<=0.45`、BTC volume>0。close/headの成立時に初めて観測可能。PENGU M5 close/entry価格を同じ足のOPENで売買したと偽ってはならない。市場がカオス時に生じるspread/market impactは追加滑りとしてストレスする。

## 執行・反証ルール
- シグナル発生時刻 `t+5min`。**第2本目の正出来高M5のOPEN**で買い戻しをする保守的代理をP25の主結果とする。シグナル確定後の1本目のpositive M5 OPENで清算する楽観感度、3本目で清算する悲観感度も**結果前固定**。未来を見て有利なタイミング選択禁止。
- SOURCE reference STOP/既存EXITが第2本positive M5開始以前ならSOURCE STOP優先、新規ショックEXIT不可。時間切れ/印字なしは元source。EXIT `max(positiveM5open,sourceSTOP)`のような不自然な選択をせず、追加スリッページの買い戻し価格代理は `M5 OPEN×(1+extra_slip_bps/10000)`（extra 0/25/100/500/1000bpsを結果前固定）とする。買い戻しが成立したと保証しない。
- **S4 all120 structural candidatesを全件保存**、元SOURCE P22 all candidateと価格代理が完全一致するものは全件保持。P25でSOURCE価格時間を変更するのは厳密に上記ショック検出後かつ元STOPより先に執行可能というケースだけ。それによって1枠が早く空く場合はP21と同じ`apply_single_slot`を入口時刻順に再適用して隠れた候補が新たに採用されたことを記録する。候補がなかった日から取引を発明しない。
- 30bps、10bpsとも研究側で実行、各extra slippage5パターン×1/2/3 next-print delay×2fee=30シナリオ。勝率、PF、平均net、損益合計、実現DD、P23 M5-close DD/HIGH adverse envelope DD、元勝ちロジックの保護、ショックEXIT時刻/価格、残1件の右打切り状況、元120構造setup当たりの実利相当、pre/base/post per-route分析。MAINは30bps/第2print/extra0。SOURCE P22 base30bps 21完了/15勝/PF3.9056、P23 DD35.9415%の完全パリティ必須。
- 追加の流動性真偽チェックとして、ショックEXIT proxy M5 positive volumeとPENGU価格のnotional `PENGU_volume × exitOpen_USDT` を証跡記録し、その額を**利用可能な板厚と同一視しない**。追加滑り500bps/1000bpsでも改善が見られるかを重要な反証とする。30bps通常手数料込み。
- SOURCE cohort PRE/BASE/POST、全自然候補、右打切りを落とさない。目標はPENGU80%・DD20%だが、今回1件の既知shockから規則を作った以上、**改善しても本番採用不可・独立OOSでの再検証と人工相場/synthetic buy squeezesが必須。**

本番マージ・VPS・Runner・注文・建玉・STOP・KillSwitch・SharedRisk・HYPE変更なし。PR #595のDraft branchだけにコード・全資料/検証証跡をPush。
